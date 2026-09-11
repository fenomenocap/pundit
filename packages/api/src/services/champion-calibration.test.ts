import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BASE_GOALS, DEFAULT_HOME_ADVANTAGE_ELO, RHO, eloToLambdas } from "./dixon-coles";
import { buildSnapshotFromModel } from "./club-season-snapshots";
import {
  ELO_CHAMPION,
  ELO_CHAMPION_CONFIG,
  REGISTERED_CHALLENGERS,
} from "./model-contributors";
import { FITTED_DIXON_COLES_CONTRIBUTOR_ID } from "./dixon-coles-mle";
import type { ModelFixture } from "./model-data";
import {
  PRODUCTION_OFFICIAL_N_TARGET,
  SHIPPED_CHAMPION_CONSTANTS,
  assertCalibrationOutputNotInDataDir,
  calibrateChampion,
  classifyPublishedMapping,
  documentedSampleLedgerPath,
  eloToLambdasWithConstants,
  latestMarketNoVig,
  loadClubSeasonLedgerFromPath,
  officialCalibrationRows,
  resolveCalibrationLedger,
  writeChampionCalibrationArtifacts,
} from "./champion-calibration";

const ARTIFACT_SHA = "a".repeat(64);

function officialModel(overrides: Partial<ModelFixture> = {}): ModelFixture {
  return {
    competitionId: "eng.1",
    competition: "Premier League",
    fixtureId: 101,
    utcDate: "2026-08-15T14:00:00.000Z",
    date: "2026-08-15",
    group: null,
    stage: "match",
    home: "Arsenal",
    away: "Liverpool",
    homeElo: 1850,
    awayElo: 1840,
    pHome: 0.42,
    pDraw: 0.28,
    pAway: 0.3,
    pOver2_5: 0.55,
    pUnder2_5: 0.45,
    pBttsYes: 0.58,
    pBttsNo: 0.42,
    topScores: [{ score: "1-1", probability: 0.12 }],
    scorelines: [{ score: "1-1", probability: 0.12 }],
    stakePHome: null,
    stakePDraw: null,
    stakePAway: null,
    result: { homeScore: 2, awayScore: 1, status: "FINISHED", winner: "Arsenal" },
    forecastProvenance: {
      modelId: "pundit-fundamental",
      modelVersion: "2",
      contributorId: "clubelo",
      contributorVersion: "1",
      methodId: "clubelo-elo-to-goals-dixon-coles",
      forecastAt: "2026-08-15T13:30:00.000Z",
      ratingProfile: "eng-clubs",
      ratingSnapshotAt: "2026-08-15T13:00:00.000Z",
      ratingAgeMinutes: 30,
      ratingSourceState: "artifact",
      ratingArtifactId: `clubelo@1:${ARTIFACT_SHA}`,
      ratingArtifactSha256: ARTIFACT_SHA,
      homeAdvantageElo: 42,
      config: ELO_CHAMPION_CONFIG,
    },
    ...overrides,
  };
}

function writeLedger(fixtures: ReturnType<typeof buildSnapshotFromModel>[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pundit-cal-"));
  const filePath = path.join(dir, "club-season.json");
  fs.writeFileSync(filePath, JSON.stringify({
    schemaVersion: 2,
    competitions: ["eng.1"],
    method: "snapshot",
    builtAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z",
    fixtures,
    missedCheckpoints: [],
  }));
  return filePath;
}

describe("champion calibration", () => {
  it("keeps kappa=0 identical to production eloToLambdas", () => {
    expect(eloToLambdasWithConstants(1532.9, 1915.3, 42, SHIPPED_CHAMPION_CONSTANTS))
      .toEqual(eloToLambdas(1532.9, 1915.3, 42));
    expect(SHIPPED_CHAMPION_CONSTANTS).toEqual({
      baseGoals: BASE_GOALS,
      homeAdvantageElo: DEFAULT_HOME_ADVANTAGE_ELO,
      rho: RHO,
      mismatchInflation: 0,
    });
  });

  it("inflates totals on mismatches without restoring geometric-mean lambdas", () => {
    const [fixedHome, fixedAway] = eloToLambdas(1532.9, 1915.3, 42);
    const [mildHome, mildAway] = eloToLambdasWithConstants(1532.9, 1915.3, 42, {
      ...SHIPPED_CHAMPION_CONSTANTS,
      mismatchInflation: 0.2,
    });
    const geometric = 10 ** ((1532.9 + 42 - 1915.3) / 800);
    const geometricHome = BASE_GOALS * geometric;
    const geometricAway = BASE_GOALS / geometric;
    expect(mildHome + mildAway).toBeGreaterThan(fixedHome + fixedAway);
    expect(mildHome + mildAway).toBeLessThan(geometricHome + geometricAway);
    expect(mildHome / mildAway).toBeCloseTo(fixedHome / fixedAway, 12);
  });

  it("fits only official sealed rows with results", () => {
    const official = buildSnapshotFromModel(officialModel(), "2026-08-15T13:31:00.000Z");
    const legacy = buildSnapshotFromModel(officialModel({
      fixtureId: 301,
      forecastProvenance: undefined,
      result: { homeScore: 1, awayScore: 0, status: "FINISHED", winner: "Arsenal" },
    }), "2026-08-15T13:31:00.000Z");
    const postKickoff = buildSnapshotFromModel(officialModel({
      fixtureId: 401,
      forecastProvenance: {
        ...officialModel().forecastProvenance!,
        forecastAt: "2026-08-15T14:00:00.000Z",
      },
    }), "2026-08-15T14:01:00.000Z");
    const incomplete = buildSnapshotFromModel(officialModel({
      fixtureId: 501,
      forecastProvenance: {
        ...officialModel().forecastProvenance!,
        ratingSourceState: "unknown",
        ratingSnapshotAt: null,
        ratingAgeMinutes: null,
      },
    }), "2026-08-15T13:31:00.000Z");
    const ledgerPath = writeLedger([official, legacy, postKickoff, incomplete]);
    const report = calibrateChampion({ ledgerPath, bootstrapDraws: 0, allowSampleFallback: false });
    expect(report.ledger.officialWithResultN).toBe(1);
    expect(report.ledger.excluded.byReason.legacyPartialProvenance).toBe(1);
    expect(report.ledger.excluded.byReason.postKickoffForecast).toBe(1);
    expect(report.ledger.excluded.byReason.incompleteInputProvenance).toBe(1);
    expect(report.decision.changeShippedConstants).toBe(false);
    expect(report.decision.rebuildGoldenCutover).toBe(false);
    expect(report.config.productionAutoLoad).toBe(false);
  });

  it("falls back to the documented sample when the in-repo ledger has 0 official fixtures", () => {
    const emptyPath = writeLedger([]);
    const resolved = resolveCalibrationLedger({ ledgerPath: emptyPath });
    expect(resolved.usedDocumentedSample).toBe(true);
    expect(resolved.path).toBe(documentedSampleLedgerPath());
    const report = calibrateChampion({ ledgerPath: emptyPath, bootstrapDraws: 0 });
    expect(report.ledger.usedDocumentedSample).toBe(true);
    expect(report.ledger.officialWithResultN).toBeGreaterThan(0);
    expect(report.ledger.productionOfficialNTarget).toBe(PRODUCTION_OFFICIAL_N_TARGET);
    expect(report.ledger.productionDataDirHint).toBe("PUNDIT_DATA_DIR=/data");
    expect(officialCalibrationRows(loadClubSeasonLedgerFromPath(documentedSampleLedgerPath())).length)
      .toBeGreaterThan(0);
  });

  it("reports 3-way Brier/log-loss vs market no-vig and Elo-gap reliability", () => {
    const withMarket = buildSnapshotFromModel(
      officialModel({
        marketComparisons: undefined,
      }),
      "2026-08-15T13:31:00.000Z",
      "scheduled_window",
      [{
        source: "polymarket",
        sourceTimestamp: "2026-08-15T13:32:00.000Z",
        pHome: 0.45,
        pDraw: 0.28,
        pAway: 0.27,
      }]
    );
    const mismatch = buildSnapshotFromModel(officialModel({
      fixtureId: 102,
      home: "Hull",
      away: "Man United",
      homeElo: 1532.9,
      awayElo: 1915.3,
      result: { homeScore: 0, awayScore: 2, status: "FINISHED", winner: "Man United" },
    }), "2026-08-15T13:31:00.000Z");
    const ledgerPath = writeLedger([withMarket, mismatch]);
    const report = calibrateChampion({ ledgerPath, bootstrapDraws: 0, allowSampleFallback: false });
    expect(report.metrics.vsMarketNoVig.shippedRecomputed.n).toBe(1);
    expect(report.metrics.vsMarketNoVig.shippedRecomputed.model.brier).not.toBeNull();
    expect(report.metrics.vsMarketNoVig.shippedRecomputed.market.brier).not.toBeNull();
    expect(report.metrics.reliabilityByEloGap.shippedRecomputed.some((bucket) => bucket.n > 0)).toBe(true);
    expect(report.metrics.reliabilityByEloGap.shippedRecomputed.every((bucket) => (
      "over25" in bucket && "oneXTwo" in bucket
    ))).toBe(true);
  });

  it("does not recommend shipping constants below the PL volume bar", () => {
    const rows = [0, 1, 2].map((index) => buildSnapshotFromModel(officialModel({
      fixtureId: 200 + index,
      utcDate: `2026-08-1${5 + index}T14:00:00.000Z`,
      forecastProvenance: {
        ...officialModel().forecastProvenance!,
        forecastAt: `2026-08-1${5 + index}T13:30:00.000Z`,
      },
    }), `2026-08-1${5 + index}T13:31:00.000Z`));
    const report = calibrateChampion({
      ledgerPath: writeLedger(rows),
      bootstrapDraws: 0,
      allowSampleFallback: false,
    });
    expect(report.ledger.premierLeagueN).toBe(3);
    expect(report.decision.recommendProductionChange).toBe(false);
    expect(report.decision.reasons.some((reason) => reason.includes("below the ~40"))).toBe(true);
  });

  it("classifies sealed Hull-style geometric 1X2 as the old mapping", () => {
    const row = buildSnapshotFromModel(officialModel({
      home: "Hull",
      away: "Man United",
      homeElo: 1532.9,
      awayElo: 1915.3,
      pHome: 0.0201,
      pDraw: 0.0696,
      pAway: 0.9103,
    }), "2026-08-15T13:31:00.000Z");
    expect(classifyPublishedMapping(row)).toBe("geometricMeanLambdas");
  });

  it("averages the latest no-vig line per source", () => {
    expect(latestMarketNoVig([
      { source: "polymarket", sourceTimestamp: "2026-08-15T13:00:00.000Z", pHome: 0.2, pDraw: 0.2, pAway: 0.6 },
      { source: "polymarket", sourceTimestamp: "2026-08-15T13:30:00.000Z", pHome: 0.4, pDraw: 0.3, pAway: 0.3 },
      { source: "kalshi", sourceTimestamp: "2026-08-15T13:10:00.000Z", pHome: 0.5, pDraw: 0.25, pAway: 0.25 },
    ])).toEqual({ pHome: 0.45, pDraw: 0.275, pAway: 0.275 });
  });

  it("refuses to write artifacts into PUNDIT_DATA_DIR", () => {
    const previous = process.env.PUNDIT_DATA_DIR;
    process.env.PUNDIT_DATA_DIR = "/data";
    try {
      expect(() => assertCalibrationOutputNotInDataDir("/data/evaluation")).toThrow(/PUNDIT_DATA_DIR/);
    } finally {
      if (previous === undefined) delete process.env.PUNDIT_DATA_DIR;
      else process.env.PUNDIT_DATA_DIR = previous;
    }
  });

  it("writes a research config that production model selection does not import", () => {
    const ledgerPath = writeLedger([
      buildSnapshotFromModel(officialModel(), "2026-08-15T13:31:00.000Z"),
    ]);
    const report = calibrateChampion({ ledgerPath, bootstrapDraws: 0, allowSampleFallback: false });
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "pundit-cal-out-"));
    const paths = writeChampionCalibrationArtifacts(report, outDir);
    expect(fs.existsSync(paths.reportJson)).toBe(true);
    expect(fs.existsSync(paths.reportMarkdown)).toBe(true);
    expect(fs.existsSync(paths.configJson)).toBe(true);
    const modelData = fs.readFileSync(path.join(__dirname, "model-data.ts"), "utf8");
    const contributors = fs.readFileSync(path.join(__dirname, "model-contributors.ts"), "utf8");
    const dixonColes = fs.readFileSync(path.join(__dirname, "dixon-coles.ts"), "utf8");
    expect(modelData).not.toMatch(/champion-calibration/);
    expect(contributors).not.toMatch(/champion-calibration/);
    expect(dixonColes).toMatch(/const BASE_GOALS = 1\.35/);
    expect(REGISTERED_CHALLENGERS).toHaveLength(1);
    expect(REGISTERED_CHALLENGERS[0]?.id).toBe(FITTED_DIXON_COLES_CONTRIBUTOR_ID);
    expect(REGISTERED_CHALLENGERS[0]?.status).toBe("challenger");
    expect(REGISTERED_CHALLENGERS[0]?.id).not.toBe(ELO_CHAMPION.id);
  });
});
