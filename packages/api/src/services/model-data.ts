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

function objectValue(raw: unknown, label: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${label} must be an object.`);
  }
  return raw as Record<string, unknown>;
}

function stringValue(raw: unknown, label: string): string {
  if (typeof raw !== "string" || !raw.trim()) throw new Error(`${label} must be a non-empty string.`);
  return raw;
}

function finiteNumber(raw: unknown, label: string): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) throw new Error(`${label} must be finite.`);
  return raw;
}

function probability(raw: unknown, label: string): number {
  const value = finiteNumber(raw, label);
  if (value < 0 || value > 1) throw new Error(`${label} must be between 0 and 1.`);
  return value;
}

function nullableProbability(raw: unknown, label: string): number | null {
  return raw === null || raw === undefined ? null : probability(raw, label);
}

function nullableFiniteNumber(raw: unknown, label: string): number | null {
  return raw === null || raw === undefined ? null : finiteNumber(raw, label);
}

export function parseTeams(raw: unknown): ModelTeamProbability[] {
  const teams = objectValue(raw, "probabilities");
  return Object.entries(teams)
    .map(([team, value]) => {
      const entry = objectValue(value, `probabilities.${team}`);
      return {
        team,
        winProb: probability(entry.win_prob, `${team}.win_prob`),
        sfProb: probability(entry.sf_prob, `${team}.sf_prob`),
        qfProb: probability(entry.qf_prob, `${team}.qf_prob`),
        marketPrice: nullableProbability(entry.market_price, `${team}.market_price`),
        edge: nullableFiniteNumber(entry.edge, `${team}.edge`),
      };
    })
    .sort((a, b) => b.winProb - a.winProb);
}

function parseTopScores(raw: unknown, label: string): ModelScoreline[] {
  if (!Array.isArray(raw)) throw new Error(`${label} must be an array.`);
  return raw.map((item, index) => {
    if (!Array.isArray(item) || item.length !== 2) throw new Error(`${label}[${index}] is invalid.`);
    return {
      score: stringValue(item[0], `${label}[${index}].score`),
      probability: probability(item[1], `${label}[${index}].probability`),
    };
  });
}

export function parseFixtures(raw: unknown): ModelFixture[] {
  if (!Array.isArray(raw)) throw new Error("fixtures must be an array.");
  return raw.map((value, index) => {
    const fixture = objectValue(value, `fixtures[${index}]`);
    const result = fixture.result === null || fixture.result === undefined
      ? null
      : objectValue(fixture.result, `fixtures[${index}].result`);

    return {
      date: stringValue(fixture.date, `fixtures[${index}].date`),
      group: fixture.group === null || fixture.group === undefined
        ? null
        : stringValue(fixture.group, `fixtures[${index}].group`),
      stage: stringValue(fixture.stage, `fixtures[${index}].stage`),
      home: stringValue(fixture.home, `fixtures[${index}].home`),
      away: stringValue(fixture.away, `fixtures[${index}].away`),
      pHome: probability(fixture.p_home, `fixtures[${index}].p_home`),
      pDraw: probability(fixture.p_draw, `fixtures[${index}].p_draw`),
      pAway: probability(fixture.p_away, `fixtures[${index}].p_away`),
      pOver2_5: probability(fixture.p_over_2_5, `fixtures[${index}].p_over_2_5`),
      pUnder2_5: probability(fixture.p_under_2_5, `fixtures[${index}].p_under_2_5`),
      pBttsYes: probability(fixture.p_btts_yes, `fixtures[${index}].p_btts_yes`),
      pBttsNo: probability(fixture.p_btts_no, `fixtures[${index}].p_btts_no`),
      topScores: parseTopScores(fixture.top_scores, `fixtures[${index}].top_scores`),
      stakePHome: nullableProbability(fixture.stake_p_home, `fixtures[${index}].stake_p_home`),
      stakePDraw: nullableProbability(fixture.stake_p_draw, `fixtures[${index}].stake_p_draw`),
      stakePAway: nullableProbability(fixture.stake_p_away, `fixtures[${index}].stake_p_away`),
      result: result
        ? {
            homeScore: finiteNumber(result.home_score, `fixtures[${index}].result.home_score`),
            awayScore: finiteNumber(result.away_score, `fixtures[${index}].result.away_score`),
            status: stringValue(result.status, `fixtures[${index}].result.status`),
            winner: result.winner === null || result.winner === undefined
              ? null
              : stringValue(result.winner, `fixtures[${index}].result.winner`),
          }
        : null,
    };
  });
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

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
let cronTimer: ReturnType<typeof setInterval> | null = null;

export async function startModelCron(): Promise<void> {
  await refreshModelData();
  cronTimer = setInterval(refreshModelData, SIX_HOURS_MS);
  console.log("[Model] Cron started — refreshing every 6 hours");
}

export function stopModelCron(): void {
  if (cronTimer) clearInterval(cronTimer);
  cronTimer = null;
}
