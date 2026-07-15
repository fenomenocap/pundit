import {
  MatchOdds,
  StoredMatchOdds,
  normalizeThreeWay,
  normalizedTeamPairKey,
  orientMatchOdds,
} from "../lib/match-odds";
import { normalizeTeamName } from "../lib/team-names";
import { FootballMatch, getCachedMatches } from "./football-data";

const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

interface KalshiCache {
  oddsByPair: Map<string, StoredMatchOdds | null>;
  lastUpdated: Date | null;
  error: string | null;
}

const cache: KalshiCache = {
  oddsByPair: new Map(),
  lastUpdated: null,
  error: null,
};

function uniqueFixtures(): FootballMatch[] {
  const { upcoming, recent } = getCachedMatches();
  const fixtures = new Map<string, FootballMatch>();
  for (const fixture of [...upcoming, ...recent]) {
    if (fixture.homeTeam === "TBD" || fixture.awayTeam === "TBD") continue;
    fixtures.set(normalizedTeamPairKey(fixture.homeTeam, fixture.awayTeam), fixture);
  }
  return [...fixtures.values()];
}

async function kalshiFetch<T>(path: string): Promise<T> {
  const response = await fetch(`${KALSHI_BASE}${path}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Kalshi API ${response.status}: ${text.slice(0, 200)}`);
  }
  return response.json() as Promise<T>;
}

function eventPairKey(title: string): string | null {
  const match = /^(.+?)\s+vs\.?\s+(.+?)(?::|$)/i.exec(title.trim());
  if (!match) return null;
  return normalizedTeamPairKey(match[1], match[2]);
}

function parseDollarPrice(value: unknown): number | null {
  const parsed = typeof value === "string" || typeof value === "number"
    ? Number(value)
    : NaN;
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null;
}

function marketPrice(market: Record<string, unknown>): number | null {
  const bid = parseDollarPrice(market.yes_bid_dollars ?? market.yes_bid);
  const ask = parseDollarPrice(market.yes_ask_dollars ?? market.yes_ask);
  if (bid !== null && ask !== null) return (bid + ask) / 2;
  return parseDollarPrice(market.last_price_dollars ?? market.last_price);
}

export function parseKalshiMarkets(
  markets: unknown[],
  home: string,
  away: string
): MatchOdds | null {
  const normalizedHome = normalizeTeamName(home);
  const normalizedAway = normalizeTeamName(away);
  let pHome: number | null = null;
  let pDraw: number | null = null;
  let pAway: number | null = null;

  for (const raw of markets) {
    if (!raw || typeof raw !== "object") continue;
    const market = raw as Record<string, unknown>;
    const label = String(market.yes_sub_title ?? market.subtitle ?? "")
      .replace(/^reg(?:ulation)?\s*time:\s*/i, "")
      .trim();
    const price = marketPrice(market);
    if (price === null) continue;

    if (/^(tie|draw)$/i.test(label)) pDraw = price;
    else if (normalizeTeamName(label) === normalizedHome) pHome = price;
    else if (normalizeTeamName(label) === normalizedAway) pAway = price;
  }

  if (pHome === null || pDraw === null || pAway === null) return null;
  return normalizeThreeWay(pHome, pDraw, pAway);
}

export function getCachedKalshiOdds(home: string, away: string): MatchOdds | null {
  const stored = cache.oddsByPair.get(normalizedTeamPairKey(home, away));
  return stored ? orientMatchOdds(stored, home, away) : null;
}

export async function refreshKalshiData(): Promise<void> {
  console.log("[Kalshi] Refreshing regulation-time match odds...");
  const fixtures = uniqueFixtures();
  if (fixtures.length === 0) {
    cache.error = "Football fixture cache is empty.";
    console.error("[Kalshi] Refresh skipped: football fixture cache is empty.");
    return;
  }

  try {
    const payload = await kalshiFetch<{ events?: Array<Record<string, unknown>> }>(
      "/events?series_ticker=KXWCGAME&status=open&limit=200"
    );
    const eventsByPair = new Map<string, Record<string, unknown>>();
    for (const event of payload.events ?? []) {
      const key = eventPairKey(String(event.title ?? event.sub_title ?? ""));
      if (key) eventsByPair.set(key, event);
    }

    const next = new Map(cache.oddsByPair);
    await Promise.all(fixtures.map(async (fixture) => {
      const key = normalizedTeamPairKey(fixture.homeTeam, fixture.awayTeam);
      const event = eventsByPair.get(key);
      if (!event) {
        next.set(key, null);
        return;
      }

      try {
        const ticker = String(event.event_ticker ?? "");
        const detail = await kalshiFetch<{
          event?: { markets?: unknown[] };
          markets?: unknown[];
        }>(`/events/${encodeURIComponent(ticker)}?with_nested_markets=true`);
        const markets = detail.event?.markets?.length
          ? detail.event.markets
          : detail.markets ?? [];
        const odds = parseKalshiMarkets(markets, fixture.homeTeam, fixture.awayTeam);
        if (!odds) throw new Error(`Incomplete three-way market for ${ticker}`);
        next.set(key, {
          home: fixture.homeTeam,
          away: fixture.awayTeam,
          ...odds,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[Kalshi] Match refresh error: ${message}`);
      }
    }));

    cache.oddsByPair = next;
    cache.lastUpdated = new Date();
    cache.error = null;
    const covered = [...next.values()].filter(Boolean).length;
    console.log(`[Kalshi] ${covered}/${fixtures.length} fixture pairs covered.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    cache.error = message;
    console.error(`[Kalshi] Refresh error: ${message}`);
  }
}

let cronTimer: ReturnType<typeof setInterval> | null = null;

export function startKalshiCron(): void {
  void refreshKalshiData();
  cronTimer = setInterval(refreshKalshiData, SIX_HOURS_MS);
  console.log("[Kalshi] Cron started — refreshing every 6 hours");
}

export function stopKalshiCron(): void {
  if (cronTimer) {
    clearInterval(cronTimer);
    cronTimer = null;
  }
}
