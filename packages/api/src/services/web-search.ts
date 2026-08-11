// Web search for the chat tier.
//
// Anthropic's hosted web_search server tool had no MiniMax equivalent, so
// Pundit executes search itself and hands results back as a tool_result.
//
// Providers are tried in order and the first to return results wins:
//
//   1. MiniMax  -- same MINIMAX_API_KEY as inference, same coding-plan quota,
//                  so no second vendor, key or bill. Always enabled.
//   2. Brave    -- only when BRAVE_API_KEY is set. Present because the MiniMax
//                  endpoint is undocumented: it was identified from the source
//                  of MiniMax's published `minimax-coding-plan-mcp` server and
//                  can change without notice. Setting the key restores search
//                  through an environment variable rather than a code deploy.
//
// Every detail of each wire format is confined to this file. The rest of the
// codebase depends only on searchWeb's contract, so adding or reordering
// providers never reaches ask.ts.

// Well inside ask.ts's 90s REQUEST_TIMEOUT_MS: a turn may run several searches
// plus the model round trips, so no single search may monopolise the budget.
const TIMEOUT_MS = 15_000;

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
  if (ISO_DATE_ONLY.test(value)) return value;

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "";
  const date = new Date(parsed);

  // A calendar date with no time ("12 Apr 2026") is parsed as *local*
  // midnight, so formatting it as UTC moved it to the previous day anywhere
  // east of Greenwich -- a published date silently off by one. Local
  // components give the date back as written. Anything carrying a real instant
  // is formatted as UTC, which is what its source meant.
  return HAS_TIME_OR_ZONE.test(value)
    ? date.toISOString().slice(0, 10)
    : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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
      return { ...raw, date: normalizeSearchDate(raw.date) };
    })
    .filter((result) => result.title !== "" && result.link !== "");
}

interface SearchProvider {
  name: string;
  enabled(): boolean;
  run(query: string): Promise<WebSearchResult[]>;
}

// MiniMax's own search, behind the same key and quota as inference.
const minimaxProvider: SearchProvider = {
  name: "minimax",
  enabled: () => Boolean(process.env.MINIMAX_API_KEY),
  async run(query) {
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
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const body = await response.json() as { organic?: unknown };
    return normalizeResults(body.organic, (entry) => ({
      title: asString(entry.title),
      link: asString(entry.link),
      snippet: asString(entry.snippet),
      date: asString(entry.date),
    }));
  },
};

// Standby for the day the undocumented MiniMax endpoint changes shape.
const braveProvider: SearchProvider = {
  name: "brave",
  enabled: () => Boolean(process.env.BRAVE_API_KEY),
  async run(query) {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(MAX_RESULTS));
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "x-subscription-token": String(process.env.BRAVE_API_KEY),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const body = await response.json() as { web?: { results?: unknown } };
    return normalizeResults(body.web?.results, (entry) => ({
      title: asString(entry.title),
      link: asString(entry.url),
      snippet: asString(entry.description),
      date: asString(entry.page_age ?? entry.age),
    }));
  },
};

const PROVIDERS: SearchProvider[] = [minimaxProvider, braveProvider];

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
}

/**
 * Returns [] only when every enabled provider failed or found nothing. Search
 * enhances an answer that already has model grounding, so an outage must
 * degrade the answer rather than fail the request -- the same posture
 * fixture-market-sources.ts takes toward odds providers.
 */
export async function searchWeb(query: string): Promise<WebSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  status.totalSearches += 1;

  for (const provider of PROVIDERS) {
    if (!provider.enabled()) continue;
    try {
      const results = await provider.run(trimmed);
      if (results.length === 0) {
        // Not an error, but not usable either: fall through so a provider
        // returning structurally valid emptiness cannot mask a working one.
        continue;
      }
      status.lastGoodProvider = provider.name;
      status.lastGoodAt = new Date().toISOString();
      status.consecutiveFailures = 0;
      return results;
    } catch (error) {
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
  console.warn(JSON.stringify({
    event: "web_search_failed",
    consecutiveFailures: status.consecutiveFailures,
    enabledProviders: PROVIDERS.filter((p) => p.enabled()).map((p) => p.name),
  }));
  return [];
}
