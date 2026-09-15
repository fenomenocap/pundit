import { getCompetitionById } from "../config/competitions";
import {
  sameClub,
  getClubFormSnapshot,
  type ClubScorer,
  type ResultMark,
} from "./club-form";
import { DEFAULT_HOME_ADVANTAGE_ELO, eloToLambdas } from "./dixon-coles";
import type { ModelFixture } from "./model-data";

export type MatchTableContext = {
  position: number | null;
  points: number | null;
  goalDifference: number | null;
  playedGames: number | null;
};

export type MatchContext = {
  homeElo: number;
  awayElo: number;
  lambdaHome: number;
  lambdaAway: number;
  totalXg: number;
  homeForm: ResultMark[];
  awayForm: ResultMark[];
  homeTable: MatchTableContext;
  awayTable: MatchTableContext;
  homeScorers: ClubScorer[];
  awayScorers: ClubScorer[];
};

function homeAdvantageEloFor(fixture: ModelFixture): number {
  if (fixture.forecastProvenance?.homeAdvantageElo != null) {
    return fixture.forecastProvenance.homeAdvantageElo;
  }
  const competition = getCompetitionById(fixture.competitionId);
  return competition?.homeFieldAdvantage ? DEFAULT_HOME_ADVANTAGE_ELO : 0;
}

function tableFromRow(row: {
  position: number | null;
  points: number | null;
  goalDifference: number | null;
  playedGames: number | null;
} | undefined): MatchTableContext {
  return {
    position: row?.position ?? null,
    points: row?.points ?? null,
    goalDifference: row?.goalDifference ?? null,
    playedGames: row?.playedGames ?? null,
  };
}

function teamRow(snapshot: ReturnType<typeof getClubFormSnapshot>, team: string) {
  return snapshot.teams.find((row) => sameClub(row.team, team));
}

export function buildMatchContext(fixture: ModelFixture): MatchContext {
  const homeAdvantageElo = homeAdvantageEloFor(fixture);
  const [lambdaHome, lambdaAway] = eloToLambdas(
    fixture.homeElo,
    fixture.awayElo,
    homeAdvantageElo
  );
  const snapshot = getClubFormSnapshot(fixture.competitionId);
  const homeRow = teamRow(snapshot, fixture.home);
  const awayRow = teamRow(snapshot, fixture.away);

  return {
    homeElo: fixture.homeElo,
    awayElo: fixture.awayElo,
    lambdaHome,
    lambdaAway,
    totalXg: lambdaHome + lambdaAway,
    homeForm: homeRow?.form ?? [],
    awayForm: awayRow?.form ?? [],
    homeTable: tableFromRow(homeRow),
    awayTable: tableFromRow(awayRow),
    homeScorers: homeRow?.scorers ?? [],
    awayScorers: awayRow?.scorers ?? [],
  };
}

export function formatFormMarks(form: ResultMark[]): string {
  return form.length > 0 ? form.join("") : "—";
}

export function formatTableLine(team: string, table: MatchTableContext): string {
  if (table.position == null && table.points == null) {
    return `${team}: no table row`;
  }
  const parts = [
    table.position != null ? `${table.position}${ordinalSuffix(table.position)}` : null,
    table.points != null ? `${table.points} pts` : null,
    table.goalDifference != null ? `${table.goalDifference >= 0 ? "+" : ""}${table.goalDifference} GD` : null,
    table.playedGames != null ? `${table.playedGames} played` : null,
  ].filter(Boolean);
  return `${team}: ${parts.join(", ")}`;
}

export function formatScorersLine(team: string, scorers: ClubScorer[]): string {
  if (scorers.length === 0) return `${team} scorers: none on record`;
  const names = scorers.map((scorer) => `${scorer.name} (${scorer.goals})`).join(", ");
  return `${team} scorers: ${names}`;
}

function ordinalSuffix(position: number): string {
  const mod100 = position % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  switch (position % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}
