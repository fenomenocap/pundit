import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { migrateClubSeasonEvaluationArtifact, selectOnePerFixture } from "./club-season-snapshots";
import { binaryLogLoss, bootstrapStatistic, eceFiveBuckets, oneXTwoBrier, oneXTwoLogLoss, predictedResult,
  type ScoredMatch } from "./forecast-eval-metrics";

describe("forecast eval metrics", () => {
  it("reproduces the deduped 84-match club-season baseline", () => {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "__fixtures__/club-season-ledger-prod-2026-10-22.json"), "utf8"));
    const artifact = migrateClubSeasonEvaluationArtifact(raw);
    const kept = selectOnePerFixture(artifact.fixtures).filter((fixture) => fixture.result);
    const matches: ScoredMatch[] = kept.map((fixture) => {
      const result = fixture.result!;
      const outcome = result.winner === "home" ? 0 : result.winner === "draw" ? 1 : 2;
      return {
        result: outcome,
        oneXTwo: [fixture.pHome, fixture.pDraw, fixture.pAway],
        over25: fixture.pOver2_5,
        over25Actual: result.homeScore + result.awayScore > 2.5 ? 1 : 0,
        btts: fixture.pBttsYes,
        bttsActual: result.homeScore > 0 && result.awayScore > 0 ? 1 : 0,
        scorelineLogLoss: 0,
      };
    });
    expect(matches).toHaveLength(84);
    expect(matches.reduce((sum, match) => sum + oneXTwoBrier(match.oneXTwo, match.result), 0) / 84).toBeCloseTo(0.6243, 4);
    expect(matches.reduce((sum, match) => sum + oneXTwoLogLoss(match.oneXTwo, match.result), 0) / 84).toBeCloseTo(1.0514, 4);
    expect(matches.filter((match) => predictedResult(match.oneXTwo) === match.result).length / 84).toBeCloseTo(0.4762, 4);
    expect(eceFiveBuckets(matches).ece).toBeCloseTo(0.0617, 4);
    expect(matches.reduce((sum, match) => sum + (match.over25 - match.over25Actual) ** 2, 0) / 84).toBeCloseTo(0.2497, 4);
    expect(matches.reduce((sum, match) => sum + (match.btts - match.bttsActual) ** 2, 0) / 84).toBeCloseTo(0.2473, 4);
    expect(binaryLogLoss(0.5, 1)).toBeCloseTo(Math.log(2), 12);
    const constant = bootstrapStatistic(20, () => -0.25, 7, 50);
    expect(constant.estimate).toBeCloseTo(-0.25, 6);
    expect(constant.ci95).toEqual([-0.25, -0.25]);
  });
});
