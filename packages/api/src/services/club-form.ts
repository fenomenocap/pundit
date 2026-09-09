import { normalizeTeamName } from "../lib/team-names";
import {
  getCachedMatches,
  getCachedMatchesForCompetition,
  getCachedPriorSeasonResults,
  getCachedSeasonSchedule,
  type FootballMatch,
  type FootballStanding,
  type MatchScorer,
} from "./football-data";

export type ResultMark = "W" | "D" | "L";
export type DeskPos = "GK" | "DEF" | "MID" | "FWD";

export type ClubScorer = {
  id: string;
  name: string;
  team: string;
  position: DeskPos;
  goals: number;
};

export type ClubFormRow = {
  team: string;
  form: ResultMark[];
  played: number;
  position: number | null;
  playedGames: number | null;
  won: number | null;
  draw: number | null;
  lost: number | null;
  points: number | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
  goalDifference: number | null;
  scorers: ClubScorer[];
};

export type ClubFormSnapshot = {
  competitionId: string;
  seasonId: string | null;
  source: "season-schedule" | "rolling-window" | "season-and-prior";
  lastUpdated: string | null;
  teams: ClubFormRow[];
};

const FORM_LENGTH = 5;
const SCORERS_PER_TEAM = 3;

export function sameClub(a: string, b: string): boolean {
  return normalizeTeamName(a) === normalizeTeamName(b);
}

export function resultMarkForTeam(match: FootballMatch, team: string): ResultMark | null {
  if (match.status !== "FINISHED" || !match.score) return null;
  const home = sameClub(match.homeTeam, team);
  const away = sameClub(match.awayTeam, team);
  if (!home && !away) return null;
  const homeGoals = match.score.home ?? 0;
  const awayGoals = match.score.away ?? 0;
  if (homeGoals === awayGoals) return "D";
  const won = home ? homeGoals > awayGoals : awayGoals > homeGoals;
  return won ? "W" : "L";
}

export function lastLeagueMatches(
  team: string,
  fixtures: readonly FootballMatch[],
  n = FORM_LENGTH
): FootballMatch[] {
  return fixtures
    .filter((match) => resultMarkForTeam(match, team) !== null)
    .sort((a, b) => Date.parse(a.utcDate) - Date.parse(b.utcDate))
    .slice(-n);
}

export function lastLeagueForm(
  team: string,
  fixtures: readonly FootballMatch[],
  n = FORM_LENGTH
): ResultMark[] {
  return lastLeagueMatches(team, fixtures, n).map((match) => resultMarkForTeam(match, team)!);
}

export function deskPosition(espnPosition: string | null | undefined): DeskPos {
  const raw = (espnPosition ?? "").trim().toUpperCase();
  if (!raw) return "MID";
  if (raw === "GK" || raw.startsWith("G")) return "GK";
  if (
    /^(F|ST|CF|FW|LW|RW)/.test(raw)
    || raw.includes("FWD")
    || raw.includes("STRIKER")
  ) {
    return "FWD";
  }
  if (
    /^(D|CB|LB|RB|WB|LWB|RWB|CD)/.test(raw)
    || raw.includes("DEF")
    || raw.includes("BACK")
  ) {
    return "DEF";
  }
  return "MID";
}

export function aggregateScorers(
  fixtures: readonly FootballMatch[],
  perTeam = SCORERS_PER_TEAM
): Map<string, ClubScorer[]> {
  const byTeam = new Map<string, Map<string, ClubScorer>>();
  for (const match of fixtures) {
    for (const scorer of match.scorers ?? []) {
      addScorer(byTeam, scorer);
    }
  }
  const ranked = new Map<string, ClubScorer[]>();
  for (const [team, players] of byTeam) {
    ranked.set(
      team,
      [...players.values()]
        .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name))
        .slice(0, perTeam)
    );
  }
  return ranked;
}

function addScorer(
  byTeam: Map<string, Map<string, ClubScorer>>,
  scorer: MatchScorer
): void {
  const teamKey = normalizeTeamName(scorer.team);
  let players = byTeam.get(scorer.team);
  if (!players) {
    for (const [existingTeam, existingPlayers] of byTeam) {
      if (sameClub(existingTeam, scorer.team)) {
        players = existingPlayers;
        break;
      }
    }
  }
  if (!players) {
    players = new Map();
    byTeam.set(scorer.team, players);
  }
  const id = scorer.playerId || `${teamKey}:${scorer.name.toLowerCase()}`;
  const current = players.get(id);
  if (current) {
    current.goals += 1;
    return;
  }
  players.set(id, {
    id,
    name: scorer.name,
    team: scorer.team,
    position: deskPosition(scorer.position),
    goals: 1,
  });
}

export function teamsFromFixtures(fixtures: readonly FootballMatch[]): string[] {
  const names = new Set<string>();
  for (const match of fixtures) {
    if (match.homeTeam) names.add(match.homeTeam);
    if (match.awayTeam) names.add(match.awayTeam);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

export function buildClubFormRows(
  formFixtures: readonly FootballMatch[],
  scorerFixtures: readonly FootballMatch[],
  standings: readonly FootballStanding[] = [],
  n = FORM_LENGTH
): ClubFormRow[] {
  return teamsFromFixtures(formFixtures).map((team) => {
    const form = lastLeagueForm(team, formFixtures, n);
    const recent = lastLeagueMatches(team, scorerFixtures, n);
    const standing = standingForTeam(team, standings);
    return {
      team,
      form,
      played: form.length,
      position: standing?.position ?? null,
      playedGames: standing?.playedGames ?? null,
      won: standing?.won ?? null,
      draw: standing?.draw ?? null,
      lost: standing?.lost ?? null,
      points: standing?.points ?? null,
      goalsFor: standing?.goalsFor ?? null,
      goalsAgainst: standing?.goalsAgainst ?? null,
      goalDifference: standing?.goalDifference ?? null,
      scorers: lookupScorers(aggregateScorers(recent), team),
    };
  });
}

function standingForTeam(
  team: string,
  standings: readonly FootballStanding[]
): FootballStanding | null {
  return standings.find((row) => sameClub(row.team, team)) ?? null;
}

function lookupScorers(scorers: Map<string, ClubScorer[]>, team: string): ClubScorer[] {
  const direct = scorers.get(team);
  if (direct) return direct;
  for (const [name, rows] of scorers) {
    if (sameClub(name, team)) return rows;
  }
  return [];
}

export function getClubFormSnapshot(competitionId = "eng.1"): ClubFormSnapshot {
  const rolling = getCachedMatchesForCompetition(competitionId);
  const season = competitionId === "eng.1" ? getCachedSeasonSchedule() : null;
  const prior = competitionId === "eng.1" ? getCachedPriorSeasonResults() : { fixtures: [] };
  const seasonFixtures = season?.fixtures ?? [];
  const priorFixtures = prior.fixtures ?? [];
  const rollingFixtures = [...rolling.recent, ...rolling.upcoming];
  const useSeason = seasonFixtures.length > 0;
  const formFixtures = useSeason ? [...priorFixtures, ...seasonFixtures] : rolling.recent;
  const scorerFixtures = useSeason ? formFixtures : [...seasonFixtures, ...rollingFixtures];
  const lastUpdated = useSeason
    ? season?.lastUpdated ?? null
    : getCachedMatches().lastUpdated;
  return {
    competitionId,
    seasonId: useSeason ? season?.seasonId ?? null : null,
    source: useSeason && priorFixtures.length > 0
      ? "season-and-prior"
      : useSeason
        ? "season-schedule"
        : "rolling-window",
    lastUpdated: lastUpdated?.toISOString() ?? null,
    teams: buildClubFormRows(formFixtures, scorerFixtures, rolling.standings),
  };
}
