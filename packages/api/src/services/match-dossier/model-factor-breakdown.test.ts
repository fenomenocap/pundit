import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ActiveFixture } from "../active-fixtures";
import { buildModelFixtureFromActive } from "../model-data";
import {
  buildModelFactorBreakdown,
  productionMatchPricing,
} from "./model-factor-breakdown";

const sha = "e92896a0c08bf99a5ab548df41a9b1529c267b15f46f15eef84ab35ff883cb83";
const artifact = JSON.parse(
  readFileSync(join(__dirname, `../../../data/model-artifacts/clubelo/${sha}.json`), "utf8"),
) as { artifactId: string; payload: { snapshotAt: string; byProfile: Record<string, Record<string, number>> } };
const strengths = artifact.payload.byProfile["eng-clubs"] as Record<string, number>;
const profile = new Map(Object.entries(strengths));
const ratings = { world: new Map<string, number>(), "eng-clubs": profile, "uefa-clubs": profile };

const spursCoventryEvent: ActiveFixture = {
  id: 401879257,
  competitionId: "eng.1",
  competition: "Premier League",
  homeTeam: "Tottenham",
  awayTeam: "Coventry",
  utcDate: "2026-10-19T19:00:00.000Z",
  status: "SCHEDULED",
  neutralVenue: false,
  stage: null,
  matchday: null,
  group: null,
  score: null,
  featured: false,
};

describe("model factor breakdown parity", () => {
  it("matches production pricing and counterfactual steps sum to shipped minus baseline", () => {
    const row = buildModelFixtureFromActive(spursCoventryEvent, ratings, {
      forecastAt: new Date("2026-10-19T10:00:00.000Z"),
      ratingSnapshotAt: new Date(artifact.payload.snapshotAt),
      ratingSourceState: "artifact",
      ratingArtifactId: artifact.artifactId,
      ratingArtifactSha256: sha,
    });
    expect(row).not.toBeNull();
    const fixture = row!;

    expect(fixture.homeElo).toBe(1799);
    expect(fixture.awayElo).toBe(1706);
    expect(fixture.pHome).toBe(0.5992);

    const pricing = productionMatchPricing(fixture);
    expect(pricing.pHome).toBeCloseTo(0.5992, 4);

    const breakdown = buildModelFactorBreakdown(
      fixture,
      fixture.expectedHomeGoals!,
      fixture.expectedAwayGoals!,
    );

    expect(breakdown.eloGapRaw).toBeCloseTo(1799.0236348677315 - 1706, 2);
    expect(breakdown.eloGapEffective).toBeCloseTo(breakdown.eloGapRaw + 42, 2);
    expect(breakdown.pricingExact.pHome).toBeCloseTo(pricing.pHome, 4);
    expect(breakdown.shipped.pHome).toBe(fixture.pHome);
    expect(breakdown.reconciliation.deltaPHomePctResidual).toBe(0);
    expect(breakdown.reconciliation.deltaPHomePctSum).toBe(
      breakdown.reconciliation.expectedDeltaPHomePct,
    );

    const hfaStep = breakdown.counterfactualSteps.find((s) => s.factorId === "home-advantage");
    expect(hfaStep?.deltaPHomePct).not.toBe(0);

    const calStep = breakdown.counterfactualSteps.find((s) => s.factorId === "goal-calibration-shape");
    expect(Math.abs(calStep?.deltaPHomePct ?? 0)).toBeLessThan(0.0001);
  });
});
