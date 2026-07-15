// worldcup-model reference data integration.
// The full fixture history is retained for model evaluation; featured live fixtures
// are derived separately from ESPN state.

const MODEL_DATA_BASE_URL = process.env.MODEL_DATA_BASE_URL || "https://worldcup-model.vercel.app";

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

interface ModelDataCache {
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

async function modelFetch<T>(path: string): Promise<T> {
  const response = await fetch(`${MODEL_DATA_BASE_URL}${path}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`worldcup-model ${path} ${response.status}: ${text.slice(0, 200)}`);
  }
  return response.json() as Promise<T>;
}

export async function refreshModelData(): Promise<void> {
  console.log("[Model] Refreshing worldcup-model reference data...");
  try {
    const [probabilities, fixtures] = await Promise.all([
      modelFetch<unknown>("/data/probabilities.json"),
      modelFetch<unknown>("/data/fixtures.json"),
    ]);
    cache.teams = parseTeams(probabilities);
    cache.fixtures = parseFixtures(fixtures);
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
