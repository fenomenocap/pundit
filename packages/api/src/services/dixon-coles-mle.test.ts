import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HistoricalFixture } from "./club-history-corpus";
import { PreKickoffEloRow } from "./clubelo-pre-kickoff-corpus";
import {
  DIXON_COLES_MLE_ARTIFACT_SHA256,
  ELO_CHAMPION,
  REGISTERED_CHALLENGERS,
} from "./model-contributors";
import { FITTED_DIXON_COLES_CONTRIBUTOR_ID } from "./dixon-coles-mle";
import {
  DEFAULT_CLUB_ELO_PRIOR_STRENGTH,
  FITTED_DIXON_COLES_METHOD_ID,
  FIT_SCOPE_ALL_JOINED_PL_ROWS,
  FIT_SCOPE_JOINED_WITH_PRE_KICKOFF_ELO,
  assertJoinedTrainingRowsComplete,
  clubEloAttackDefencePrior,
  clubEloPriorPrecision,
  fitTimeDecayedDixonColes,
  joinTrainingRows,
  resolveOfflineTrainingMode,
  rollingOriginSplit,
  timeDecayWeight,
  trainFittedDixonColes,
} from "./dixon-coles-mle";

function historyFixture(
  id: string,
  kickoff: string,
  homeGoals: number,
  awayGoals: number,
  homeName = "Hull",
  awayName = "Man United"
): HistoricalFixture {
  return {
    source: "espn",
    sourceEventId: id,
    sourceEventUid: `event:${id}`,
    competitionId: "eng.1",
    seasonId: "2024-25",
    eventSeasonYear: 2024,
    kickoff,
    home: { sourceTeamId: homeName, sourceName: homeName, canonicalName: homeName },
    away: { sourceTeamId: awayName, sourceName: awayName, canonicalName: awayName },
    homeGoals,
    awayGoals,
    finalStatusName: "STATUS_FULL_TIME",
    finalStatusDetail: "FT",
    trainingEligible: true,
    regulationTimeScore: true,
    wasSuspended: null,
    neutralSite: null,
    venue: { sourceVenueId: null, name: null },
  };
}

function eloRow(
  id: string,
  kickoff: string,
  homeName: string,
  awayName: string,
  homeElo: number,
  awayElo: number
): PreKickoffEloRow {
  return {
    sourceEventId: id,
    competitionId: "eng.1",
    seasonId: "2024-25",
    kickoff,
    homeCanonicalName: homeName,
    awayCanonicalName: awayName,
    ratingProfile: "eng-clubs",
    rankingDate: kickoff.slice(0, 10) < "2024-08-17" ? "2024-08-16" : "2024-12-31",
    homeElo,
    awayElo,
  };
}

const CITY = 1920;
const UNITED = 1850;
const VILLA = 1780;
const HULL = 1540;

function establishedFixtures(): {
  fixtures: HistoricalFixture[];
  preKickoffRows: PreKickoffEloRow[];
} {
  const matches: Array<[string, string, string, string, number, number, number, number]> = [
    ["1", "2024-08-17T14:00:00Z", "Man City", "Aston Villa", 2, 0, CITY, VILLA],
    ["2", "2024-08-24T14:00:00Z", "Man United", "Aston Villa", 2, 0, UNITED, VILLA],
    ["3", "2024-08-31T14:00:00Z", "Man City", "Man United", 2, 1, CITY, UNITED],
    ["4", "2024-09-14T14:00:00Z", "Aston Villa", "Man United", 1, 1, VILLA, UNITED],
    ["5", "2024-09-21T14:00:00Z", "Aston Villa", "Man City", 0, 2, VILLA, CITY],
    ["6", "2024-09-28T14:00:00Z", "Man United", "Man City", 1, 2, UNITED, CITY],
    ["7", "2024-10-05T14:00:00Z", "Man City", "Aston Villa", 3, 0, CITY, VILLA],
    ["8", "2024-10-19T14:00:00Z", "Man United", "Aston Villa", 1, 0, UNITED, VILLA],
    ["9", "2025-08-16T14:00:00Z", "Hull", "Man City", 0, 3, HULL, CITY],
  ];
  return {
    fixtures: matches.map(([id, kickoff, home, away, hg, ag]) => (
      historyFixture(id, kickoff, hg, ag, home, away)
    )),
    preKickoffRows: matches.map(([id, kickoff, home, away, , , homeElo, awayElo]) => (
      eloRow(id, kickoff, home, away, homeElo, awayElo)
    )),
  };
}

describe("fitted Dixon-Coles trainer", () => {
  it("fails closed without research artifacts and does not invent parameters", () => {
    const result = trainFittedDixonColes({});
    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("missing-research-artifacts");
    expect(result.artifact).toBeNull();
  });

  it("blocks when the ClubElo pre-kickoff corpus is incomplete with no joinable rows", () => {
    const result = trainFittedDixonColes({
      historyStatus: "pass",
      preKickoffStatus: "fail",
      requiredMissingCount: 12,
      requiredCoveredCount: 0,
    });
    expect(result).toMatchObject({
      status: "blocked",
      reason: "pre-kickoff-elo-incomplete",
      artifact: null,
    });
  });

  it("trains on joined rows only when required fixtures lack Elo (590/760 path)", () => {
    const { fixtures, preKickoffRows } = establishedFixtures();
    const gate = resolveOfflineTrainingMode({
      historyStatus: "inconclusive",
      preKickoffStatus: "fail",
      requiredMissingCount: 170,
      requiredCoveredCount: 590,
      inventedRatingCount: 0,
      eligibleForOfflineTraining: true,
    });
    expect(gate).toEqual({ ok: true, mode: "partial-exclude-incomplete" });
    const joined = joinTrainingRows(fixtures, preKickoffRows);
    expect(assertJoinedTrainingRowsComplete(joined).ok).toBe(true);
    const result = trainFittedDixonColes({
      historyStatus: "inconclusive",
      preKickoffStatus: "fail",
      requiredMissingCount: 170,
      requiredCoveredCount: 590,
      inventedRatingCount: 0,
      eligibleForOfflineTraining: true,
      fixtures,
      preKickoffRows,
      clubHistoryDatasetSha256: "history-test",
      preKickoffEloDatasetSha256: "elo-test",
      rollingOrigins: ["2025-08-01T00:00:00.000Z"],
    });
    expect(result.status).toBe("trained");
    expect(result.trainingRowCount).toBe(9);
    expect(result.artifact?.training.fitScope).toBe(FIT_SCOPE_JOINED_WITH_PRE_KICKOFF_ELO);
    expect(result.artifact?.training.excludedFixtureCount).toBe(170);
    expect(result.artifact?.training.plFixtureCoverage).toEqual({ covered: 590, n: 760 });
  });

  it("does not invent Elo for fixtures excluded from the partial join", () => {
    const { fixtures, preKickoffRows } = establishedFixtures();
    const joinedIds = new Set(joinTrainingRows(fixtures, preKickoffRows).map((row) => row.sourceEventId));
    expect(joinedIds.size).toBe(9);
    expect(fixtures.some((fixture) => fixture.trainingEligible
      && fixture.competitionId === "eng.1"
      && !joinedIds.has(fixture.sourceEventId))).toBe(false);
  });

  it("blocks when the ESPN history corpus is not eligible for offline training", () => {
    const result = trainFittedDixonColes({
      historyStatus: "inconclusive",
      preKickoffStatus: "pass",
      requiredMissingCount: 0,
      eligibleForOfflineTraining: false,
    });
    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("club-history-not-pass");
  });

  it("joins PL regulation-time fixtures to pre-kickoff Elo and splits chronologically", () => {
    const rows = joinTrainingRows(
      [
        historyFixture("early", "2024-08-17T14:00:00Z", 0, 2),
        historyFixture("late", "2025-01-01T15:00:00Z", 1, 1),
        { ...historyFixture("ucl", "2024-08-17T14:00:00Z", 1, 0), competitionId: "uefa.champions_qual" },
      ],
      [
        eloRow("early", "2024-08-17T14:00:00Z", "Hull", "Man United", 1532.88, 1915.316),
        eloRow("late", "2025-01-01T15:00:00Z", "Hull", "Man United", 1532.88, 1915.316),
      ]
    );
    expect(rows.map((row) => row.sourceEventId)).toEqual(["early", "late"]);
    const split = rollingOriginSplit(rows, "2025-01-01T00:00:00Z");
    expect(split.trainEventIds).toEqual(["early"]);
    expect(split.holdoutEventIds).toEqual(["late"]);
  });

  it("decays older matches and strengthens the ClubElo prior for low-sample clubs", () => {
    expect(timeDecayWeight("2024-08-17T14:00:00Z", "2025-08-17T14:00:00Z", 0.0065))
      .toBeCloseTo(Math.exp(-0.0065 * 365), 6);
    expect(clubEloPriorPrecision(0, DEFAULT_CLUB_ELO_PRIOR_STRENGTH))
      .toBeGreaterThan(clubEloPriorPrecision(38, DEFAULT_CLUB_ELO_PRIOR_STRENGTH));
    const hullPrior = clubEloAttackDefencePrior(1540, 1800);
    const cityPrior = clubEloAttackDefencePrior(1920, 1800);
    expect(cityPrior.attack).toBeGreaterThan(hullPrior.attack);
    expect(hullPrior.defence).toBeGreaterThan(cityPrior.defence);
  });

  it("fits attack/defence MLE and keeps a Hull-type club near its ClubElo prior", () => {
    const { fixtures, preKickoffRows } = establishedFixtures();
    const result = trainFittedDixonColes({
      historyStatus: "inconclusive",
      preKickoffStatus: "pass",
      requiredMissingCount: 0,
      eligibleForOfflineTraining: true,
      fixtures,
      preKickoffRows,
      clubHistoryDatasetSha256: "history-test",
      preKickoffEloDatasetSha256: "elo-test",
      rollingOrigins: ["2025-08-01T00:00:00.000Z"],
    });
    expect(result.status).toBe("trained");
    expect(result.trainingRowCount).toBe(9);
    const params = result.artifact?.params;
    expect(params).toBeDefined();
    if (!params) throw new Error("expected fitted params");
    expect(params.attack["Man City"]).toBeGreaterThan(params.attack["Aston Villa"]);
    expect(params.attack["Man City"]).toBeGreaterThan(params.attack.Hull);
    expect(params.homeAdvantage).toBeGreaterThan(0);
    const meanElo = (CITY + UNITED + VILLA + HULL) / 4;
    const hullPrior = clubEloAttackDefencePrior(HULL, meanElo);
    expect(Math.abs(params.attack.Hull - hullPrior.attack)).toBeLessThan(0.45);
    expect(result.artifact?.training.splitManifest[0]?.holdoutEventIds).toEqual(["9"]);
    expect(result.artifact?.contributor.methodId).toBe(FITTED_DIXON_COLES_METHOD_ID);
    expect(result.artifact?.contributor.status).toBe("challenger");
  });

  it("pulls a one-match promoted club toward ClubElo harder than an unconstrained shock", () => {
    const { fixtures, preKickoffRows } = establishedFixtures();
    const shock = historyFixture("shock", "2025-08-17T14:00:00Z", 5, 0, "Hull", "Man City");
    const shockElo = eloRow("shock", "2025-08-17T14:00:00Z", "Hull", "Man City", HULL, CITY);
    const weakPrior = fitTimeDecayedDixonColes(
      joinTrainingRows([...fixtures, shock], [...preKickoffRows, shockElo]),
      { clubEloPriorStrength: 0.5, timeDecayXi: 0 }
    );
    const strongPrior = fitTimeDecayedDixonColes(
      joinTrainingRows([...fixtures, shock], [...preKickoffRows, shockElo]),
      { clubEloPriorStrength: 24, timeDecayXi: 0 }
    );
    expect(strongPrior.params.attack.Hull).toBeLessThan(weakPrior.params.attack.Hull);
  });

  it("writes a content-addressed artifact and split manifest without registering a challenger", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pundit-mle-"));
    const { fixtures, preKickoffRows } = establishedFixtures();
    const result = trainFittedDixonColes({
      historyStatus: "pass",
      preKickoffStatus: "pass",
      requiredMissingCount: 0,
      fixtures,
      preKickoffRows,
      dataDir: root,
    });
    expect(result.status).toBe("trained");
    const latest = JSON.parse(
      fs.readFileSync(path.join(root, "research/dixon-coles-mle/latest.json"), "utf8")
    ) as { artifactPath: string; artifactSha256: string };
    expect(fs.existsSync(path.join(root, "research/dixon-coles-mle", latest.artifactPath))).toBe(true);
    expect(fs.existsSync(path.join(root, "research/dixon-coles-mle/splits.json"))).toBe(true);
    expect(latest.artifactPath).toBe(`${latest.artifactSha256}.json`);
  });

  it("loads a reviewed artifact when one already exists and keeps the method id stable", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pundit-mle-"));
    const dir = path.join(root, "research/dixon-coles-mle");
    fs.mkdirSync(dir, { recursive: true });
    const artifact = {
      schemaVersion: 1,
      contributor: {
        id: "dixon-coles-mle",
        methodId: FITTED_DIXON_COLES_METHOD_ID,
        status: "challenger",
      },
      params: {
        intercept: 0,
        homeAdvantage: 0,
        rho: 0,
        timeDecayXi: 0,
        attack: {},
        defence: {},
        clubEloPriorStrength: 0,
      },
      training: {
        clubHistoryDatasetSha256: "abc",
        preKickoffEloDatasetSha256: "def",
        splitManifest: [],
        rowCount: 0,
        clubCount: 0,
        fitScope: FIT_SCOPE_ALL_JOINED_PL_ROWS,
        excludedFixtureCount: 0,
        plFixtureCoverage: { covered: 0, n: 0 },
        converged: true,
        iterations: 0,
        logLikelihood: 0,
      },
    };
    fs.writeFileSync(path.join(dir, "artifact.json"), JSON.stringify(artifact));
    fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify({ artifactPath: "artifact.json" }));
    const result = trainFittedDixonColes({ dataDir: root });
    expect(result.status).toBe("trained");
    expect(result.artifact?.contributor.methodId).toBe(FITTED_DIXON_COLES_METHOD_ID);
  });

  it("is not imported by production model selection", () => {
    const modelData = fs.readFileSync(path.join(__dirname, "model-data.ts"), "utf8");
    const contributors = fs.readFileSync(path.join(__dirname, "model-contributors.ts"), "utf8");
    const index = fs.readFileSync(path.join(__dirname, "../index.ts"), "utf8");
    expect(modelData).not.toMatch(/dixon-coles-mle/);
    expect(modelData).not.toMatch(/challenger-eval/);
    expect(contributors).toMatch(/REGISTERED_DIXON_COLES_MLE/);
    expect(contributors).not.toMatch(/challenger-eval/);
    expect(index).not.toMatch(/dixon-coles-mle/);
    expect(index).not.toMatch(/challenger-eval/);
    expect(REGISTERED_CHALLENGERS).toHaveLength(1);
    expect(REGISTERED_CHALLENGERS[0]?.id).toBe(FITTED_DIXON_COLES_CONTRIBUTOR_ID);
    expect(REGISTERED_CHALLENGERS[0]?.version).toBe(DIXON_COLES_MLE_ARTIFACT_SHA256);
    expect(REGISTERED_CHALLENGERS[0]?.status).toBe("challenger");
    expect(REGISTERED_CHALLENGERS[0]?.id).not.toBe(ELO_CHAMPION.id);
  });
});
