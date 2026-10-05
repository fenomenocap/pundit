import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildModelFixtureFromActive, type ModelFixture } from "./model-data";
import { buildMatchContext } from "./match-context";
import { computeMatchModel, eloToLambdas, matrixTo1x2, matrixToTotals, matrixToBtts, scoreMatrix } from "./dixon-coles";
import type { ActiveFixture } from "./active-fixtures";
import { fixture } from "./__fixtures__/model-fixture";

const sha = "4b4bbe8f21ea21db33b430d5bb53257c3baf0876b8fc0672240a5edae24e84d0";
const artifact = JSON.parse(readFileSync(join(__dirname, `../../data/model-artifacts/clubelo/${sha}.json`), "utf8"));
const strengths = artifact.payload.byProfile["eng-clubs"] as Record<string, number>;
const profile = new Map(Object.entries(strengths));
const ratings = { world: new Map<string, number>(), "eng-clubs": profile, "uefa-clubs": profile };
const event: ActiveFixture = {
  id: 401879268, competitionId: "eng.1", competition: "Premier League",
  homeTeam: "Arsenal", awayTeam: "Leeds", utcDate: "2026-10-10T14:00:00.000Z",
  status: "SCHEDULED", neutralVenue: false, stage: null, matchday: null, group: null, score: null, featured: false,
};
function model(neutralVenue = false): ModelFixture {
  return buildModelFixtureFromActive({ ...event, neutralVenue }, ratings, {
    forecastAt: new Date("2026-10-05T15:49:23.105Z"),
    ratingSnapshotAt: new Date(artifact.payload.snapshotAt), ratingSourceState: "artifact",
    ratingArtifactId: artifact.artifactId, ratingArtifactSha256: sha,
  })!;
}
function copied(): ModelFixture { return structuredClone(model()); }
const rounded = (x: number) => Math.round(x * 10_000) / 10_000;

describe("exact cached forecast inputs", () => {
  it("uses the actual pinned fixture inputs and reproduces all marginals and supplied cells", () => {
    expect(createHash("sha256").update(JSON.stringify(artifact.payload)).digest("hex")).toBe(sha);
    const row = model();
    expect(row.forecastInputs?.homeStrength).toBe(strengths.Arsenal);
    expect(row.forecastInputs?.awayStrength).toBe(strengths.Leeds);
    expect(row.homeElo).toBe(2040.3); expect(row.awayElo).toBe(1816.5);
    const context = buildMatchContext(row);
    expect([context.lambdaHome, context.lambdaAway]).toEqual(eloToLambdas(strengths.Arsenal, strengths.Leeds, 42));
    expect([context.lambdaHome, context.lambdaAway]).toEqual([2.219550545854526, 0.48044945414547424]);
    const grid = scoreMatrix(context.lambdaHome, context.lambdaAway);
    const [home, draw, away] = matrixTo1x2(grid);
    const [over, under] = matrixToTotals(grid, 2.5);
    const [yes, no] = matrixToBtts(grid);
    expect([home, draw, away, over, under, yes, no].map(rounded)).toEqual([
      row.pHome, row.pDraw, row.pAway, row.pOver2_5, row.pUnder2_5, row.pBttsYes, row.pBttsNo,
    ]);
    for (const cell of row.scorelines) {
      const [h, a] = cell.score.split("-").map(Number);
      expect(Math.abs(grid[h][a] - cell.probability)).toBeLessThanOrEqual(0.0000500001);
    }
    const legacyMeans = eloToLambdas(row.homeElo, row.awayElo, 42);
    const supplied = row.scorelines.find((x) => x.score === "4-0")!.probability;
    // Genuine old-source failure at the existing four-decimal rounding boundary.
    expect(Math.abs(scoreMatrix(...legacyMeans)[4][0] - supplied)).toBeGreaterThan(0.0000500001);
    expect(Math.abs(grid[4][0] - supplied)).toBeLessThanOrEqual(0.0000500001);
  });
  it("matches strict actual-pin four-zero cell tolerance rather than rounded-Elo means", () => {
    const row = model(); const context = buildMatchContext(row);
    const supplied = row.scorelines.find((x) => x.score === "4-0")!.probability;
    expect(Math.abs(scoreMatrix(context.lambdaHome, context.lambdaAway)[4][0] - supplied))
      .toBeLessThanOrEqual(0.0000500001);
  });
  it("keeps neutral-venue rates and forecasts coherent", () => {
    const row = model(true); const context = buildMatchContext(row);
    expect(row.forecastInputs?.homeAdvantageElo).toBe(0);
    expect([context.lambdaHome, context.lambdaAway]).toEqual(eloToLambdas(strengths.Arsenal, strengths.Leeds, 0));
  });
  it("respects a coherent explicit provenance HFA override", () => {
    const row = copied(); const hfa = 17;
    row.forecastInputs!.homeAdvantageElo = hfa;
    row.forecastProvenance!.homeAdvantageElo = hfa;
    const original = computeMatchModel(strengths.Arsenal, strengths.Leeds, hfa);
    for (const key of ["pHome", "pDraw", "pAway", "pOver2_5", "pUnder2_5", "pBttsYes", "pBttsNo"] as const) {
      row[key] = rounded(original[key]);
    }
    for (const key of ["scorelines", "topScores"] as const) {
      row[key] = original[key].map(([[h, a], p]) => ({ score: `${h}-${a}`, probability: rounded(p) }));
    }
    const context = buildMatchContext(row);
    expect([context.lambdaHome, context.lambdaAway]).toEqual(eloToLambdas(strengths.Arsenal, strengths.Leeds, hfa));
  });
  it("retains explicit compatibility for a legacy fixture with no carried inputs", () => {
    const legacy = fixture("Arsenal", "Leeds", { homeElo: 1900, awayElo: 1600 });
    const context = buildMatchContext(legacy);
    expect([context.lambdaHome, context.lambdaAway]).toEqual(eloToLambdas(1900, 1600, 42));
  });
  it.each([NaN, Infinity, -Infinity])("rejects nonfinite carried or construction inputs %s", (invalid) => {
    for (const key of ["homeStrength", "awayStrength", "homeAdvantageElo"] as const) {
      const row = copied(); row.forecastInputs![key] = invalid;
      expect(() => buildMatchContext(row)).toThrow(/provenance/);
    }
    const bad = { ...ratings, "eng-clubs": new Map(profile).set("Arsenal", invalid) };
    expect(buildModelFixtureFromActive(event, bad)).toBeNull();
  });
  it.each([
    ["fixtureId", 123], ["competitionId", "uefa.champions"], ["utcDate", "2026-10-11T14:00:00.000Z"],
    ["home", "Liverpool"], ["away", "Arsenal"], ["homeAdvantageElo", 0],
    ["ratingArtifactId", "clubelo@1:other"], ["ratingArtifactSha256", "0".repeat(64)],
    ["ratingSnapshotAt", "2026-09-29T00:00:00.000Z"], ["homeStrength", 1800], ["awayStrength", 1900],
  ])("rejects stale/mismatched carried input %s", (key, invalid) => {
    const row = copied(); Object.assign(row.forecastInputs!, { [key]: invalid });
    expect(() => buildMatchContext(row)).toThrow(/provenance/);
  });
  it("does not silently fallback from a present null input block or missing provenance", () => {
    const row = copied(); (row as unknown as { forecastInputs: null }).forecastInputs = null;
    expect(() => buildMatchContext(row)).toThrow();
    const noProvenance = copied(); delete noProvenance.forecastProvenance;
    expect(() => buildMatchContext(noProvenance)).toThrow(/provenance/);
  });
  it.each([
    ["homeAdvantageElo", undefined], ["modelId", "another-model"], ["modelVersion", "3"],
    ["contributorId", "other"], ["contributorVersion", "2"], ["methodId", "other-method"],
    ["ratingProfile", "uefa-clubs"], ["config", { baseGoals: 2 }],
  ])("rejects inconsistent forecast provenance %s", (key, invalid) => {
    const row = copied(); Object.assign(row.forecastProvenance!, { [key]: invalid });
    expect(() => buildMatchContext(row)).toThrow(/provenance/);
  });
  it("rejects probabilities that belong to another forecast even when input bindings match", () => {
    const row = copied(); row.pHome += 0.001;
    expect(() => buildMatchContext(row)).toThrow(/probabilities/);
    const wrongCell = copied(); wrongCell.scorelines[0].probability += 0.001;
    expect(() => buildMatchContext(wrongCell)).toThrow(/probabilities/);
  });
  it.each(["scorelines", "topScores"] as const)("rejects incomplete, repeated or reordered %s", (key) => {
    const missing = copied(); missing[key].pop();
    expect(() => buildMatchContext(missing)).toThrow(/probabilities/);
    const repeated = copied(); repeated[key][1] = { ...repeated[key][0] };
    expect(() => buildMatchContext(repeated)).toThrow(/probabilities/);
    const reordered = copied(); reordered[key].reverse();
    expect(() => buildMatchContext(reordered)).toThrow(/probabilities/);
  });
});
