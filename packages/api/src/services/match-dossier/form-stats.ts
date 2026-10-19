import {
  lastLeagueMatches,
  resultMarkForTeam,
  sameClub,
  type ResultMark,
} from "../club-form";
import type { FootballMatch } from "../football-data";
import type { FormWindow, HeadToHeadMeeting, HomeAwaySplit, RestCongestion } from "./types";

export function formWindowFromMatches(
  team: string,
  fixtures: readonly FootballMatch[],
  n: number,
): FormWindow {
  const matches = lastLeagueMatches(team, fixtures, n);
  const results: ResultMark[] = matches.map((match) => resultMarkForTeam(match, team)!);
  let goalsFor = 0;
  let goalsAgainst = 0;
  for (const match of matches) {
    if (!match.score) continue;
    const home = sameClub(match.homeTeam, team);
    goalsFor += home ? match.score.home ?? 0 : match.score.away ?? 0;
    goalsAgainst += home ? match.score.away ?? 0 : match.score.home ?? 0;
  }
  return {
    results,
    played: results.length,
    goalsFor,
    goalsAgainst,
  };
}

export function homeAwaySplit(team: string, fixtures: readonly FootballMatch[]): HomeAwaySplit {
  const finished = fixtures.filter(
    (match) => match.status === "FINISHED" && resultMarkForTeam(match, team) !== null,
  );
  const homeMatches = finished.filter((match) => sameClub(match.homeTeam, team));
  const awayMatches = finished.filter((match) => sameClub(match.awayTeam, team));
  return {
    home: formWindowFromMatches(team, homeMatches, homeMatches.length),
    away: formWindowFromMatches(team, awayMatches, awayMatches.length),
  };
}

export function restCongestionForTeam(
  team: string,
  fixtures: readonly FootballMatch[],
  kickoffMs: number,
  nowMs: number,
): { restDays: number | null; matchesLast14Days: number } {
  const finished = fixtures
    .filter((match) => match.status === "FINISHED" && resultMarkForTeam(match, team) !== null)
    .sort((a, b) => Date.parse(b.utcDate) - Date.parse(a.utcDate));
  const last = finished.find((match) => Date.parse(match.utcDate) < kickoffMs);
  const restDays = last
    ? Math.floor((kickoffMs - Date.parse(last.utcDate)) / (24 * 60 * 60 * 1000))
    : null;
  const windowStart = kickoffMs - 14 * 24 * 60 * 60 * 1000;
  const matchesLast14Days = finished.filter((match) => {
    const t = Date.parse(match.utcDate);
    return t >= windowStart && t < kickoffMs;
  }).length;
  return { restDays, matchesLast14Days };
}

export function buildRestCongestion(
  home: string,
  away: string,
  fixtures: readonly FootballMatch[],
  kickoffUtc: string,
  now: Date,
): RestCongestion {
  const kickoffMs = Date.parse(kickoffUtc);
  const nowMs = now.getTime();
  const homeRest = restCongestionForTeam(home, fixtures, kickoffMs, nowMs);
  const awayRest = restCongestionForTeam(away, fixtures, kickoffMs, nowMs);
  return {
    restDaysHome: homeRest.restDays,
    restDaysAway: awayRest.restDays,
    homeMatchesLast14Days: homeRest.matchesLast14Days,
    awayMatchesLast14Days: awayRest.matchesLast14Days,
  };
}

export function headToHeadMeetings(
  home: string,
  away: string,
  fixtures: readonly FootballMatch[],
  limit = 6,
): { meetings: HeadToHeadMeeting[]; homeWins: number; draws: number; awayWins: number } {
  const meetings = fixtures
    .filter((match) => {
      if (match.status !== "FINISHED" || !match.score) return false;
      const teams = [match.homeTeam, match.awayTeam];
      return teams.some((t) => sameClub(t, home)) && teams.some((t) => sameClub(t, away));
    })
    .sort((a, b) => Date.parse(b.utcDate) - Date.parse(a.utcDate))
    .slice(0, limit)
    .map((match) => ({
      utcDate: match.utcDate,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      homeScore: match.score!.home ?? 0,
      awayScore: match.score!.away ?? 0,
      competitionId: match.competitionId,
    }));

  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  for (const meeting of meetings) {
    const fixtureHomeIsDossierHome = sameClub(meeting.homeTeam, home);
    const dossierHomeGoals = fixtureHomeIsDossierHome ? meeting.homeScore : meeting.awayScore;
    const dossierAwayGoals = fixtureHomeIsDossierHome ? meeting.awayScore : meeting.homeScore;
    if (dossierHomeGoals > dossierAwayGoals) homeWins += 1;
    else if (dossierHomeGoals < dossierAwayGoals) awayWins += 1;
    else draws += 1;
  }

  return { meetings, homeWins, draws, awayWins };
}
