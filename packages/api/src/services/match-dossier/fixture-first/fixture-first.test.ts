import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixture } from "../../__fixtures__/model-fixture";
import type { FootballMatch } from "../../football-data";
import { buildMatchDossierForFixture } from "../builder";
import {
  loadFplBootstrapFromRecordedFixture,
  resetFplBootstrapCacheForTests,
  setFplBootstrapCacheForTests,
} from "../fpl-bootstrap-injuries";
import { resolveFplTeamIdForFixtureSide } from "../fpl-team-map";
import { buildFixtureFirstTeamNews } from "./build-team-news";
import { resolveFixtureIdentity } from "./fixture-identity";
import { buildInjuriesDoubtsTeamNews } from "./injuries-doubts";
import {
  loadPlFixturesFromRecordedFixture,
  resetPlFixturesCacheForTests,
  setPlFixturesCacheForTests,
} from "./pl-fixtures-client";
import { passesFixtureFirstFreshness, previousMatchKickoffUtc } from "./previous-match-cutoff";
import { sourceGroupForField, getSourceGroup } from "./source-groups";

const ENV_KEYS = [
  "MATCH_DOSSIER_FIXTURE_FIRST_ENABLED",
  "MATCH_DOSSIER_FPL_ENABLED",
  "MATCH_DOSSIER_EVIDENCE_ENABLED",
] as const;

function scheduleWithPrevious(params: {
  home: string;
  away: string;
  kickoffUtc: string;
  previousHomeKickoff: string;
  previousAwayKickoff: string;
}): FootballMatch[] {
  return [
    {
      id: 1,
      competitionId: "eng.1",
      competition: "Premier League",
      homeTeam: params.home,
      awayTeam: "Opponent A",
      utcDate: params.previousHomeKickoff,
      status: "FINISHED",
      stage: null,
      matchday: 1,
      group: null,
      score: { home: 2, away: 1 },
    },
    {
      id: 2,
      competitionId: "eng.1",
      competition: "Premier League",
      homeTeam: "Opponent B",
      awayTeam: params.away,
      utcDate: params.previousAwayKickoff,
      status: "FINISHED",
      stage: null,
      matchday: 1,
      group: null,
      score: { home: 0, away: 3 },
    },
    {
      id: 3,
      competitionId: "eng.1",
      competition: "Premier League",
      homeTeam: params.home,
      awayTeam: params.away,
      utcDate: params.kickoffUtc,
      status: "SCHEDULED",
      stage: null,
      matchday: 2,
      group: null,
      score: null,
    },
  ];
}

describe("fixture-first team news (source groups)", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    resetFplBootstrapCacheForTests();
    resetPlFixturesCacheForTests();
    process.env.MATCH_DOSSIER_EVIDENCE_ENABLED = "false";
    process.env.MATCH_DOSSIER_FPL_ENABLED = "false";
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("maps injuries_doubts and fixture_identity groups by field", () => {
    expect(sourceGroupForField("fixtureIdentity")).toBe("fixture_identity");
    expect(sourceGroupForField("teamNews")).toBe("injuries_doubts");
    expect(getSourceGroup("injuries_doubts").primary).toBe("fpl");
    expect(getSourceGroup("fixture_identity").primary).toBe("pl-api");
  });

  it("joins Coventry, Hull and Ipswich by FPL team id for team news", () => {
    const snapshot = loadFplBootstrapFromRecordedFixture();
    expect(resolveFplTeamIdForFixtureSide("Coventry", snapshot)).toBe(7);
    expect(resolveFplTeamIdForFixtureSide("Hull", snapshot)).toBe(11);
    expect(resolveFplTeamIdForFixtureSide("Ipswich", snapshot)).toBe(12);
    const row = fixture("Coventry", "Hull", { utcDate: "2026-10-24T15:00:00.000Z" });
    setPlFixturesCacheForTests({ content: [] }, "2026-10-21T12:00:00.000Z");
    const bundle = buildFixtureFirstTeamNews({
      fixture: row,
      fplSnapshot: snapshot,
      plPayload: { content: [] },
      schedule: [],
      fetchedAt: "2026-10-21T12:00:00.000Z",
    });
    expect(bundle.items.map((i) => i.player).sort()).toEqual(["Hamer", "HullStriker"]);
    expect(bundle.identity.resolvedVia).toBe("espn");
  });

  it("resolves Chelsea v Spurs 24 Oct via pl-api primary", () => {
    const snapshot = loadFplBootstrapFromRecordedFixture();
    const pl = loadPlFixturesFromRecordedFixture();
    const row = fixture("Chelsea", "Tottenham", {
      fixtureId: 401879800,
      utcDate: "2026-10-24T17:30:00.000Z",
    });
    const { identity, fetchLogs } = resolveFixtureIdentity({
      fixture: row,
      fplSnapshot: snapshot,
      plPayload: pl,
      fetchedAt: "2026-10-21T12:00:00.000Z",
    });
    expect(identity.plMatchId).toBe("479421");
    expect(identity.resolvedVia).toBe("pl-api");
    expect(identity.espnEventId).toBe(401879800);
    expect(fetchLogs.some((log) => log.sourceKey === "pl-api")).toBe(true);
    expect(fetchLogs[0]?.query).toContain("Chelsea v Tottenham");
  });

  it("drops stale FPL rows before each club's previous match", () => {
    const snapshot = loadFplBootstrapFromRecordedFixture();
    const row = fixture("Chelsea", "Tottenham", { utcDate: "2026-10-24T17:30:00.000Z" });
    const schedule = scheduleWithPrevious({
      home: "Chelsea",
      away: "Tottenham",
      kickoffUtc: row.utcDate,
      previousHomeKickoff: "2026-10-19T15:00:00.000Z",
      previousAwayKickoff: "2026-10-19T17:30:00.000Z",
    });
    expect(previousMatchKickoffUtc("Chelsea", row.utcDate, schedule)).toBe("2026-10-19T15:00:00.000Z");
    expect(passesFixtureFirstFreshness({
      sourceTimestampIso: "2026-10-10T09:00:00.000Z",
      kickoffUtc: row.utcDate,
      homePreviousKickoffUtc: "2026-10-19T15:00:00.000Z",
      awayPreviousKickoffUtc: "2026-10-19T17:30:00.000Z",
    })).toBe(false);
    const { items } = buildInjuriesDoubtsTeamNews({
      fixture: row,
      identity: {
        plMatchId: "479421",
        espnEventId: row.fixtureId,
        fotmobMatchId: null,
        goalMatchUuid: null,
        bbcTipoId: null,
        homeFplTeamId: 6,
        awayFplTeamId: 18,
        resolvedVia: "pl-api",
      },
      fplSnapshot: snapshot,
      schedule,
      fetchedAt: "2026-10-21T12:00:00.000Z",
    });
    expect(items.some((i) => i.player === "StaleChe")).toBe(false);
    expect(items.some((i) => i.player === "James")).toBe(true);
    expect(items.some((i) => i.player === "Porro")).toBe(true);
  });

  it("logs fetchedAt, source timestamp and exact query on team news fetches", () => {
    const snapshot = loadFplBootstrapFromRecordedFixture();
    const pl = loadPlFixturesFromRecordedFixture();
    const row = fixture("Chelsea", "Tottenham", { utcDate: "2026-10-24T17:30:00.000Z" });
    const bundle = buildFixtureFirstTeamNews({
      fixture: row,
      fplSnapshot: snapshot,
      plPayload: pl,
      schedule: scheduleWithPrevious({
        home: "Chelsea",
        away: "Tottenham",
        kickoffUtc: row.utcDate,
        previousHomeKickoff: "2026-10-19T15:00:00.000Z",
        previousAwayKickoff: "2026-10-19T17:30:00.000Z",
      }),
      fetchedAt: "2026-10-21T12:00:00.000Z",
    });
    const fplLog = bundle.fetchLogs.find((log) => log.sourceKey === "fpl")!;
    expect(fplLog.fetchedAt).toBe("2026-10-21T12:00:00.000Z");
    expect(fplLog.sourceTimestamp).toBe("2026-10-22T09:00:00.000Z");
    expect(fplLog.query).toBe(
      "Chelsea v Tottenham Premier League 2026-10-24 team news injuries",
    );
  });

  it("does not attach fixture-first fields when flag is off", () => {
    process.env.MATCH_DOSSIER_FIXTURE_FIRST_ENABLED = "false";
    setFplBootstrapCacheForTests(loadFplBootstrapFromRecordedFixture());
    setPlFixturesCacheForTests(loadPlFixturesFromRecordedFixture(), "2026-10-21T12:00:00.000Z");
    const row = fixture("Chelsea", "Tottenham", { utcDate: "2026-10-24T17:30:00.000Z" });
    const dossier = buildMatchDossierForFixture(row);
    expect(dossier.fixtureIdentity).toBeUndefined();
    expect(dossier.teamNews).toBeUndefined();
    expect(dossier.injuries.value.items.some((i) => i.source === "fpl-bootstrap-static")).toBe(false);
  });

  it("builds teamNews and fixtureIdentity on dossier when flag is on", () => {
    process.env.MATCH_DOSSIER_FIXTURE_FIRST_ENABLED = "true";
    setFplBootstrapCacheForTests(loadFplBootstrapFromRecordedFixture());
    setPlFixturesCacheForTests(loadPlFixturesFromRecordedFixture(), "2026-10-21T12:00:00.000Z");
    const row = fixture("Chelsea", "Tottenham", {
      fixtureId: 401879800,
      utcDate: "2026-10-24T17:30:00.000Z",
    });
    const dossier = buildMatchDossierForFixture(row, {
      now: new Date("2026-10-21T12:00:00.000Z"),
    });
    expect(dossier.fixtureIdentity?.value.plMatchId).toBe("479421");
    expect(dossier.teamNews?.value.fetchLogs.length).toBeGreaterThanOrEqual(2);
    const james = dossier.teamNews!.value.items.find((i) => i.player === "James")!;
    expect(james.status).toBe("d");
    expect(james.newsAddedAt).toBe("2026-10-22T09:00:00.000Z");
    expect(james.source).toBe("fpl-bootstrap-static");
    expect(dossier.injuries.value.items.some((i) => i.player === "James")).toBe(true);
  });
});
