import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixture } from "../__fixtures__/model-fixture";
import {
  replaceFootballDataForTests,
  replaceSeasonScheduleForTests,
  type FootballMatch,
} from "../football-data";
import { replaceModelDataForTests } from "../model-data";
import { buildMatchDossierForFixture, filterFixturesInKickoffWindow, PHASE1_WEEKEND_WINDOW, publicFixtureId } from "./builder";
import { buildModelFactorBreakdown } from "./model-factor-breakdown";
import { readMatchDossier, writeMatchDossier } from "./storage";
import { matchDossierEnabled } from "./flags";
import { getMatchDossier } from "./index";

function finishedMatch(
  partial: Partial<FootballMatch> & Pick<FootballMatch, "id" | "homeTeam" | "awayTeam" | "utcDate">,
): FootballMatch {
  return {
    competitionId: "eng.1",
    competition: "Premier League",
    stage: null,
    matchday: null,
    group: null,
    status: "FINISHED",
    score: { home: 2, away: 1 },
    ...partial,
  };
}

describe("match dossier", () => {
  const prevEnv = process.env;
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pundit-dossier-"));
    process.env = { ...prevEnv, PUNDIT_DATA_DIR: dataDir, MATCH_DOSSIER_ENABLED: "true" };
  });

  afterEach(() => {
    process.env = prevEnv;
    fs.rmSync(dataDir, { recursive: true, force: true });
    replaceModelDataForTests({ fixtures: [], lastUpdated: null, error: null });
    replaceFootballDataForTests({
      byCompetition: {},
      upcoming: [],
      recent: [],
      standings: [],
      lastUpdated: null,
      error: null,
      competitionErrors: {},
    });
    replaceSeasonScheduleForTests({
      competitionId: "eng.1",
      seasonId: "2026-27",
      fixtures: [],
      lastUpdated: null,
      error: null,
      servingLastGood: false,
    });
  });

  it("buildModelFactorBreakdown separates Elo gap and home advantage", () => {
    const row = fixture("Tottenham Hotspur", "Coventry City", {
      homeElo: 1850,
      awayElo: 1620,
      pHome: 0.599,
      pDraw: 0.22,
      pAway: 0.181,
    });
    const breakdown = buildModelFactorBreakdown(row, 1.5, 1.2);
    expect(breakdown.reconciliation.deltaPHomePctResidual).toBe(0);
    expect(breakdown.counterfactualSteps.length).toBeGreaterThanOrEqual(2);
    const hfa = breakdown.counterfactualSteps.find((s) => s.factorId === "home-advantage");
    expect(hfa?.deltaPHomePct).not.toBe(0);
  });

  it("builds a typed dossier with provenance on every top-level field group", () => {
    replaceSeasonScheduleForTests({
      competitionId: "eng.1",
      seasonId: "2026-27",
      lastUpdated: new Date("2026-10-19T08:00:00Z"),
      error: null,
      servingLastGood: false,
      fixtures: [
        finishedMatch({
          id: 10,
          homeTeam: "Tottenham Hotspur",
          awayTeam: "Aston Villa",
          utcDate: "2026-10-12T14:00:00Z",
        }),
        finishedMatch({
          id: 11,
          homeTeam: "Coventry City",
          awayTeam: "Leeds United",
          utcDate: "2026-10-11T14:00:00Z",
          score: { home: 0, away: 2 },
        }),
      ],
    });
    replaceFootballDataForTests({
      byCompetition: {
        "eng.1": {
          upcoming: [],
          recent: [],
          standings: [
            {
              competitionId: "eng.1",
              position: 5,
              team: "Tottenham Hotspur",
              playedGames: 8,
              won: 4,
              draw: 2,
              lost: 2,
              points: 14,
              goalsFor: 14,
              goalsAgainst: 10,
              goalDifference: 4,
              group: null,
              advanced: false,
            },
          ],
          error: null,
        },
      },
    });

    const kickoff = "2026-10-24T15:00:00.000Z";
    const modelRow = fixture("Tottenham Hotspur", "Coventry City", {
      fixtureId: 401999001,
      utcDate: kickoff,
      date: kickoff.slice(0, 10),
      homeElo: 1850,
      awayElo: 1620,
      pHome: 0.599,
      pDraw: 0.22,
      pAway: 0.181,
    });
    replaceModelDataForTests({
      fixtures: [modelRow],
      lastUpdated: new Date("2026-10-19T08:00:00Z"),
      error: null,
    });

    const dossier = buildMatchDossierForFixture(modelRow, {
      scheduleReason: "manual",
      now: new Date("2026-10-19T09:00:00.000Z"),
    });

    expect(dossier.schemaVersion).toBe(1);
    expect(dossier.fixture.fixtureId).toBe(publicFixtureId(modelRow));
    expect(dossier.table.home.provenance.trustTier).toBe("fixture-spine");
    expect(dossier.model.value.factorBreakdown.shipped.pHome).toBe(0.599);
    expect(dossier.form.homeLast5.provenance.sourceId).toBe("espn-public-scoreboard");
    expect(dossier.market.provenance.trustTier).toBe("market-fetch");
    expect(dossier.evidence).toEqual([]);
    expect(dossier.featureCandidates.length).toBeGreaterThan(0);

    writeMatchDossier(dossier);
    const loaded = readMatchDossier(dossier.fixture.fixtureId);
    expect(loaded?.builtAt).toBe(dossier.builtAt);
  });

  it("filters Phase 1 weekend EPL window", () => {
    const inside = fixture("A", "B", { utcDate: "2026-10-24T15:00:00.000Z" });
    const outside = fixture("C", "D", { utcDate: "2026-10-27T15:00:00.000Z" });
    const filtered = filterFixturesInKickoffWindow([inside, outside], PHASE1_WEEKEND_WINDOW);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].home).toBe("A");
  });

  it("getMatchDossier returns null when flag is off", () => {
    process.env.MATCH_DOSSIER_ENABLED = "false";
    expect(matchDossierEnabled()).toBe(false);
    expect(getMatchDossier("espn:eng.1:1")).toBeNull();
  });
});
