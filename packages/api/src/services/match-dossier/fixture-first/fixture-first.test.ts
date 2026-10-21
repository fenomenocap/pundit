import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixture } from "../../__fixtures__/model-fixture";
import type { FootballMatch } from "../../football-data";
import { buildMatchDossierForFixture } from "../builder";
import {
  buildFplInjuryEvidenceForFixture,
  loadFplBootstrap841Recorded,
  loadFplBootstrapFromRecordedFixture,
  resetFplBootstrapCacheForTests,
  setFplBootstrapCacheForTests,
} from "../fpl-bootstrap-injuries";
import { resolveFplTeamIdForFixtureSide } from "../fpl-team-map";
import { buildFixtureFirstTeamNews } from "./build-team-news";
import { resolveFixtureIdentity } from "./fixture-identity";
import {
  applyFplTeamIdClubGuard,
  buildInjuriesDoubtsTeamNews,
} from "./injuries-doubts";
import {
  compSeasonLabelMatchesReference,
  findPlMatchInPayload,
  findPlMatchInPayloadUsingCodeJoin,
  loadPlFixtures841Recorded,
  loadPlFixturesFromRecordedFixture,
  premierLeagueSeasonStartYear,
  resetPlFixturesCacheForTests,
  resolvePlCompSeasonIdFromRows,
  setPlFixturesCacheForTests,
} from "./pl-fixtures-client";
import { passesFixtureFirstFreshness, previousMatchKickoffUtc } from "./previous-match-cutoff";
import { sourceGroupForField, getSourceGroup } from "./source-groups";
import type { DossierEvidenceItem } from "../types";

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
    vi.restoreAllMocks();
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

  it("resolves Chelsea v Spurs 24 Oct via pl-api primary (hand-made recorded fixture)", () => {
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
    expect(fetchLogs[0]?.url).toBe("https://footballapi.pulselive.com/football/fixtures/479421");
    expect(fetchLogs[0]?.query).toContain("Chelsea v Tottenham");
  });

  it("resolves GW8 plMatchIds 128993–129002 on real Pulselive 841 recorded slice", () => {
    const pl = loadPlFixtures841Recorded();
    const fpl = loadFplBootstrap841Recorded();
    const cases: Array<{ home: string; away: string; utc: string; plId: number }> = [
      { home: "Ipswich", away: "Forest", utc: "2026-10-23T19:00:00.000Z", plId: 128999 },
      { home: "Aston Villa", away: "Man City", utc: "2026-10-24T11:30:00.000Z", plId: 128994 },
      { home: "Arsenal", away: "Everton", utc: "2026-10-24T14:00:00.000Z", plId: 128993 },
      { home: "Coventry", away: "Fulham", utc: "2026-10-24T14:00:00.000Z", plId: 128996 },
      { home: "Chelsea", away: "Tottenham", utc: "2026-10-24T16:30:00.000Z", plId: 128995 },
      { home: "Crystal Palace", away: "Newcastle", utc: "2026-10-25T14:00:00.000Z", plId: 128997 },
      { home: "Hull", away: "Brentford", utc: "2026-10-25T14:00:00.000Z", plId: 128998 },
      { home: "Liverpool", away: "Brighton", utc: "2026-10-25T14:00:00.000Z", plId: 129000 },
      { home: "Man United", away: "Bournemouth", utc: "2026-10-25T14:00:00.000Z", plId: 129001 },
      { home: "Sunderland", away: "Leeds", utc: "2026-10-25T16:30:00.000Z", plId: 129002 },
    ];
    for (const c of cases) {
      const row = findPlMatchInPayload({
        payload: pl,
        home: c.home,
        away: c.away,
        kickoffUtc: c.utc,
        fplSnapshot: fpl,
      });
      expect(row?.id, `${c.home} v ${c.away}`).toBe(c.plId);
    }
  });

  it("code join regression would match the wrong Pulselive fixture for Everton v Chelsea", () => {
    const pl = loadPlFixtures841Recorded();
    const fpl = loadFplBootstrap841Recorded();
    const wrong = findPlMatchInPayloadUsingCodeJoin({
      payload: pl,
      home: "Everton",
      away: "Chelsea",
      kickoffUtc: "2026-10-17T11:30:00.000Z",
      fplSnapshot: fpl,
    });
    expect(wrong?.id).toBe(128989);
    const correct = findPlMatchInPayload({
      payload: pl,
      home: "Everton",
      away: "Chelsea",
      kickoffUtc: "2026-10-17T11:30:00.000Z",
      fplSnapshot: fpl,
    });
    expect(correct?.id).toBe(128986);
  });

  it("resolves current comp season id 841 for Oct 2026", () => {
    const ref = new Date("2026-10-21T12:00:00.000Z");
    expect(premierLeagueSeasonStartYear(ref)).toBe(2026);
    expect(compSeasonLabelMatchesReference("English Premier League Season 2026/2027", ref)).toBe(true);
    const id = resolvePlCompSeasonIdFromRows([
      { id: 841, label: "English Premier League Season 2026/2027" },
      { id: 719, label: "2024/25" },
    ], ref);
    expect(id).toBe(841);
  });

  it("drops stale doubt rows using only the player's own club previous match", () => {
    const snapshot = loadFplBootstrapFromRecordedFixture();
    const row = fixture("Chelsea", "Tottenham", { utcDate: "2026-10-24T16:30:00.000Z" });
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
      clubPreviousKickoffUtc: "2026-10-19T15:00:00.000Z",
    })).toBe(false);
    const { items } = buildInjuriesDoubtsTeamNews({
      fixture: row,
      identity: {
        plMatchId: "128995",
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

  it("keeps Chelsea doubt news after Chelsea's previous match even when before the opponent's", () => {
    const snapshot = loadFplBootstrap841Recorded();
    const row = fixture("Chelsea", "Tottenham", {
      fixtureId: 401878767,
      utcDate: "2026-10-24T16:30:00.000Z",
    });
    const schedule: FootballMatch[] = [
      {
        id: 1,
        competitionId: "eng.1",
        competition: "Premier League",
        homeTeam: "Chelsea",
        awayTeam: "Everton",
        utcDate: "2026-10-17T11:30:00.000Z",
        status: "FINISHED",
        stage: null,
        matchday: 1,
        group: null,
        score: { home: 2, away: 0 },
      },
      {
        id: 2,
        competitionId: "eng.1",
        competition: "Premier League",
        homeTeam: "Tottenham",
        awayTeam: "Liverpool",
        utcDate: "2026-10-19T19:00:00.000Z",
        status: "FINISHED",
        stage: null,
        matchday: 1,
        group: null,
        score: { home: 1, away: 1 },
      },
    ];
    const { items } = buildInjuriesDoubtsTeamNews({
      fixture: row,
      identity: {
        plMatchId: "128995",
        espnEventId: row.fixtureId,
        fotmobMatchId: null,
        goalMatchUuid: null,
        bbcTipoId: null,
        homeFplTeamId: 6,
        awayFplTeamId: 19,
        resolvedVia: "pl-api",
      },
      fplSnapshot: snapshot,
      schedule,
      fetchedAt: "2026-10-21T12:00:00.000Z",
    });
    expect(items.some((i) => i.player === "Gusto" && i.club === "Chelsea")).toBe(true);
    expect(items.some((i) => i.player === "Chavarria" && i.club === "Chelsea")).toBe(true);
  });

  it("keeps ongoing i/s/u absentees regardless of old news_added (Porro-style)", () => {
    const snapshot = loadFplBootstrapFromRecordedFixture();
    const row = fixture("Chelsea", "Tottenham", { utcDate: "2026-10-24T16:30:00.000Z" });
    const schedule = scheduleWithPrevious({
      home: "Chelsea",
      away: "Tottenham",
      kickoffUtc: row.utcDate,
      previousHomeKickoff: "2026-10-19T15:00:00.000Z",
      previousAwayKickoff: "2026-10-19T17:30:00.000Z",
    });
    const porro = snapshot.elements.find((e) => e.web_name === "Porro")!;
    expect(porro.status).toBe("i");
    expect(porro.news_added).toBe("2026-09-19T12:00:08.823872Z");
    const { items } = buildInjuriesDoubtsTeamNews({
      fixture: row,
      identity: {
        plMatchId: "128995",
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
    expect(items.some((i) => i.player === "Porro")).toBe(true);
  });

  it("drops unflagged available players and doubt rows missing news_added", () => {
    const snapshot = loadFplBootstrapFromRecordedFixture();
    const row = fixture("Arsenal", "Newcastle", { utcDate: "2026-10-24T15:00:00.000Z" });
    const raw = buildFplInjuryEvidenceForFixture(row, "2026-10-21T12:00:00.000Z", snapshot, {
      requireNewsAdded: true,
    });
    expect(raw.some((i) => i.player === "Available")).toBe(false);
    expect(raw.some((i) => i.player === "Saka")).toBe(true);
  });

  it("defensive guard drops and logs when fplTeamId does not match labelled club (no-op on live bootstrap)", () => {
    const snapshot = loadFplBootstrap841Recorded();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const row = fixture("Chelsea", "Tottenham", { utcDate: "2026-10-24T16:30:00.000Z" });
    const mismatched: DossierEvidenceItem = {
      id: "test",
      claim: "Tosin (Chelsea)",
      sourceUrl: FPL_BOOTSTRAP_URL,
      publisher: "fantasy.premierleague.com",
      publishedAt: "2026-10-19T22:30:08.516742Z",
      retrievedAt: "2026-10-21T12:00:00.000Z",
      trustTier: "interim",
      verification: "cited",
      direction: "neutral",
      relatedFactor: "injuries",
      category: "injuries",
      origin: "scheduled",
      source: "fpl-bootstrap-static",
      player: "Tosin",
      club: "Chelsea",
      status: "d",
      fplTeamId: 19,
      newsAddedAt: "2026-10-19T22:30:08.516742Z",
    };
    const kept = applyFplTeamIdClubGuard([mismatched], snapshot);
    expect(kept).toHaveLength(0);
    expect(logSpy.mock.calls.some((call) => String(call[0]).includes("fixture_first_wrong_club_drop"))).toBe(true);

    const { items } = buildInjuriesDoubtsTeamNews({
      fixture: row,
      identity: {
        plMatchId: "128995",
        espnEventId: row.fixtureId,
        fotmobMatchId: null,
        goalMatchUuid: null,
        bbcTipoId: null,
        homeFplTeamId: 6,
        awayFplTeamId: 19,
        resolvedVia: "pl-api",
      },
      fplSnapshot: snapshot,
      schedule: [],
      fetchedAt: "2026-10-21T12:00:00.000Z",
    });
    const tosin = items.find((i) => i.player === "Tosin");
    expect(tosin?.club).toBe("Tottenham");
    expect(tosin?.fplTeamId).toBe(19);
    expect(tosin?.fplElementId).toBe(147);
    logSpy.mockRestore();
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
    const row = fixture("Chelsea", "Tottenham", { utcDate: "2026-10-24T16:30:00.000Z" });
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

const FPL_BOOTSTRAP_URL = "https://fantasy.premierleague.com/api/bootstrap-static/";
