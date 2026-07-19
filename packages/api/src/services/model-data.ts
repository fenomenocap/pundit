// Local port of the worldcup-model Elo + Dixon-Coles/Poisson pipeline.
// The full fixture history is retained for model evaluation; featured live fixtures
// are derived separately from ESPN state.

import { canonicalTeamName } from "../lib/team-names";
import { computeMatchModel, DEFAULT_ELO } from "./dixon-coles";
import { fetchEloRatings } from "./elo-ratings";
import { FootballMatch, getCachedMatches } from "./football-data";
import { getCachedPolymarketMarkets } from "./polymarket-data";
import {
  GroupStandingState,
  runMonteCarlo,
  TournamentFixtureState,
} from "./tournament-simulator";
import { TEAM_TO_GROUP, WORLD_CUP_TEAMS, WORLD_CUP_TEAM_SET } from "./world-cup-teams";

export interface ModelTeamProbability {
  team: string;
  winProb: number;
  sfProb: number;
  qfProb: number;
  marketPrice: number | null;
  edge: number | null;
}

export interface ModelScoreline {
  score: string;
  probability: number;
}

export interface ModelFixture {
  date: string;
  group: string | null;
  stage: string;
  home: string;
  away: string;
  pHome: number;
  pDraw: number;
  pAway: number;
  pOver2_5: number;
  pUnder2_5: number;
  pBttsYes: number;
  pBttsNo: number;
  topScores: ModelScoreline[];
  // Every scoreline ≥0.1% — chat grounding only; stripped from /api/model responses.
  scorelines: ModelScoreline[];
  stakePHome: number | null;
  stakePDraw: number | null;
  stakePAway: number | null;
  result: {
    homeScore: number;
    awayScore: number;
    status: string;
    winner: string | null;
  } | null;
}

export interface ModelDataCache {
  teams: ModelTeamProbability[];
  fixtures: ModelFixture[];
  lastUpdated: Date | null;
  error: string | null;
}

const cache: ModelDataCache = {
  teams: [],
  fixtures: [],
  lastUpdated: null,
  error: null,
};

export function getCachedModelData(): ModelDataCache {
  return { ...cache };
}

function rounded(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function modelStage(stage: string | null): string {
  if (!stage) return "knockout";
  return stage === "group-stage" ? "group" : stage.replaceAll("-", "_");
}

function matchWinner(match: FootballMatch): string | null {
  if (match.winner) return canonicalTeamName(match.winner);
  if (!match.score || match.score.home === null || match.score.away === null) return null;
  if (match.score.home > match.score.away) return match.homeTeam;
  if (match.score.away > match.score.home) return match.awayTeam;
  return null;
}

function buildFixtures(matches: FootballMatch[], elo: Map<string, number>): ModelFixture[] {
  return matches
    .filter((match) => WORLD_CUP_TEAM_SET.has(match.homeTeam)
      && WORLD_CUP_TEAM_SET.has(match.awayTeam))
    .map((match) => {
      const model = computeMatchModel(
        elo.get(match.homeTeam) ?? DEFAULT_ELO,
        elo.get(match.awayTeam) ?? DEFAULT_ELO
      );
      const stage = modelStage(match.stage);
      const completed = match.status === "FINISHED" && match.score;
      return {
        date: match.utcDate.slice(0, 10),
        group: stage === "group"
          ? match.group ?? TEAM_TO_GROUP.get(match.homeTeam) ?? TEAM_TO_GROUP.get(match.awayTeam) ?? null
          : null,
        stage,
        home: match.homeTeam,
        away: match.awayTeam,
        pHome: rounded(model.pHome),
        pDraw: rounded(model.pDraw),
        pAway: rounded(model.pAway),
        pOver2_5: rounded(model.pOver2_5),
        pUnder2_5: rounded(model.pUnder2_5),
        pBttsYes: rounded(model.pBttsYes),
        pBttsNo: rounded(model.pBttsNo),
        topScores: model.topScores.map(([[home, away], probability]) => ({
          score: `${home}-${away}`,
          probability: rounded(probability),
        })),
        scorelines: model.scorelines.map(([[home, away], probability]) => ({
          score: `${home}-${away}`,
          probability: rounded(probability),
        })),
        stakePHome: null,
        stakePDraw: null,
        stakePAway: null,
        result: completed
          ? {
              homeScore: match.score!.home!,
              awayScore: match.score!.away!,
              status: "FT",
              winner: matchWinner(match),
            }
          : null,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

function standingsByGroup(
  football: ReturnType<typeof getCachedMatches>
): Record<string, Record<string, GroupStandingState>> {
  const groups: Record<string, Record<string, GroupStandingState>> = {};
  for (const standing of football.standings) {
    if (!standing.group) continue;
    const team = canonicalTeamName(standing.team);
    groups[standing.group] ??= {};
    groups[standing.group][team] = {
      pts: standing.points,
      gd: standing.goalDifference,
      gf: standing.goalsFor,
      played: standing.playedGames,
    };
  }
  return groups;
}

function tournamentFixtures(fixtures: ModelFixture[]): TournamentFixtureState[] {
  return fixtures.map((fixture) => ({
    home: fixture.home,
    away: fixture.away,
    stage: fixture.stage,
    result: fixture.result ? { winner: fixture.result.winner } : null,
  }));
}

function cachedOutrightPrices(): Map<string, number> {
  const prices = new Map<string, number>();
  for (const market of getCachedPolymarketMarkets().wcMarkets) {
    const match = /Will (.+?) win the 2026 FIFA World Cup/i.exec(market.question);
    if (!match) continue;
    const yesIndex = market.outcomes.findIndex((outcome) => outcome.toLowerCase() === "yes");
    const price = market.outcomePrices[yesIndex >= 0 ? yesIndex : 0];
    if (Number.isFinite(price) && price >= 0 && price <= 1) {
      prices.set(canonicalTeamName(match[1]), price);
    }
  }
  return prices;
}

export function buildLocalModelData(
  elo: Map<string, number>,
  football: ReturnType<typeof getCachedMatches>,
  marketPrices = new Map<string, number>(),
  simulations?: number
): { teams: ModelTeamProbability[]; fixtures: ModelFixture[] } {
  const matches = [...football.recent, ...football.upcoming];
  const fixtures = buildFixtures(matches, elo);
  const probabilities = runMonteCarlo(
    elo,
    standingsByGroup(football),
    tournamentFixtures(fixtures),
    simulations
  );
  const teams = WORLD_CUP_TEAMS.map((team) => {
    const probability = probabilities.get(team)!;
    const marketPrice = marketPrices.get(team) ?? null;
    return {
      team,
      ...probability,
      marketPrice,
      edge: marketPrice === null ? null : rounded(probability.winProb - marketPrice, 6),
    };
  }).sort((a, b) => b.winProb - a.winProb);
  return { teams, fixtures };
}

export async function refreshModelData(): Promise<void> {
  console.log("[Model] Refreshing local Elo + Dixon-Coles tournament model...");
  try {
    const football = getCachedMatches();
    if (football.lastUpdated === null) throw new Error("ESPN cache is not ready.");
    const elo = await fetchEloRatings();
    for (const team of WORLD_CUP_TEAMS) {
      if (!elo.has(team)) {
        console.warn(`[Model] Missing Elo for ${team}; using ${DEFAULT_ELO}.`);
        elo.set(team, DEFAULT_ELO);
      }
    }
    const local = buildLocalModelData(elo, football, cachedOutrightPrices());
    cache.teams = local.teams;
    cache.fixtures = local.fixtures;
    cache.lastUpdated = new Date();
    cache.error = null;
    console.log(`[Model] ${cache.teams.length} teams, ${cache.fixtures.length} fixtures cached.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    cache.error = message;
    console.error(`[Model] Refresh error: ${message}`);
  }
}

// Hourly: fast enough that results and bracket changes flow into the model the
// same hour they happen, gentle enough on eloratings.net's small public site.
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
let cronTimer: ReturnType<typeof setInterval> | null = null;

export async function startModelCron(): Promise<void> {
  await refreshModelData();
  cronTimer = setInterval(refreshModelData, REFRESH_INTERVAL_MS);
  console.log("[Model] Cron started — refreshing every hour");
}

export function stopModelCron(): void {
  if (cronTimer) clearInterval(cronTimer);
  cronTimer = null;
}
