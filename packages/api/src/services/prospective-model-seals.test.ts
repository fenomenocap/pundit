import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ELO_CHAMPION, ELO_CHAMPION_CONFIG } from "./model-contributors";
import { buildClubStrengthArtifact } from "./club-strength-artifact";
import { forecastFittedDixonColes } from "./dixon-coles-mle";
import { eloToLambdas, scoreMatrix } from "./dixon-coles";
import type { ModelFixture } from "./model-data";
import type { RecognizedFixture } from "./fixture-registry";
import {
  buildProspectiveBatch, buildProspectiveResult, buildProspectiveSeal, buildUnpricedProspectiveSeal, candidateDigest, persistProspectiveResult,
  persistProspectiveSeal, prospectiveFixtureIdentityMatches, validateFrozenCandidate, validateProspectiveSeal, verifyCandidateSources,
  type FrozenProspectiveCandidate,
} from "./prospective-model-seals";

const now = new Date("2026-10-10T11:00:00.000Z");
const digest = "a".repeat(64);
const directories: string[] = [];
function temp(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pundit-prospective-"));
  directories.push(directory);
  return directory;
}
afterEach(() => directories.forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })));
function candidate(): FrozenProspectiveCandidate {
  return { schemaVersion: 1, methodId: "globally-feasible-fitted-dixon-coles-v1",
    frozenAt: "2026-10-05T00:00:00.000Z", trainingThrough: "2026-05-24T00:00:00.000Z",
    trainingResultAvailableAt: "2026-10-04T00:00:00.000Z",
    trainingDataSha256: digest, sourceHashes: { "forecast.ts": digest }, meanElo: 1800,
    fit: { converged: true, gradientNorm: 1e-7, stopReason: "gradient-converged" },
    params: { intercept: 0.2, homeAdvantage: 0.1, rho: -0.05, timeDecayXi: 0.0065,
      clubEloPriorStrength: 8, attack: { Arsenal: 0.3, Leeds: -0.1 }, defence: { Arsenal: -0.2, Leeds: 0.2 } } };
}
function ratingArtifact(home = 2040, away = 1817) {
  const uefa = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`Club ${i}`, 1500 + i]));
  const england = { ...Object.fromEntries(Object.entries(uefa).slice(0, 20)), Arsenal: home, Leeds: away };
  return buildClubStrengthArtifact({ snapshotAt: "2026-10-04T00:00:00.000Z",
    byProfile: { world: {}, "eng-clubs": england, "uefa-clubs": { ...uefa, Arsenal: home, Leeds: away } } });
}
const pinnedRatings = ratingArtifact();
const artifacts = new Map<string, unknown>([[pinnedRatings.payloadSha256, pinnedRatings]]);
function fixture(): ModelFixture {
  const model = ELO_CHAMPION.forecast({ homeStrength: 2040, awayStrength: 1817, homeAdvantageElo: 42 });
  return { competitionId: "eng.1", competition: "Premier League", fixtureId: 401879268,
    utcDate: "2026-10-10T11:30:00.000Z", date: "2026-10-10", group: null, stage: "match",
    home: "Arsenal", away: "Leeds", homeElo: 2040, awayElo: 1817, ...model,
    topScores: [], scorelines: [], stakePHome: null, stakePDraw: null, stakePAway: null, result: null,
    forecastProvenance: { modelId: "pundit-fundamental", modelVersion: "2", contributorId: "clubelo",
      contributorVersion: "1", methodId: "clubelo-elo-to-goals-dixon-coles", forecastAt: now.toISOString(),
      ratingProfile: "eng-clubs", ratingSnapshotAt: "2026-10-04T00:00:00.000Z", ratingAgeMinutes: 8640,
      ratingSourceState: "artifact", ratingArtifactId: pinnedRatings.artifactId, ratingArtifactSha256: pinnedRatings.payloadSha256, homeAdvantageElo: 42, config: ELO_CHAMPION_CONFIG } };
}
function seal() {
  return buildProspectiveSeal(candidate(), digest, { fixture: fixture(), status: "scheduled", neutralVenue: false }, now, artifacts)!;
}
function recognized(): RecognizedFixture {
  return { fixtureId: "espn:eng.1:401879268", primarySource: "espn", primarySourceFixtureId: "401879268",
    homeTeam: { id: "arsenal", name: "Arsenal" }, awayTeam: { id: "leeds", name: "Leeds United" },
    kickoff: fixture().utcDate, venue: "Emirates", neutralVenue: false,
    competition: { id: "eng.1", name: "Premier League", category: "domestic-league" }, status: "scheduled",
    recognition: "authoritative", observedSources: [], observationHistory: [] };
}

describe("frozen private prospective evidence", () => {
  it("seals exact source-paired grids before kickoff without changing public inputs", () => {
    const input = fixture();
    const original = JSON.stringify(input);
    const result = buildProspectiveSeal(candidate(), digest, { fixture: input, status: "scheduled", neutralVenue: false }, now, artifacts)!;
    expect(JSON.stringify(input)).toBe(original);
    expect(result.failure).toBeNull();
    expect(result.visibility).toBe("private-research");
    expect(result.candidate!.totalXg).not.toBeCloseTo(2.7, 3);
    expect(result.candidate!.pOver2_5 + result.candidate!.pUnder2_5).toBeCloseTo(1, 12);
    for (const grid of [result.championGrid!, result.candidateGrid!]) {
      expect(grid.flat().every((p) => Number.isFinite(p) && p >= 0)).toBe(true);
      expect(grid.flat().reduce((sum, p) => sum + p, 0)).toBeCloseTo(1, 12);
    }
  });
  it("recovers exact decimal ratings before parity and prior-only forecasts without changing public serialization", () => {
    const rated = ratingArtifact(1500.049, 1500.051);
    const raw = ELO_CHAMPION.forecast({ homeStrength: 1500.049, awayStrength: 1500.051, homeAdvantageElo: 42 });
    const input = fixture(); input.homeElo = 1500; input.awayElo = 1500.1;
    const fields = ["pHome", "pDraw", "pAway", "pOver2_5", "pUnder2_5", "pBttsYes", "pBttsNo"] as const;
    for (const field of fields) input[field] = Math.round(raw[field] * 10000) / 10000;
    input.forecastProvenance!.ratingArtifactId = rated.artifactId;
    input.forecastProvenance!.ratingArtifactSha256 = rated.payloadSha256;
    const publicBody = JSON.stringify(input);
    const frozen = candidate();
    frozen.params.attack = { Alpha: 0.3, Bravo: -0.1 };
    frozen.params.defence = { Alpha: -0.2, Bravo: 0.2 };
    const result = buildProspectiveSeal(frozen, digest, { fixture: input, status: "scheduled", neutralVenue: false }, now,
      new Map([[rated.payloadSha256, rated]]))!;
    expect(result.failure).toBeNull();
    expect(JSON.stringify(input)).toBe(publicBody);
    expect(result.inputs).toMatchObject({ homeElo: 1500, awayElo: 1500.1, recoveredHomeElo: 1500.049, recoveredAwayElo: 1500.051,
      ratingArtifactId: rated.artifactId, ratingArtifactSha256: rated.payloadSha256 });
    for (const field of fields) expect(result.champion![field]).toBeCloseTo(raw[field], 12);
    expect(result.candidate).toEqual(forecastFittedDixonColes(frozen.params, "Arsenal", "Leeds",
      { meanElo: frozen.meanElo, homeElo: 1500.049, awayElo: 1500.051 }));
    expect(() => validateProspectiveSeal(result)).not.toThrow();
    expect(result.ratingArtifact).toEqual(rated);
    expect(result.ratingArtifact).not.toBe(rated);
    rated.payload.byProfile["eng-clubs"].Arsenal += 1;
    expect(() => validateProspectiveSeal(result)).not.toThrow(); // Capture owns immutable input bytes.
    const rounded = ELO_CHAMPION.forecast({ homeStrength: input.homeElo, awayStrength: input.awayElo, homeAdvantageElo: 42 });
    expect(Math.abs(input.pHome - rounded.pHome)).toBeGreaterThan(0.000051); // Old comparison falsely rejected this row.
  });

  it.each(["missing", "tampered", "artifact-id", "snapshot", "serialized-elo"])(
    "retains failed checkpoint when verified rating provenance is %s", (fault) => {
      const input = fixture(), rated = structuredClone(pinnedRatings);
      const available = new Map<string, unknown>([[rated.payloadSha256, rated]]);
      if (fault === "missing") available.clear();
      if (fault === "tampered") rated.payload.byProfile["eng-clubs"].Arsenal += 1;
      if (fault === "artifact-id") input.forecastProvenance!.ratingArtifactId = "clubelo@1:" + "c".repeat(64);
      if (fault === "snapshot") input.forecastProvenance!.ratingSnapshotAt = "2026-10-04T00:00:01.000Z";
      if (fault === "serialized-elo") input.homeElo += 0.1;
      const result = buildProspectiveSeal(candidate(), digest, { fixture: input, status: "scheduled", neutralVenue: false }, now, available)!;
      expect(result.failure).toBe(fault === "missing" ? "missing-rating-artifact" : fault === "tampered" ? "invalid-rating-artifact" : "rating-provenance-mismatch");
      expect(result.inputs.recoveredHomeElo).toBeNull();
      expect(result.champion).toBeNull(); expect(result.candidate).toBeNull();
      expect(() => validateProspectiveSeal(result)).not.toThrow();
    }
  );

  it.each(["2026-10-10T09:59:59.999Z", "2026-10-10T11:30:00.000Z", "2026-10-11T00:00:00.000Z"])(
    "cannot retrospectively or prematurely seal at %s", (date) => {
      expect(buildProspectiveSeal(candidate(), digest, { fixture: fixture(), status: "scheduled", neutralVenue: false }, new Date(date), artifacts)).toBeNull();
    });
  it("includes the exact90m boundary and excludes other competitions", () => {
    const observation = { fixture: fixture(), status: "scheduled", neutralVenue: false };
    expect(buildProspectiveSeal(candidate(), digest, observation, new Date("2026-10-10T10:00:00.000Z"), artifacts)).not.toBeNull();
    observation.fixture.competitionId = "uefa.champions";
    expect(buildProspectiveSeal(candidate(), digest, observation, now, artifacts)).toBeNull();
  });
  it.each([
    ["in-play", false, "fixture-not-scheduled"],
    ["scheduled", null, "unsupported-or-unknown-neutral-venue"],
    ["scheduled", true, "unsupported-or-unknown-neutral-venue"],
  ] as const)("retains failed status/venue attempts in the denominator", (status, neutralVenue, reason) => {
    const result = buildProspectiveSeal(candidate(), digest, { fixture: fixture(), status, neutralVenue }, now, artifacts)!;
    expect(result.failure).toBe(reason);
    expect(result.candidate).toBeNull();
  });
  it("rejects nonconvergence, fabricated dates, nonfinite parameters and future freeze", () => {
    const invalid = candidate();
    invalid.fit.converged = false;
    expect(() => validateFrozenCandidate(invalid)).toThrow(/unconverged/);
    invalid.fit.converged = "true" as unknown as boolean;
    expect(() => validateFrozenCandidate(invalid)).toThrow(/unconverged/);
    invalid.fit.converged = true;
    invalid.trainingThrough = invalid.frozenAt;
    expect(() => validateFrozenCandidate(invalid)).toThrow();
    invalid.trainingThrough = "2026-05-24T00:00:00Z";
    invalid.params.attack.Arsenal = NaN;
    expect(() => validateFrozenCandidate(invalid)).toThrow();
    invalid.params.attack.Arsenal = 0.3;
    invalid.frozenAt = "2026-10-11T00:00:00Z";
    expect(() => buildProspectiveSeal(invalid, digest, { fixture: fixture(), status: "scheduled", neutralVenue: false }, now, artifacts)).toThrow(/precedes/);
  });
  it.each(["invalid", "2026-05-24T12:00:00Z", "2026-10-05T00:00:00.001Z"])(
    "rejects unavailable training at freeze: %s", (available) => {
      const invalid = candidate();
      invalid.trainingResultAvailableAt = available;
      expect(() => validateFrozenCandidate(invalid)).toThrow();
      const invalidSeal = seal();
      invalidSeal.trainingResultAvailableAt = available;
      expect(() => validateProspectiveSeal(invalidSeal)).toThrow();
    });
  it.each(["future-rating", "stale-rating", "stale-forecast", "changed-public-probability", "changed-champion"])(
    "withholds unverifiable %s", (fault) => {
      const input = fixture();
      if (fault === "future-rating") input.forecastProvenance!.ratingSnapshotAt = "2026-10-10T11:15:00Z";
      if (fault === "stale-rating") input.forecastProvenance!.ratingSnapshotAt = "2026-08-01T00:00:00Z";
      if (fault === "stale-forecast") input.forecastProvenance!.forecastAt = "2026-10-10T08:00:00Z";
      if (fault === "changed-public-probability") input.pHome = 0.999;
      if (fault === "changed-champion") input.forecastProvenance!.modelVersion = "3";
      const result = buildProspectiveSeal(candidate(), digest, { fixture: input, status: "scheduled", neutralVenue: false }, now, artifacts)!;
      expect(result.failure).not.toBeNull();
      expect(result.candidate).toBeNull();
    });
  it("records inadmissible future-pair grids instead of repairing probabilities", () => {
    const invalid = candidate();
    invalid.params.rho = -0.35;
    invalid.params.attack.Arsenal = 2;
    const result = buildProspectiveSeal(invalid, digest, { fixture: fixture(), status: "scheduled", neutralVenue: false }, now, artifacts)!;
    expect(result.failure).toBe("candidate-invalid-score-grid");
    expect(result.candidateGrid).toBeNull();
    expect(result.championGrid).not.toBeNull();
  });
  it("rejects serialized Elo drift before champion calculations even when inputs are finite", () => {
    const input = fixture(); input.homeElo = 1e9;
    const result = buildProspectiveSeal(candidate(), digest, { fixture: input, status: "scheduled", neutralVenue: false }, now, artifacts)!;
    expect(result.failure).toBe("rating-provenance-mismatch");
    expect(result.champion).toBeNull();
    expect(result.candidate).toBeNull();
  });
  it.each(["version", "method", "profile", "source", "hfa"])("requires exact champion provenance: %s", (fault) => {
    const input = fixture();
    if (fault === "version") input.forecastProvenance!.contributorVersion = "other";
    if (fault === "method") input.forecastProvenance!.methodId = "other";
    if (fault === "profile") input.forecastProvenance!.ratingProfile = "world";
    if (fault === "source") input.forecastProvenance!.ratingSourceState = "live";
    if (fault === "hfa") input.forecastProvenance!.homeAdvantageElo = 0;
    const result = buildProspectiveSeal(candidate(), digest, { fixture: input, status: "scheduled", neutralVenue: false }, now, artifacts)!;
    expect(result.failure).toBe("unverifiable-champion-inputs");
    expect(result.champion).toBeNull();
  });
  it("retains authoritative checkpoint identities even when no public model was emitted", () => {
    const missing = buildUnpricedProspectiveSeal(candidate(), digest, recognized(), now)!;
    expect(missing.failure).toBe("public-model-unavailable");
    expect(missing.inputs.homeElo).toBeNull();
    expect(missing.candidate).toBeNull();
    expect(() => validateProspectiveSeal(missing)).not.toThrow();
    const unknown = recognized(); unknown.neutralVenue = null;
    expect(buildUnpricedProspectiveSeal(candidate(), digest, unknown, now)!.failure).toBe("unsupported-or-unknown-neutral-venue");
    unknown.primarySourceFixtureId = "bad";
    expect(buildUnpricedProspectiveSeal(candidate(), digest, unknown, now)).toBeNull();
  });
  it("keeps unpriced and mismatched registry fixtures in the actual batch denominator", () => {
    const missing = recognized(); missing.primarySourceFixtureId = "401879269";
    missing.fixtureId = "espn:eng.1:401879269"; missing.neutralVenue = null;
    const observed = buildProspectiveBatch(candidate(), digest, [fixture()], [recognized(), missing], now, artifacts);
    expect(observed).toHaveLength(2);
    expect(observed.map((row) => row.failure)).toEqual([null, "unsupported-or-unknown-neutral-venue"]);
    const wrong = recognized(); wrong.awayTeam.name = "Liverpool";
    const conflict = buildProspectiveBatch(candidate(), digest, [fixture()], [wrong], now, artifacts);
    expect(conflict).toHaveLength(1);
    expect(conflict[0].failure).toBe("unrecognized-or-conflicting-fixture");
    expect(conflict[0].candidate).toBeNull();
    expect(() => buildProspectiveBatch(candidate(), digest, [fixture()], [recognized(), recognized()], now, artifacts)).toThrow(/duplicate/);
  });
  it("requires the exact event, competition, kickoff and canonical team orientation", () => {
    expect(prospectiveFixtureIdentityMatches(fixture(), recognized())).toBe(true);
    const wrongTeam = recognized(); wrongTeam.awayTeam.name = "Liverpool";
    expect(prospectiveFixtureIdentityMatches(fixture(), wrongTeam)).toBe(false);
    const wrongSource = recognized(); wrongSource.primarySourceFixtureId = "123";
    expect(prospectiveFixtureIdentityMatches(fixture(), wrongSource)).toBe(false);
    const wrongCompetition = recognized(); wrongCompetition.competition.id = "foreign";
    expect(prospectiveFixtureIdentityMatches(fixture(), wrongCompetition)).toBe(false);
    const wrongKickoff = recognized(); wrongKickoff.kickoff = "2026-10-10T12:30:00Z";
    expect(prospectiveFixtureIdentityMatches(fixture(), wrongKickoff)).toBe(false);
  });
  it.each(["header-only", "post-kickoff", "outside-window", "probability-drift", "grid-drift",
    "same-round-rating", "common-rating-offset", "embedded-payload", "missing-artifact", "coherent-wrong-champion"])(
    "rejects parseable persisted corruption: %s", (fault) => {
      const directory = temp(), valid = seal();
      const saved = persistProspectiveSeal(directory, valid);
      const corrupted = fault === "header-only" ? { schemaVersion: valid.schemaVersion, policy: valid.policy,
        candidateSha256: valid.candidateSha256, fixtureId: valid.fixtureId } : structuredClone(valid);
      if ("observedAt" in corrupted) {
        if (fault === "post-kickoff") corrupted.observedAt = "2026-10-10T12:00:00Z";
        if (fault === "outside-window") corrupted.observedAt = "2026-10-10T08:00:00Z";
        if (fault === "probability-drift") corrupted.candidate!.pHome = 0.999;
        if (fault === "grid-drift") corrupted.candidateGrid![0][0] = 0.999;
        if (fault === "same-round-rating" || fault === "common-rating-offset") corrupted.inputs.recoveredHomeElo! += 1e-5;
        if (fault === "common-rating-offset") corrupted.inputs.recoveredAwayElo! += 1e-5;
        if (fault === "embedded-payload") corrupted.ratingArtifact!.payload.byProfile["eng-clubs"].Arsenal += 1e-5;
        if (fault === "missing-artifact") corrupted.ratingArtifact = null;
        if (fault === "coherent-wrong-champion") {
          corrupted.champion = ELO_CHAMPION.forecast({ homeStrength: 2030, awayStrength: 1817, homeAdvantageElo: 42 });
          corrupted.championGrid = scoreMatrix(...eloToLambdas(2030, 1817, 42));
        }
      }
      fs.writeFileSync(saved.path, JSON.stringify(corrupted));
      expect(() => persistProspectiveSeal(directory, valid)).toThrow(/corrupt/);
      expect(() => buildProspectiveResult(JSON.stringify(corrupted), { id: valid.fixtureId,
        competitionId: "eng.1", utcDate: valid.kickoff, homeTeam: "Arsenal", awayTeam: "Leeds", status: "FINISHED",
        score: { home: 2, away: 0 } }, new Date("2026-10-10T14:00:00Z"))).toThrow(/corrupt/);
    });
  it("accepts last-ulp forecast serialization differences while rejecting material recomputed drift", () => {
    const valid = seal();
    valid.champion!.pHome += 8.9e-16;
    valid.championGrid![0][0] += 8.9e-16;
    expect(() => validateProspectiveSeal(valid)).not.toThrow();
    valid.championGrid![0][0] += 1e-11;
    expect(() => validateProspectiveSeal(valid)).toThrow(/corrupt/);
  });
  it("cannot overwrite the first successful or failed checkpoint", () => {
    const directory = temp();
    const first = seal();
    first.failure = "candidate-invalid-score-grid";
    first.candidate = null;
    first.candidateGrid = null;
    const saved = persistProspectiveSeal(directory, first);
    const original = fs.readFileSync(saved.path, "utf8");
    expect(persistProspectiveSeal(directory, seal()).inserted).toBe(false);
    expect(fs.readFileSync(saved.path, "utf8")).toBe(original);
    expect(fs.readdirSync(directory)).toHaveLength(1);
    fs.writeFileSync(saved.path, "{broken");
    expect(() => persistProspectiveSeal(directory, seal())).toThrow();
  });
  it("requires all forecast implementation bindings and detects source drift", () => {
    const directory = temp();
    const frozen = candidate();
    expect(() => verifyCandidateSources(frozen, directory)).toThrow(/bindings/);
    frozen.sourceHashes = {};
    for (const file of ["packages/api/src/services/dixon-coles-mle.ts", "packages/api/src/services/dixon-coles.ts",
      "packages/api/src/services/prospective-model-seals.ts", "packages/api/src/lib/team-names.ts",
      "packages/api/src/services/club-strength-artifact.ts",
      "packages/api/src/services/model-contributors.ts", "packages/api/scripts/capture-prospective-model.ts"]) {
      fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
      fs.writeFileSync(path.join(directory, file), "frozen source");
      frozen.sourceHashes[file] = candidateDigest("frozen source");
    }
    expect(() => verifyCandidateSources(frozen, directory)).not.toThrow();
    fs.writeFileSync(path.join(directory, Object.keys(frozen.sourceHashes)[0]), "changed source");
    expect(() => verifyCandidateSources(frozen, directory)).toThrow(/changed/);
    frozen.sourceHashes["../escape"] = digest;
    expect(() => validateFrozenCandidate(frozen)).toThrow();
  });
  it("links independently observed final results while preserving forecast bytes and corrections", () => {
    const directory = temp();
    const saved = persistProspectiveSeal(directory, seal());
    const original = fs.readFileSync(saved.path, "utf8");
    const match = { id: 401879268, competitionId: "eng.1", utcDate: fixture().utcDate, homeTeam: "Arsenal", awayTeam: "Leeds",
      status: "FINISHED", score: { home: 2, away: 0 } };
    const finishedAt = new Date("2026-10-10T13:30:00Z");
    expect(buildProspectiveResult(original, match, now)).toBeNull();
    expect(buildProspectiveResult(original, { ...match, id: 123 }, finishedAt)).toBeNull();
    expect(buildProspectiveResult(original, { ...match, awayTeam: "Liverpool" }, finishedAt)).toBeNull();
    expect(buildProspectiveResult(original, { ...match, utcDate: "2026-10-10T12:30:00Z" }, finishedAt)).toBeNull();
    expect(buildProspectiveResult(original, { ...match, status: "IN_PLAY" }, finishedAt)).toBeNull();
    expect(buildProspectiveResult(original, { ...match, score: { home: -1, away: 0 } }, finishedAt)).toBeNull();
    const result = buildProspectiveResult(original, match, finishedAt)!;
    expect(buildProspectiveResult(original, match, new Date("2027-01-01T00:00:00Z"))).not.toBeNull();
    const resultsDirectory = path.join(directory, "results");
    const first = persistProspectiveResult(resultsDirectory, result);
    expect(persistProspectiveResult(resultsDirectory, result)).toBe(first);
    persistProspectiveResult(resultsDirectory, { ...result, homeScore: 3, observedAt: "2026-10-11T00:00:00Z" });
    expect(fs.readdirSync(resultsDirectory)).toHaveLength(2);
    expect(result.sealSha256).toBe(candidateDigest(original));
    expect(fs.readFileSync(saved.path, "utf8")).toBe(original);
  });
});
