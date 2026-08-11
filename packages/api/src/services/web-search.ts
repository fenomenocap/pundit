// Web search for the chat tier.
//
// Anthropic's hosted web_search server tool had no MiniMax equivalent, so
// Pundit executes search itself and hands results back as a tool_result. The
// backend is MiniMax's own search endpoint: it authenticates with the same
// MINIMAX_API_KEY as inference and draws on the same coding-plan quota, so no
// second vendor, key or bill is involved.
//
// The endpoint is undocumented -- it was identified from the source of
// MiniMax's published `minimax-coding-plan-mcp` server, which is a thin wrapper
// over this call. That means it can change without notice, so every detail of
// the wire format is confined to this file: searchWeb's contract is what the
// rest of the codebase depends on, and swapping in Brave/Tavily later is a
// single-file change.

const SEARCH_URL = "https://api.minimax.io/v1/coding_plan/search";

// Well inside ask.ts's 90s REQUEST_TIMEOUT_MS: a turn may run several searches
// plus the model round trips, so no single search may monopolise the budget.
const TIMEOUT_MS = 15_000;

// Results past this add tokens without adding much signal -- the endpoint
// returns ~9 and the tail is typically aggregator pages.
const MAX_RESULTS = 6;

export interface WebSearchResult {
  title: string;
  link: string;
  snippet: string;
  /** ISO yyyy-mm-dd, or "" when the source published no usable date. */
  date: string;
}

interface RawResult {
  title?: unknown;
  link?: unknown;
  snippet?: unknown;
  date?: unknown;
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
 * The endpoint returns dates in mixed forms: absolute ("12 Apr 2026"), relative
 * ("19 hours ago") and frequently empty. ATTRIBUTION_RULES in ask.ts require a
 * source *and* a date, and the model cannot resolve "19 hours ago" into one
 * without knowing when the search ran -- so relative forms are converted here.
 *
 * Unparseable values become "" rather than a guess: an absent date makes the
 * model omit the claim or hedge it, whereas a wrong date is a fabricated
 * citation, which is the failure mode the sanitizers exist to prevent.
 */
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

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "";
  return new Date(parsed).toISOString().slice(0, 10);
}

/**
 * Returns [] on any failure. Search is an enhancement to an answer that already
 * has model grounding, so a search outage must degrade the answer rather than
 * fail the request -- the same posture fixture-market-sources.ts takes toward
 * odds providers.
 */
export async function searchWeb(query: string): Promise<WebSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) return [];

  try {
    const response = await fetch(SEARCH_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        // The endpoint is reached through MiniMax's MCP tooling in its
        // documented form; the header identifies the caller the same way.
        "MM-API-Source": "Minimax-MCP",
      },
      body: JSON.stringify({ q: trimmed }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn(JSON.stringify({
        event: "web_search_failed",
        status: response.status,
      }));
      return [];
    }
    const body = await response.json() as { organic?: unknown };
    const organic = Array.isArray(body.organic) ? body.organic : [];
    return organic
      .slice(0, MAX_RESULTS)
      .map((entry): WebSearchResult => {
        const raw = entry as RawResult;
        return {
          title: asString(raw.title),
          link: asString(raw.link),
          snippet: asString(raw.snippet),
          date: normalizeSearchDate(asString(raw.date)),
        };
      })
      .filter((result) => result.title !== "" && result.link !== "");
  } catch (error) {
    console.warn(JSON.stringify({
      event: "web_search_failed",
      message: error instanceof Error ? error.message.slice(0, 200) : String(error),
    }));
    return [];
  }
}
