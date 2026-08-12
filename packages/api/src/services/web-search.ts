// Web search for the chat tier.
//
// Anthropic's hosted web_search server tool had no MiniMax equivalent, so
// Pundit executes search itself and hands results back as a tool_result.
//
// The backend is MiniMax's own search endpoint: it authenticates with the same
// MINIMAX_API_KEY as inference and draws on the same coding-plan quota, so no
// second vendor, key or bill is involved. That is the whole point -- a
// third-party search API was considered and deliberately rejected.
//
// The endpoint is undocumented; it was identified from the source of MiniMax's
// published `minimax-coding-plan-mcp` server, which is a thin wrapper over this
// call. It can therefore change without notice, which is handled two ways:
// every detail of the wire format is confined to this file behind searchWeb's
// contract, and getWebSearchStatus() reports failures so a break is visible on
// /ready instead of looking like the model choosing not to search.

// Well inside ask.ts's 90s REQUEST_TIMEOUT_MS: a turn may run several searches
// plus the model round trips, so no single search may monopolise the budget.
const TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 5 * 60_000;
const BREAKER_FAILURES = 3;
const BREAKER_OPEN_MS = 5 * 60_000;
const MAX_QUERY_LENGTH = 256;
const MAX_TITLE_LENGTH = 200;
const MAX_SNIPPET_LENGTH = 600;
const MAX_URL_LENGTH = 2_048;
const MAX_RESPONSE_BYTES = 256 * 1024;

// Results past this add tokens without adding much signal -- the endpoints
// return ~9 and the tail is typically aggregator pages.
const MAX_RESULTS = 6;

export interface WebSearchResult {
  title: string;
  link: string;
  snippet: string;
  /** ISO yyyy-mm-dd, or "" when the source published no usable date. */
  date: string;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function bounded(value: unknown, max: number): string {
  return asString(value).slice(0, max);
}

function safeHttpUrl(value: unknown): string {
  const candidate = bounded(value, MAX_URL_LENGTH);
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

const RELATIVE_DATE = /^(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago$/i;

const RELATIVE_UNIT_MS: Record<string, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_592_000_000,
  year: 31_536_000_000,
};

/**
 * Search backends return dates in mixed forms: absolute ("12 Apr 2026"),
 * relative ("19 hours ago") and frequently empty. ATTRIBUTION_RULES in ask.ts
 * requires a source *and* a date, and the model cannot resolve "19 hours ago"
 * into one without knowing when the search ran -- so relative forms are
 * converted here.
 *
 * Unparseable values become "" rather than a guess: an absent date makes the
 * model omit the claim or hedge it, whereas a wrong date is a fabricated
 * citation, which is the failure mode the sanitizers exist to prevent.
 */
const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
// A time or an explicit zone means the instant is unambiguous.
const HAS_TIME_OR_ZONE = /\d{1,2}:\d{2}|[zZ]$|[+-]\d{2}:?\d{2}$/;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function normalizeSearchDate(raw: string, now: Date = new Date()): string {
  const value = raw.trim();
  if (!value) return "";

  const relative = RELATIVE_DATE.exec(value);
  if (relative) {
    const amount = Number(relative[1]);
    const unitMs = RELATIVE_UNIT_MS[relative[2].toLowerCase()];
    if (!Number.isFinite(amount) || !unitMs) return "";
    return new Date(now.getTime() - amount * unitMs).toISOString().slice(0, 10);
  }

  // Already a calendar date: return it untouched. Round-tripping it through
  // Date would reintroduce the timezone shift this function exists to avoid.
  if (ISO_DATE_ONLY.test(value)) return value <= now.toISOString().slice(0, 10) ? value : "";

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "";
  const date = new Date(parsed);

  // A calendar date with no time ("12 Apr 2026") is parsed as *local*
  // midnight, so formatting it as UTC moved it to the previous day anywhere
  // east of Greenwich -- a published date silently off by one. Local
  // components give the date back as written. Anything carrying a real instant
  // is formatted as UTC, which is what its source meant.
  const normalized = HAS_TIME_OR_ZONE.test(value)
    ? date.toISOString().slice(0, 10)
    : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return normalized <= now.toISOString().slice(0, 10) ? normalized : "";
}

function normalizeResults(
  entries: unknown,
  read: (entry: Record<string, unknown>) => Omit<WebSearchResult, "date"> & { date: string }
): WebSearchResult[] {
  if (!Array.isArray(entries)) return [];
  return entries
    .slice(0, MAX_RESULTS)
    .map((entry) => {
      const raw = read((entry ?? {}) as Record<string, unknown>);
      return {
        title: bounded(raw.title, MAX_TITLE_LENGTH),
        link: safeHttpUrl(raw.link),
        snippet: bounded(raw.snippet, MAX_SNIPPET_LENGTH),
        date: normalizeSearchDate(raw.date),
      };
    })
    .filter((result) => result.title !== "" && result.link !== "");
}

interface SearchProvider {
  name: string;
  enabled(): boolean;
  run(query: string, signal?: AbortSignal): Promise<WebSearchResult[]>;
}

// MiniMax's own search, behind the same key and quota as inference.
const minimaxProvider: SearchProvider = {
  name: "minimax",
  enabled: () => Boolean(process.env.MINIMAX_API_KEY),
  async run(query, requestSignal) {
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const signal = requestSignal ? AbortSignal.any([requestSignal, timeout]) : timeout;
    const response = await fetch("https://api.minimax.io/v1/coding_plan/search", {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.MINIMAX_API_KEY}`,
        "content-type": "application/json",
        // The endpoint is reached through MiniMax's MCP tooling in its
        // documented form; the header identifies the caller the same way.
        "MM-API-Source": "Minimax-MCP",
      },
      body: JSON.stringify({ q: query }),
      signal,
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const rawBody = typeof (response as { text?: unknown }).text === "function"
      ? await response.text()
      : JSON.stringify(await response.json());
    if (new TextEncoder().encode(rawBody).byteLength > MAX_RESPONSE_BYTES) {
      throw new Error("response exceeded 256KB");
    }
    const body = JSON.parse(rawBody) as { organic?: unknown };
    return normalizeResults(body.organic, (entry) => ({
      title: asString(entry.title),
      link: asString(entry.link),
      snippet: asString(entry.snippet),
      date: asString(entry.date),
    }));
  },
};

// Deliberately one provider. The chain shape is kept because it costs nothing
// and is where a replacement would slot in if MiniMax's endpoint ever changes,
// but no second vendor is configured: search rides the key and quota Pundit
// already pays for.
const PROVIDERS: SearchProvider[] = [minimaxProvider];

export interface WebSearchStatus {
  /** Provider that answered the most recent successful search. */
  lastGoodProvider: string | null;
  lastGoodAt: string | null;
  /** Searches that returned nothing from every enabled provider, since boot. */
  consecutiveFailures: number;
  totalSearches: number;
  /** Per-provider failure counts, so a silent format change is visible. */
  providerFailures: Record<string, number>;
  enabledProviders: string[];
}

const status: WebSearchStatus = {
  lastGoodProvider: null,
  lastGoodAt: null,
  consecutiveFailures: 0,
  totalSearches: 0,
  providerFailures: {},
  enabledProviders: [],
};

type CacheEntry = { expiresAt: number; results: WebSearchResult[] };
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<WebSearchResult[]>>();
let breakerOpenedAt = 0;
let halfOpenProbe = false;

export function getWebSearchStatus(): WebSearchStatus {
  return {
    ...status,
    providerFailures: { ...status.providerFailures },
    enabledProviders: PROVIDERS.filter((p) => p.enabled()).map((p) => p.name),
  };
}

// Test seam: the counters are process-wide, so suites that assert on them need
// a way back to a known state.
export function resetWebSearchStatus(): void {
  status.lastGoodProvider = null;
  status.lastGoodAt = null;
  status.consecutiveFailures = 0;
  status.totalSearches = 0;
  status.providerFailures = {};
  cache.clear();
  inFlight.clear();
  breakerOpenedAt = 0;
  halfOpenProbe = false;
}

/**
 * Returns [] only when every enabled provider failed or found nothing. Search
 * enhances an answer that already has model grounding, so an outage must
 * degrade the answer rather than fail the request -- the same posture
 * fixture-market-sources.ts takes toward odds providers.
 */
export async function searchWeb(query: string, signal?: AbortSignal): Promise<WebSearchResult[]> {
  const trimmed = query.trim().slice(0, MAX_QUERY_LENGTH);
  if (!trimmed) return [];

  const cacheKey = trimmed.toLocaleLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.results.map((result) => ({ ...result }));

  if (breakerOpenedAt) {
    if (Date.now() - breakerOpenedAt < BREAKER_OPEN_MS || halfOpenProbe) {
      console.warn(JSON.stringify({ event: "web_search_circuit_open" }));
      return [];
    }
    halfOpenProbe = true;
  }

  const existing = inFlight.get(cacheKey);
  if (existing) return existing;

  const request = searchUncached(trimmed, signal).finally(() => {
    inFlight.delete(cacheKey);
    halfOpenProbe = false;
  });
  inFlight.set(cacheKey, request);
  return request;
}

async function searchUncached(trimmed: string, signal?: AbortSignal): Promise<WebSearchResult[]> {
  const startedAt = Date.now();
  status.totalSearches += 1;

  for (const provider of PROVIDERS) {
    if (!provider.enabled()) continue;
    try {
      const results = await provider.run(trimmed, signal);
      if (results.length === 0) {
        // Not an error, but not usable either: fall through so a provider
        // returning structurally valid emptiness cannot mask a working one.
        continue;
      }
      status.lastGoodProvider = provider.name;
      status.lastGoodAt = new Date().toISOString();
      status.consecutiveFailures = 0;
      breakerOpenedAt = 0;
      cache.set(trimmed.toLocaleLowerCase(), {
        expiresAt: Date.now() + CACHE_TTL_MS,
        results,
      });
      console.log(JSON.stringify({
        event: "web_search_completed",
        provider: provider.name,
        outcome: "success",
        resultCount: results.length,
        durationMs: Date.now() - startedAt,
      }));
      return results;
    } catch (error) {
      if (signal?.aborted) throw error;
      status.providerFailures[provider.name] =
        (status.providerFailures[provider.name] ?? 0) + 1;
      console.warn(JSON.stringify({
        event: "web_search_provider_failed",
        provider: provider.name,
        message: error instanceof Error ? error.message.slice(0, 200) : String(error),
      }));
    }
  }

  status.consecutiveFailures += 1;
  if (status.consecutiveFailures >= BREAKER_FAILURES) breakerOpenedAt = Date.now();
  console.warn(JSON.stringify({
    event: "web_search_failed",
    outcome: "degraded",
    durationMs: Date.now() - startedAt,
    consecutiveFailures: status.consecutiveFailures,
    enabledProviders: PROVIDERS.filter((p) => p.enabled()).map((p) => p.name),
  }));
  return [];
}
