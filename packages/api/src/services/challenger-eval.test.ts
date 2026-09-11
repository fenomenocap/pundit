import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CHALLENGER_EVAL_NOT_ACTIVATED,
  MIN_HOLDOUT_N_FOR_PROMOTION,
  MIN_SCORED_ORIGINS_FOR_PROMOTION,
  championGrid1x2,
  evaluatePairedRollingOrigin,
  evaluatePairedRollingOriginFromDataDir,
  promotionGateDecision,
  type ChallengerEvalRow,
  type OriginEval,
} from "./challenger-eval";
import {
  forecastFittedDixonColes,
  writeFittedDixonColesArtifact,
  type FittedDixonColesArtifact,
} from "./dixon-coles-mle";
import {
  BASE_GOALS,
  DEFAULT_HOME_ADVANTAGE_ELO,
  RHO,
  eloToLambdas,
} from "./dixon-coles";
import {
  DIXON_COLES_MLE_ARTIFACT_SHA256,
  ELO_CHAMPION,
  REGISTERED_CHALLENGERS,
  REGISTERED_DIXON_COLES_MLE,
} from "./model-contributors";
import { FITTED_DIXON_COLES_CONTRIBUTOR_ID } from "./dixon-coles-mle";

function artifact(overrides: Partial<FittedDixonColesArtifact["params"]> = {}): FittedDixonColesArtifact {
  return {
    schemaVersion: 1,
    contributor: {
      id: "dixon-coles-mle",
      methodId: "fitted-attack-defence-dixon-coles",
      status: "challenger",
    },
    params: {
      intercept: 0.22,
      homeAdvantage: 0.28,
      rho: -0.1,
      timeDecayXi: 0.0065,
      attack: { Hull: -0.4, "Man United": 0.4 },
      defence: { Hull: 0.3, "Man United": -0.3 },
      clubEloPriorStrength: 8,
      ...overrides,
    },
    training: {
      clubHistoryDatasetSha256: "a".repeat(64),
      preKickoffEloDatasetSha256: "b".repeat(64),
      splitManifest: [{
        origin: "2025-01-01T00:00:00.000Z",
        trainEventIds: ["early"],
        holdoutEventIds: ["late"],
      }],
      rowCount: 2,
      clubCount: 2,
      fitScope: "all-joined-pl-rows",
      excludedFixtureCount: 0,
      plFixtureCoverage: { covered: 2, n: 2 },
      converged: true,
      iterations: 12,
      logLikelihood: -20.5,
    },
  };
}

function row(
  id: string,
  kickoff: string,
  home: string,
  away: string,
  homeGoals: number,
  awayGoals: number,
  homeElo = 1540,
  awayElo = 1884
): ChallengerEvalRow {
  return {
    sourceEventId: id,
    competitionId: "eng.1",
    kickoff,
    homeCanonicalName: home,
    awayCanonicalName: away,
    homeGoals,
    awayGoals,
    homeElo,
    awayElo,
  };
}

function improvingOrigin(origin: string, n = MIN_HOLDOUT_N_FOR_PROMOTION): OriginEval {
  return {
    origin,
    holdoutCount: n,
    scoredCount: n,
    uncoveredCount: 0,
    champion: {
      n,
      brier: 0.5,
      logLoss: 0.9,
      winnerAccuracy: 0.4,
      over25Brier: 0.3,
      calibrationMae: 0.4,
    },
    challenger: {
      n,
      brier: 0.4,
      logLoss: 0.8,
      winnerAccuracy: 0.5,
      over25Brier: 0.25,
      calibrationMae: 0.3,
    },
    championCalibration: [],
    challengerCalibration: [],
    deltas: { brier: -0.1, logLoss: -0.1, calibrationMae: -0.1 },
    challengerImproves: true,
  };
}

describe("paired champion/challenger rolling-origin eval", () => {
  it("fails closed without a fitted artifact and does not invent forecasts", () => {
    const result = evaluatePairedRollingOrigin({});
    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("missing-fitted-artifact");
    expect(result.pairedForecasts).toEqual([]);
    expect(result.decision.recommendPromotion).toBe(false);
    expect(result.decision.activateProduction).toBe(false);
    expect(result.decision.changeShippedConstants).toBe(false);
    expect(result.registeredChallengers).toBe(1);
    expect(REGISTERED_CHALLENGERS).toHaveLength(1);
    expect(REGISTERED_CHALLENGERS[0]?.id).toBe(FITTED_DIXON_COLES_CONTRIBUTOR_ID);
    expect(REGISTERED_CHALLENGERS[0]?.status).toBe("challenger");
    expect(REGISTERED_CHALLENGERS[0]?.id).not.toBe(ELO_CHAMPION.id);
  });

  it("fails closed when the artifact has no holdout rows or splits", () => {
    expect(evaluatePairedRollingOrigin({
      artifact: artifact(),
      rows: [],
    }).reason).toBe("no-holdout-rows");
    expect(evaluatePairedRollingOrigin({
      artifact: {
        ...artifact(),
        training: { ...artifact().training, splitManifest: [] },
      },
      rows: [row("late", "2025-08-16T14:00:00Z", "Hull", "Man United", 0, 2)],
    }).reason).toBe("empty-split-manifest");
  });

  it("pairs champion (shipped 1.35/42/−0.1) with challenger holdout forecasts", () => {
    const late = row("late", "2025-08-16T14:00:00Z", "Hull", "Man United", 0, 2, 1633, 1884);
    const result = evaluatePairedRollingOrigin({
      artifact: artifact(),
      artifactSha256: "c".repeat(64),
      rows: [
        row("early", "2024-08-17T14:00:00Z", "Hull", "Man United", 1, 1, 1532, 1915),
        late,
      ],
    });
    expect(result.status).toBe("evaluated");
    expect(result.pairedForecasts).toHaveLength(1);
    const pair = result.pairedForecasts[0];
    expect(pair.sourceEventId).toBe("late");
    expect(pair.challenger).not.toBeNull();
    const champion = ELO_CHAMPION.forecast({
      homeStrength: 1633,
      awayStrength: 1884,
      homeAdvantageElo: DEFAULT_HOME_ADVANTAGE_ELO,
    });
    expect(pair.champion.pHome).toBeCloseTo(champion.pHome, 12);
    expect(pair.champion.pDraw).toBeCloseTo(champion.pDraw, 12);
    expect(pair.champion.pAway).toBeCloseTo(champion.pAway, 12);
    const [lh, la] = eloToLambdas(1633, 1884, DEFAULT_HOME_ADVANTAGE_ELO);
    expect(lh + la).toBeCloseTo(2 * BASE_GOALS, 12);
    expect(pair.champion.totalXg).toBeCloseTo(2 * BASE_GOALS, 12);
    const fitted = forecastFittedDixonColes(artifact().params, "Hull", "Man United");
    expect(pair.challenger?.pHome).toBeCloseTo(fitted!.pHome, 12);
    expect(result.origins[0]?.scoredCount).toBe(1);
    expect(result.decision.recommendPromotion).toBe(false);
    expect(result.decision.reasons.some((reason) => reason.startsWith("insufficient-holdout"))).toBe(true);
    expect(result.decision.activateProduction).toBe(false);
    expect(result.champion.constants).toEqual({
      baseGoals: 1.35,
      homeAdvantageElo: 42,
      rho: -0.1,
    });
  });

  it("does not invent attack/defence for a club missing from the artifact", () => {
    const result = evaluatePairedRollingOrigin({
      artifact: artifact(),
      rows: [row("late", "2025-08-16T14:00:00Z", "Arsenal", "Man United", 1, 0)],
    });
    expect(result.status).toBe("evaluated");
    expect(result.pairedForecasts[0]?.challenger).toBeNull();
    expect(result.pairedForecasts[0]?.challengerReason).toBe("missing-club-params");
    expect(result.origins[0]?.uncoveredCount).toBe(1);
    expect(result.origins[0]?.challengerImproves).toBe(false);
    expect(forecastFittedDixonColes(artifact().params, "Arsenal", "Man United")).toBeNull();
  });

  it("reports unavailable metrics on an empty holdout instead of perfect zero loss", () => {
    const result = evaluatePairedRollingOrigin({
      artifact: artifact(),
      rows: [row("early", "2024-08-17T14:00:00Z", "Hull", "Man United", 1, 1)],
    });
    expect(result.origins[0]?.holdoutCount).toBe(0);
    expect(result.origins[0]?.champion.brier).toBeNull();
    expect(result.origins[0]?.champion.logLoss).toBeNull();
    expect(result.origins[0]?.challenger.brier).toBeNull();
    expect(result.origins[0]?.reason).toBe("empty-holdout");
    expect(result.origins[0]?.championCalibration.every((bucket) => (
      bucket.n === 0 && bucket.actualRate === null
    ))).toBe(true);
  });

  it("recommends promotion only when every required origin improves, and still does not activate", () => {
    const blocked = promotionGateDecision([improvingOrigin("2025-01-01T00:00:00.000Z")]);
    expect(blocked.recommendPromotion).toBe(false);
    expect(blocked.activateProduction).toBe(false);
    expect(blocked.humanDecisionRequired).toBe(true);

    const worse = improvingOrigin("2025-08-01T00:00:00.000Z");
    worse.challengerImproves = false;
    worse.deltas = { brier: 0.02, logLoss: 0.01, calibrationMae: 0.01 };
    const notBetter = promotionGateDecision([
      improvingOrigin("2025-01-01T00:00:00.000Z"),
      worse,
    ]);
    expect(notBetter.recommendPromotion).toBe(false);

    const recommended = promotionGateDecision([
      improvingOrigin("2025-01-01T00:00:00.000Z"),
      improvingOrigin("2025-08-01T00:00:00.000Z"),
    ]);
    expect(MIN_SCORED_ORIGINS_FOR_PROMOTION).toBe(2);
    expect(recommended.recommendPromotion).toBe(true);
    expect(recommended.activateProduction).toBe(false);
    expect(recommended.changeShippedConstants).toBe(false);
    expect(recommended.humanDecisionRequired).toBe(true);
    expect(recommended.reasons).toContain(CHALLENGER_EVAL_NOT_ACTIVATED);
  });

  it("loads from disk only when latest.json validates and writes an offline report", () => {
    const missing = evaluatePairedRollingOriginFromDataDir(fs.mkdtempSync(path.join(os.tmpdir(), "pundit-eval-")));
    expect(missing.status).toBe("blocked");
    expect(missing.reason).toBe("missing-fitted-artifact");

    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pundit-eval-"));
    writeFittedDixonColesArtifact(dataDir, artifact());
    const blockedCorpus = evaluatePairedRollingOriginFromDataDir(dataDir);
    expect(blockedCorpus.status).toBe("blocked");
    expect(blockedCorpus.reason).toBe("missing-research-artifacts");
    expect(blockedCorpus.decision.activateProduction).toBe(false);
    expect(REGISTERED_CHALLENGERS).toHaveLength(1);
    expect(REGISTERED_CHALLENGERS[0]).toBe(REGISTERED_DIXON_COLES_MLE);
  });

  it("keeps production champion constants and does not wire eval into runtime", () => {
    expect(BASE_GOALS).toBe(1.35);
    expect(DEFAULT_HOME_ADVANTAGE_ELO).toBe(42);
    expect(RHO).toBe(-0.1);
    expect(championGrid1x2(1800, 1800)[0] + championGrid1x2(1800, 1800)[1] + championGrid1x2(1800, 1800)[2])
      .toBeCloseTo(1, 12);
    expect(REGISTERED_CHALLENGERS).toHaveLength(1);
    expect(REGISTERED_CHALLENGERS[0]?.version).toBe(DIXON_COLES_MLE_ARTIFACT_SHA256);
    expect(REGISTERED_CHALLENGERS[0]?.status).toBe("challenger");
    expect(REGISTERED_CHALLENGERS[0]?.id).not.toBe(ELO_CHAMPION.id);
    const runtimeFiles = [
      "model-data.ts",
      "model-contributors.ts",
      "ask.ts",
      "../index.ts",
    ];
    for (const file of runtimeFiles) {
      const source = fs.readFileSync(path.join(__dirname, file), "utf8");
      expect(source).not.toMatch(/challenger-eval/);
      expect(source).not.toMatch(/evaluatePairedRollingOrigin/);
    }
  });
});
