// ─── Polymarket Gamma API Integration ────────────────────────────────────────
//
// Public API, no auth required.
// Fetches FIFA World Cup 2026 outright winner + group winner markets.
// Refreshes every 6 hours via cron.
//
// Docs: https://docs.polymarket.com/#gamma-markets-api

const GAMMA_BASE = "https://gamma-api.polymarket.com";

// ─── Types ──────────────────────────────────────────────────────────────────

export type PolymarketMarketType = "outright" | "group";

export interface PolymarketMarket {
  id: string;
  question: string;
  outcomes: string[];
  outcomePrices: number[];
  liquidity: number;
  volume: number;
  endDate: string;
  resolved: boolean;
  active: boolean;
  type: PolymarketMarketType;
  group?: string; // e.g. "A", "B", … for group winner markets
}

interface PolymarketCache {
  wcMarkets: PolymarketMarket[];      // outright winner markets (Will X win WC?)
  groupMarkets: PolymarketMarket[];   // group winner markets (Will X win Group Y?)
  lastUpdated: Date | null;
  error: string | null;
}

// ─── WC keyword filter ───────────────────────────────────────────────────────

const WC_KEYWORDS = ["world cup", "fifa", "wc 2026", "2026 world cup"];

function isWCRelated(text: string): boolean {
  const t = text.toLowerCase();
  return WC_KEYWORDS.some((kw) => t.includes(kw));
}

// ─── Cache ──────────────────────────────────────────────────────────────────

const cache: PolymarketCache = {
  wcMarkets: [],
  groupMarkets: [],
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
function parseMarket(m: any, type: PolymarketMarketType, group?: string): PolymarketMarket | null {
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
    type,
    ...(group ? { group } : {}),
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

// Fetch outright "Will X win the WC?" markets from the /markets endpoint
async function fetchOutrightMarkets(): Promise<PolymarketMarket[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await gammaFetch<any[]>(
    "/markets?tag_slug=sports&active=true&closed=false&limit=200"
  );

  const markets: PolymarketMarket[] = [];
  for (const raw of Array.isArray(data) ? data : []) {
    const question: string = raw.question || raw.title || "";
    if (!isWCRelated(question)) continue;
    // Skip group winner markets — those come from the events endpoint
    if (/win group [a-l]/i.test(question)) continue;

    const parsed = parseMarket(raw, "outright");
    if (parsed) markets.push(parsed);
  }

  return markets.sort((a, b) => b.liquidity - a.liquidity);
}

// Fetch "Will X win Group Y?" markets from the /events endpoint
async function fetchGroupMarkets(): Promise<PolymarketMarket[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const events = await gammaFetch<any[]>(
    "/events?tag_slug=sports&active=true&closed=false&limit=100"
  );

  const markets: PolymarketMarket[] = [];

  for (const event of Array.isArray(events) ? events : []) {
    const title: string = event.title || event.name || "";
    // Match "World Cup Group X Winner" events
    const groupMatch = title.match(/world cup group ([a-l]) winner/i);
    if (!groupMatch) continue;
    const group = groupMatch[1].toUpperCase();

    for (const m of Array.isArray(event.markets) ? event.markets : []) {
      const question: string = m.question || "";
      if (!isWCRelated(question)) continue;
      // Skip the "another team" catch-all options
      if (/another team/i.test(question)) continue;

      const parsed = parseMarket(m, "group", group);
      if (parsed) markets.push(parsed);
    }
  }

  // Sort: by group letter, then by outcomePrices[0] (Yes probability) descending
  return markets.sort((a, b) => {
    if (a.group !== b.group) return (a.group ?? "").localeCompare(b.group ?? "");
    return (b.outcomePrices[0] ?? 0) - (a.outcomePrices[0] ?? 0);
  });
}

// ─── Refresh ─────────────────────────────────────────────────────────────────

export async function refreshPolymarketData(): Promise<void> {
  console.log("[Polymarket] Refreshing WC markets from Gamma API...");

  try {
    const [wcMarkets, groupMarkets] = await Promise.all([
      fetchOutrightMarkets(),
      fetchGroupMarkets(),
    ]);

    cache.wcMarkets = wcMarkets;
    cache.groupMarkets = groupMarkets;
    cache.lastUpdated = new Date();
    cache.error = null;
    console.log(
      `[Polymarket] ${wcMarkets.length} outright + ${groupMarkets.length} group winner markets cached.`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    cache.error = msg;
    console.error(`[Polymarket] Refresh error: ${msg}`);
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
