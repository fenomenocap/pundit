// ─── Polymarket Gamma API Integration ────────────────────────────────────────
//
// Public API, no auth required.
// Fetches FIFA World Cup 2026 markets and caches them in-memory.
// Refreshes every 6 hours via cron.
//
// Docs: https://docs.polymarket.com/#gamma-markets-api

const GAMMA_BASE = "https://gamma-api.polymarket.com";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PolymarketMarket {
  id: string;           // Polymarket market/condition ID
  question: string;
  outcomes: string[];   // e.g. ["Yes","No"] or ["Brazil","France","Draw"]
  outcomePrices: number[]; // implied probabilities 0–1
  liquidity: number;    // USDC
  volume: number;       // USDC
  endDate: string;      // ISO — use as resolution timestamp hint
  resolved: boolean;
  active: boolean;
}

interface PolymarketCache {
  wcMarkets: PolymarketMarket[];
  lastUpdated: Date | null;
  error: string | null;
}

// ─── WC keyword filter ───────────────────────────────────────────────────────

const WC_KEYWORDS = ["world cup", "fifa", "wc 2026", "2026 world cup"];

function isWCMarket(question: string): boolean {
  const q = question.toLowerCase();
  return WC_KEYWORDS.some((kw) => q.includes(kw));
}

// ─── Cache ──────────────────────────────────────────────────────────────────

const cache: PolymarketCache = {
  wcMarkets: [],
  lastUpdated: null,
  error: null,
};

export function getCachedPolymarketMarkets(): PolymarketCache {
  return { ...cache };
}

// ─── Parsers ────────────────────────────────────────────────────────────────

function parseStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // ignore
    }
  }
  return [];
}

function parseNumberArray(raw: unknown): number[] {
  return parseStringArray(raw).map((v) => parseFloat(v)).filter((n) => !isNaN(n));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseMarket(m: any): PolymarketMarket | null {
  const question: string = m.question || m.title || "";
  if (!question) return null;

  const outcomes = parseStringArray(m.outcomes);
  const outcomePrices = parseNumberArray(m.outcomePrices);

  return {
    id: String(m.conditionId || m.id || ""),
    question,
    outcomes,
    outcomePrices,
    liquidity: parseFloat(m.liquidity) || 0,
    volume: parseFloat(m.volume) || 0,
    endDate: m.endDate || m.end_date_iso || "",
    resolved: Boolean(m.resolved),
    active: Boolean(m.active),
  };
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

async function gammaFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${GAMMA_BASE}${path}`, {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Polymarket Gamma API ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json() as Promise<T>;
}

async function fetchWCMarkets(): Promise<PolymarketMarket[]> {
  // Fetch active soccer markets from Gamma API
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await gammaFetch<any[]>(
    "/markets?tag_slug=sports&active=true&closed=false&limit=200"
  );

  const markets: PolymarketMarket[] = [];

  for (const raw of Array.isArray(data) ? data : []) {
    const question: string = raw.question || raw.title || "";
    if (!isWCMarket(question)) continue;

    const parsed = parseMarket(raw);
    if (parsed) markets.push(parsed);
  }

  // Sort by liquidity descending so highest-liquidity WC markets are first
  return markets.sort((a, b) => b.liquidity - a.liquidity);
}

// ─── Refresh ─────────────────────────────────────────────────────────────────

export async function refreshPolymarketData(): Promise<void> {
  console.log("[Polymarket] Refreshing WC markets from Gamma API...");

  try {
    const wcMarkets = await fetchWCMarkets();
    cache.wcMarkets = wcMarkets;
    cache.lastUpdated = new Date();
    cache.error = null;
    console.log(`[Polymarket] ${wcMarkets.length} WC markets cached.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    cache.error = msg;
    console.error(`[Polymarket] Refresh error: ${msg}`);
    // Keep stale data in cache — better than nothing
  }
}

// ─── Cron ────────────────────────────────────────────────────────────────────

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
let cronTimer: ReturnType<typeof setInterval> | null = null;

export function startPolymarketCron(): void {
  refreshPolymarketData();
  cronTimer = setInterval(refreshPolymarketData, SIX_HOURS_MS);
  console.log("[Polymarket] Cron started — refreshing every 6 hours");
}

export function stopPolymarketCron(): void {
  if (cronTimer) {
    clearInterval(cronTimer);
    cronTimer = null;
  }
}
