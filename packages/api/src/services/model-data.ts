// ─── worldcup-model Reference Data Integration ───────────────────────────────
//
// Public static JSON, no auth required.
// Fetches Elo/Poisson-derived WC 2026 win probabilities + fixture odds from the
// worldcup-model Vercel deploy, which regenerates the data on its own build cron.
// Refreshes every 6 hours, matching the Polymarket integration cadence.
//
// Source: https://github.com/fenomenocap/worldcup-model

const MODEL_DATA_BASE_URL = process.env.MODEL_DATA_BASE_URL || "https://worldcup-model.vercel.app";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ModelTeamProbability {
  team: string;
  winProb: number;   // 0–1
  sfProb: number;    // 0–1
  qfProb: number;    // 0–1
  marketPrice: number; // 0–1, Polymarket price as seen by the model at run time
  edge: number;       // winProb - marketPrice
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
  stakePHome: number | null;
  stakePDraw: number | null;
  stakePAway: number | null;
  result: { homeScore: number; awayScore: number; status: string } | null;
}

interface ModelDataCache {
  teams: ModelTeamProbability[];
  fixtures: ModelFixture[];
  lastUpdated: Date | null;
  error: string | null;
}

// ─── Cache ──────────────────────────────────────────────────────────────────

const cache: ModelDataCache = {
  teams: [],
  fixtures: [],
  lastUpdated: null,
  error: null,
};

export function getCachedModelData(): ModelDataCache {
  return { ...cache };
}

// ─── Parsers ────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseTeams(raw: any): ModelTeamProbability[] {
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw)
    .map(([team, v]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = v as any;
      return {
        team,
        winProb: Number(t.win_prob) || 0,
        sfProb: Number(t.sf_prob) || 0,
        qfProb: Number(t.qf_prob) || 0,
        marketPrice: Number(t.market_price) || 0,
        edge: Number(t.edge) || 0,
      };
    })
    .sort((a, b) => b.winProb - a.winProb);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseFixtures(raw: any): ModelFixture[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((f) => ({
    date: f.date,
    group: f.group ?? null,
    stage: f.stage,
    home: f.home,
    away: f.away,
    pHome: Number(f.p_home) || 0,
    pDraw: Number(f.p_draw) || 0,
    pAway: Number(f.p_away) || 0,
    stakePHome: f.stake_p_home ?? null,
    stakePDraw: f.stake_p_draw ?? null,
    stakePAway: f.stake_p_away ?? null,
    result: f.result
      ? {
          homeScore: f.result.home_score,
          awayScore: f.result.away_score,
          status: f.result.status,
        }
      : null,
  }));
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

async function modelFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${MODEL_DATA_BASE_URL}${path}`, {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`worldcup-model ${path} ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json() as Promise<T>;
}

// ─── Refresh ─────────────────────────────────────────────────────────────────

export async function refreshModelData(): Promise<void> {
  console.log("[Model] Refreshing worldcup-model reference data...");

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [probabilities, fixtures] = await Promise.all([
      modelFetch<any>("/data/probabilities.json"),
      modelFetch<any[]>("/data/fixtures.json"),
    ]);

    cache.teams = parseTeams(probabilities);
    cache.fixtures = parseFixtures(fixtures);
    cache.lastUpdated = new Date();
    cache.error = null;
    console.log(
      `[Model] ${cache.teams.length} teams, ${cache.fixtures.length} fixtures cached.`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    cache.error = msg;
    console.error(`[Model] Refresh error: ${msg}`);
    // Keep last-good cache on failure — never serve empty/stale-silent data.
  }
}

// ─── Cron ────────────────────────────────────────────────────────────────────

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
let cronTimer: ReturnType<typeof setInterval> | null = null;

export function startModelCron(): void {
  refreshModelData();
  cronTimer = setInterval(refreshModelData, SIX_HOURS_MS);
  console.log("[Model] Cron started — refreshing every 6 hours");
}

export function stopModelCron(): void {
  if (cronTimer) {
    clearInterval(cronTimer);
    cronTimer = null;
  }
}
