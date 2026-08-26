// Web search for the chat tier.
//
// Anthropic's hosted web_search server tool had no MiniMax equivalent, so
// Pundit executes search itself and hands results back as a tool_result.
//
// Search is a *provider chain*, not a vendor. MiniMax's own search endpoint is
// still first by default because it rides a key Pundit already pays for, but it
// is undocumented, subscription-metered, and throttles under exactly the load a
// researched answer creates -- so it is treated as an optional provider. A
// second, documented provider (Brave) sits behind the same seam and takes over
// automatically. Either can be made primary through WEB_SEARCH_PROVIDER_ORDER
// without touching this file.
//
// Two invariants hold the design together:
//   1. A provider failure is never reported as "no results". The caller gets a
//      typed outcome and can degrade on purpose. Silent [] is what turned a
//      rate limit into "the model got worse".
//   2. Breaker health is per provider and counted per *question*. One question
//      fans out into ~6 searches; it must never be able to open a breaker by
//      itself, and one provider's outage must never disable the other.

// Well inside ask.ts's REQUEST_TIMEOUT_MS: a turn may run several searches plus
// the model round trips, so no single search may monopolise the budget.
const TIMEOUT_MS = 10_000;
// Team news, form and predicted XIs move on the scale of a news cycle; prices
// move constantly. One five-minute TTL for both meant every question re-ran
// every search, which on a subscription key sized for one user is the whole
// rate-limit problem in one line.
const CACHE_TTL_MS = 30 * 60_000;
const VOLATILE_CACHE_TTL_MS = 5 * 60_000;
const VOLATILE_QUERY = /\b(?:odds|price|prices|line|lines|movement|moved|prop|props|market)\b/i;
// Consecutive *questions* in which a provider failed every attempt. Counted per
// question, so the six searches behind one answer contribute at most one.
const BREAKER_FAILED_QUESTIONS = 3;
const BREAKER_OPEN_MS = 5 * 60_000;
const MAX_QUERY_LENGTH = 256;
const MAX_TITLE_LENGTH = 200;
const MAX_SNIPPET_LENGTH = 600;
const MAX_URL_LENGTH = 2_048;
const MAX_RESPONSE_BYTES = 256 * 1024;

// One retry per provider per search, and no more. A throttled provider answers
// a retry storm with more throttling; the fallback provider is the real remedy.
const MAX_ATTEMPTS_PER_PROVIDER = 2;
const RETRY_BASE_MS = 250;
// Retry-After can be minutes. Waiting that long inside a 10s search budget just
// burns the request, so an over-long hint means "give up on this provider and
// let the next one answer".
const RETRY_DELAY_CAP_MS = 1_500;

// Results past this add tokens without adding much signal -- the endpoints
// return ~9 and the tail is typically aggregator pages.
const MAX_RESULTS = 6;

/**
 * How many searches may be in the air process-wide. One question now plans
 * several, and firing them together is the burst shape a key sized for one
 * person at a keyboard is least able to absorb. This is a *load* control and is
 * deliberately independent of provider health: throttling a burst and declaring
 * a provider unhealthy are different decisions.
 */
function searchConcurrency(): number {
  const raw = Number(process.env.WEB_SEARCH_CONCURRENCY);
  return Number.isFinite(raw) && raw >= 1 ? Math.min(Math.floor(raw), 8) : DEFAULT_CONCURRENCY;
}

/**
 * Four, not two.
 *
 * Two was set to protect a subscription key from a burst, before anyone had
 * checked whether the burst was a problem. It has since been measured: across
 * every search production has run, `providerFailures` is empty and
 * `lastThrottledAt` is null -- MiniMax has never once throttled us. Meanwhile
 * the six searches behind a researched answer were being run three waves deep,
 * on the critical path, in front of a reader waiting for the answer.
 *
 * Four halves the waves and still keeps a burst ceiling, and the breaker,
 * failover and typed outcomes all sit underneath it if that ever changes. Raise
 * it with WEB_SEARCH_CONCURRENCY (max 8) rather than editing this.
 */
const DEFAULT_CONCURRENCY = 4;

export interface WebSearchResult {
  title: string;
  link: string;
  snippet: string;
  /** ISO yyyy-mm-dd, or "" when the source published no usable date. */
  date: string;
}

/**
 * Why a search produced no usable evidence. The whole point of the type is that
 * `empty` and every other member are different facts: the first is the web's
 * answer, the rest are Pundit's own infrastructure failing.
 */
export type WebSearchFailureReason =
  | "rate_limited"
  | "provider_unavailable"
  | "timeout"
  | "circuit_open"
  | "malformed_response"
  | "not_configured"
  | "providers_exhausted";

export interface ProviderAttempt {
  provider: string;
  outcome: "ok" | "empty" | "failed" | "skipped";
  reason: WebSearchFailureReason | null;
  attempts: number;
}

export interface WebSearchOutcome {
  /**
   * `ok`        -- evidence retrieved.
   * `empty`     -- a healthy provider searched and the web had nothing. A real
   *                answer about the world, safe to tell the model.
   * `degraded`  -- Pundit could not search. Never conflate with `empty`.
   */
  status: "ok" | "empty" | "degraded";
  results: WebSearchResult[];
  /** Provider that answered, when one did. */
  provider: string | null;
  /** Set exactly when status is "degraded". */
  reason: WebSearchFailureReason | null;
  /** True when a provider other than the configured primary answered. */
  usedFallback: boolean;
  /** What each enabled provider did, in order, for this search. */
  attempts: ProviderAttempt[];
}

function outcomeIsUsable(outcome: WebSearchOutcome): boolean {
  return outcome.status === "ok";
}

/** Convenience for callers that only want the rows. */
export function resultsOf(outcome: WebSearchOutcome): WebSearchResult[] {
  return outcome.results;
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

// ─── Provider seam ──────────────────────────────────────────────────────────

/**
 * A provider failure carrying the reason the caller needs. `retryAfterMs` is
 * only ever a hint; the caller caps it.
 */
class ProviderError extends Error {
  constructor(
    readonly reason: WebSearchFailureReason,
    message: string,
    readonly retryAfterMs: number | null = null,
    /**
     * Whether trying the same provider again could plausibly help. A throttle,
     * a 5xx and a timeout can clear in a moment; a rejected key or a 4xx will
     * answer a retry with the same error, so retrying it only spends budget the
     * fallback provider needs.
     */
    readonly retryable: boolean = false
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

interface SearchProvider {
  name: string;
  enabled(): boolean;
  run(query: string, signal?: AbortSignal): Promise<WebSearchResult[]>;
}

/** Maps a transport-level throw onto the taxonomy. */
function classifyThrown(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError" || /timed?\s*out|timeout|abort/i.test(message)) {
    return new ProviderError("timeout", message, null, true);
  }
  if (error instanceof SyntaxError) return new ProviderError("malformed_response", message);
  // A transport error (DNS, reset connection) is the network being unwell, and
  // is worth exactly one more attempt.
  return new ProviderError("provider_unavailable", message, null, true);
}

/** HTTP status onto the taxonomy, shared by every provider. */
function classifyHttpStatus(status: number, retryAfterMs: number | null): ProviderError {
  if (status === 429) {
    return new ProviderError("rate_limited", "status 429 (rate limited)", retryAfterMs, true);
  }
  if (status === 401 || status === 403) {
    // A rejected key is a configuration fault, not a transient one: retrying it
    // is pure waste and the next provider is the only useful move.
    return new ProviderError("not_configured", `status ${status} (rejected credential)`);
  }
  // 5xx may clear; any other 4xx is a contract mismatch that a retry repeats.
  return new ProviderError(
    "provider_unavailable",
    `status ${status}`,
    retryAfterMs,
    status >= 500
  );
}

function retryAfterMs(response: { headers?: { get?(name: string): string | null } }): number | null {
  const raw = response.headers?.get?.("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const at = Date.parse(raw);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

function requestSignalFor(requestSignal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  return requestSignal ? AbortSignal.any([requestSignal, timeout]) : timeout;
}

/**
 * Reads a response body under a size cap. Providers are untrusted input: an
 * unbounded body is a memory and token hazard, and a body that will not parse
 * is a `malformed_response`, not an outage.
 */
async function readBoundedJson(response: {
  body?: ReadableStream<Uint8Array> | null;
  text?: () => Promise<string>;
  json: () => Promise<unknown>;
}): Promise<Record<string, unknown>> {
  const rawBody = await readBodyWithinCap(response);
  try {
    return JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    throw new ProviderError("malformed_response", "response was not JSON");
  }
}

/**
 * The cap has to be enforced *while* reading. Checking the length of an
 * already-buffered `text()` cannot prevent anything: by the time the check
 * runs the whole body is in memory, which is the exact hazard the cap is for,
 * and a provider having a bad day -- or a hijacked endpoint override -- could
 * hand back a body large enough to matter. Streaming stops at the limit and
 * releases the connection.
 */
async function readBodyWithinCap(response: {
  body?: ReadableStream<Uint8Array> | null;
  text?: () => Promise<string>;
  json: () => Promise<unknown>;
}): Promise<string> {
  const tooLarge = () => new ProviderError("malformed_response", "response exceeded 256KB");
  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let read = 0;
    let text = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        read += value.byteLength;
        if (read > MAX_RESPONSE_BYTES) throw tooLarge();
        text += decoder.decode(value, { stream: true });
      }
    } finally {
      // Cancelling an already-finished stream is a no-op, so this covers both
      // the over-cap bail-out and an ordinary read.
      await reader.cancel().catch(() => undefined);
    }
    return text + decoder.decode();
  }
  const rawBody = typeof response.text === "function"
    ? await response.text()
    : JSON.stringify(await response.json());
  if (new TextEncoder().encode(rawBody).byteLength > MAX_RESPONSE_BYTES) throw tooLarge();
  return rawBody;
}

/**
 * MiniMax's own search. Undocumented -- identified from the source of MiniMax's
 * published `minimax-coding-plan-mcp` server -- and metered against the coding
 * plan, so it is optional by construction: the chain runs without it.
 *
 * It reads MINIMAX_SEARCH_API_KEY first so search can be pointed at a key that
 * is not the one serving inference. Falling back to MINIMAX_API_KEY keeps every
 * existing deployment working unchanged.
 */
const minimaxProvider: SearchProvider = {
  name: "minimax",
  enabled: () => Boolean(process.env.MINIMAX_SEARCH_API_KEY || process.env.MINIMAX_API_KEY),
  async run(query, requestSignal) {
    const key = process.env.MINIMAX_SEARCH_API_KEY || process.env.MINIMAX_API_KEY;
    const response = await fetch(
      process.env.MINIMAX_SEARCH_URL || "https://api.minimax.io/v1/coding_plan/search",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
          // The endpoint is reached through MiniMax's MCP tooling in its
          // documented form; the header identifies the caller the same way.
          "MM-API-Source": "Minimax-MCP",
        },
        body: JSON.stringify({ q: query }),
        signal: requestSignalFor(requestSignal),
      }
    );
    if (!response.ok) throw classifyHttpStatus(response.status, retryAfterMs(response));
    const body = await readBoundedJson(response);
    return normalizeResults(body.organic, (entry) => ({
      title: asString(entry.title),
      link: asString(entry.link),
      snippet: asString(entry.snippet),
      date: asString(entry.date),
    }));
  },
};

/**
 * Brave Search. The documented, contractual half of the chain: a published API
 * with its own key, its own quota and its own status page, so an answer is no
 * longer hostage to one undocumented subscription endpoint.
 *
 * Chosen over Serper/Exa/Tavily because it is a first-party index reached with
 * a plain GET and one header -- the smallest adapter of the four, and the one
 * least likely to need maintenance.
 */
const braveProvider: SearchProvider = {
  name: "brave",
  enabled: () => Boolean(process.env.BRAVE_SEARCH_API_KEY),
  async run(query, requestSignal) {
    const endpoint = new URL(
      process.env.BRAVE_SEARCH_URL || "https://api.search.brave.com/res/v1/web/search"
    );
    endpoint.searchParams.set("q", query);
    endpoint.searchParams.set("count", String(MAX_RESULTS));
    const response = await fetch(endpoint.toString(), {
      method: "GET",
      headers: {
        accept: "application/json",
        "accept-encoding": "gzip",
        "x-subscription-token": process.env.BRAVE_SEARCH_API_KEY as string,
      },
      signal: requestSignalFor(requestSignal),
    });
    if (!response.ok) throw classifyHttpStatus(response.status, retryAfterMs(response));
    const body = await readBoundedJson(response);
    const web = (body.web ?? {}) as { results?: unknown };
    return normalizeResults(web.results, (entry) => ({
      title: asString(entry.title),
      link: asString(entry.url),
      snippet: asString(entry.description),
      // `page_age` is an ISO instant when Brave knows it; `age` is the human
      // form ("3 days ago"), which normalizeSearchDate already understands.
      date: asString(entry.page_age) || asString(entry.age),
    }));
  },
};

const KNOWN_PROVIDERS: SearchProvider[] = [minimaxProvider, braveProvider];
const DEFAULT_ORDER = ["minimax", "brave"];

/**
 * Resolved per call so an operator can reorder providers -- including promoting
 * the fallback to primary -- with an environment variable and a restart, with
 * no application change. Unknown names are ignored rather than fatal: a typo
 * must not take search down.
 */
function providerChain(): SearchProvider[] {
  const configured = (process.env.WEB_SEARCH_PROVIDER_ORDER ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  const order = configured.length ? configured : DEFAULT_ORDER;
  const chain = order
    .map((name) => KNOWN_PROVIDERS.find((provider) => provider.name === name))
    .filter((provider): provider is SearchProvider => Boolean(provider));
  // Anything the operator did not name still trails the chain, so adding a key
  // is enough to gain a fallback.
  for (const provider of KNOWN_PROVIDERS) {
    if (!chain.includes(provider)) chain.push(provider);
  }
  return chain;
}

function enabledChain(): SearchProvider[] {
  return providerChain().filter((provider) => provider.enabled());
}

// ─── Provider health ────────────────────────────────────────────────────────

export interface ProviderHealth {
  enabled: boolean;
  /** Consecutive *questions* in which this provider failed every attempt. */
  consecutiveFailedQuestions: number;
  /** Total individual search failures since boot. */
  failures: number;
  successes: number;
  circuitOpen: boolean;
  circuitOpensUntil: string | null;
  lastGoodAt: string | null;
  lastThrottledAt: string | null;
  lastFailureReason: WebSearchFailureReason | null;
}

interface HealthState {
  consecutiveFailedQuestions: number;
  failures: number;
  successes: number;
  openedAt: number;
  halfOpenProbe: boolean;
  lastGoodAt: string | null;
  lastThrottledAt: string | null;
  lastFailureReason: WebSearchFailureReason | null;
}

function freshHealth(): HealthState {
  return {
    consecutiveFailedQuestions: 0,
    failures: 0,
    successes: 0,
    openedAt: 0,
    halfOpenProbe: false,
    lastGoodAt: null,
    lastThrottledAt: null,
    lastFailureReason: null,
  };
}

const health = new Map<string, HealthState>();

function healthOf(name: string): HealthState {
  let state = health.get(name);
  if (!state) {
    state = freshHealth();
    health.set(name, state);
  }
  return state;
}

function circuitIsOpen(state: HealthState): boolean {
  return state.openedAt > 0 && Date.now() - state.openedAt < BREAKER_OPEN_MS;
}

export interface WebSearchStatus {
  /** Provider that answered the most recent successful search. */
  lastGoodProvider: string | null;
  lastGoodAt: string | null;
  /** Questions in which no enabled provider produced evidence, consecutively. */
  consecutiveFailures: number;
  totalSearches: number;
  /** Searches that ended in a typed infrastructure failure, since boot. */
  degradedSearches: number;
  /** Per-provider failure counts, so a silent format change is visible. */
  providerFailures: Record<string, number>;
  /**
   * When any provider last answered 429, and whether every enabled provider's
   * breaker is open right now. Degradation is quiet by design -- a failed search
   * returns no evidence and the answer falls back to the grounding payload -- so
   * without these a rate limit reaches the reader looking like a drop in answer
   * quality rather than an outage.
   */
  lastThrottledAt: string | null;
  circuitOpen: boolean;
  enabledProviders: string[];
  /** Chain order in effect, including providers with no key configured. */
  configuredProviders: string[];
  primaryProvider: string | null;
  /** True when the most recent successful search was not served by the primary. */
  usingFallback: boolean;
  /** Reason the most recent degraded search gave up. */
  lastDegradedReason: WebSearchFailureReason | null;
  lastDegradedAt: string | null;
  providers: Record<string, ProviderHealth>;
  concurrencyLimit: number;
}

const status = {
  lastGoodProvider: null as string | null,
  lastGoodAt: null as string | null,
  consecutiveFailures: 0,
  totalSearches: 0,
  degradedSearches: 0,
  lastThrottledAt: null as string | null,
  lastDegradedReason: null as WebSearchFailureReason | null,
  lastDegradedAt: null as string | null,
};

export function getWebSearchStatus(): WebSearchStatus {
  const chain = providerChain();
  const enabled = chain.filter((provider) => provider.enabled());
  const providerFailures: Record<string, number> = {};
  const providers: Record<string, ProviderHealth> = {};
  for (const provider of chain) {
    const state = healthOf(provider.name);
    if (state.failures > 0) providerFailures[provider.name] = state.failures;
    providers[provider.name] = {
      enabled: provider.enabled(),
      consecutiveFailedQuestions: state.consecutiveFailedQuestions,
      failures: state.failures,
      successes: state.successes,
      circuitOpen: circuitIsOpen(state),
      circuitOpensUntil: circuitIsOpen(state)
        ? new Date(state.openedAt + BREAKER_OPEN_MS).toISOString()
        : null,
      lastGoodAt: state.lastGoodAt,
      lastThrottledAt: state.lastThrottledAt,
      lastFailureReason: state.lastFailureReason,
    };
  }
  const primary = enabled[0]?.name ?? null;
  return {
    ...status,
    providerFailures,
    // Search is only truly out when *every* enabled provider is out; one open
    // breaker with a healthy fallback behind it is not an outage.
    circuitOpen: enabled.length > 0 && enabled.every((p) => circuitIsOpen(healthOf(p.name))),
    enabledProviders: enabled.map((provider) => provider.name),
    configuredProviders: chain.map((provider) => provider.name),
    primaryProvider: primary,
    usingFallback: Boolean(
      status.lastGoodProvider && primary && status.lastGoodProvider !== primary
    ),
    providers,
    concurrencyLimit: searchConcurrency(),
  };
}

// Test seam: the counters are process-wide, so suites that assert on them need
// a way back to a known state.
export function resetWebSearchStatus(): void {
  status.lastGoodProvider = null;
  status.lastGoodAt = null;
  status.consecutiveFailures = 0;
  status.totalSearches = 0;
  status.degradedSearches = 0;
  status.lastThrottledAt = null;
  status.lastDegradedReason = null;
  status.lastDegradedAt = null;
  health.clear();
  cache.clear();
  inFlight.clear();
}

// ─── Question scope ─────────────────────────────────────────────────────────

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * One user question's searches, so breaker accounting can ask "did this
 * *question* fail?" rather than "did this search fail?". Without it, the six
 * searches behind one answer were six votes toward a five-minute global outage,
 * and the three model-driven tool searches on the same question could open the
 * breaker for the *next* reader -- which is precisely the bug this replaces.
 */
interface QuestionScope {
  succeeded: Set<string>;
  failed: Set<string>;
  searches: number;
}

const questionScope = new AsyncLocalStorage<QuestionScope>();

/**
 * Runs `fn` with every search inside it accounted as one question. Nesting is a
 * no-op so an inner batch cannot double-count.
 */
export async function withSearchQuestion<T>(fn: () => Promise<T>): Promise<T> {
  if (questionScope.getStore()) return fn();
  const scope: QuestionScope = { succeeded: new Set(), failed: new Set(), searches: 0 };
  try {
    return await questionScope.run(scope, fn);
  } finally {
    settleQuestion(scope);
  }
}

/**
 * Folds a finished question into provider health. A provider that answered at
 * least once is healthy regardless of how many of the question's other searches
 * it lost; a provider that only ever failed adds exactly one to its streak.
 */
function settleQuestion(scope: QuestionScope): void {
  if (scope.searches === 0) return;
  for (const name of scope.succeeded) {
    const state = healthOf(name);
    state.consecutiveFailedQuestions = 0;
    state.openedAt = 0;
    state.halfOpenProbe = false;
  }
  for (const name of scope.failed) {
    if (scope.succeeded.has(name)) continue;
    const state = healthOf(name);
    state.consecutiveFailedQuestions += 1;
    const tripping = !state.openedAt
      && state.consecutiveFailedQuestions >= BREAKER_FAILED_QUESTIONS;
    // Already tripped and still failing: the half-open probe did not recover,
    // so start a fresh open window rather than leaving an expired one behind.
    const reArming = state.openedAt > 0;
    if (!tripping && !reArming) continue;
    state.openedAt = Date.now();
    state.halfOpenProbe = false;
    console.warn(JSON.stringify({
      event: tripping ? "web_search_circuit_opened" : "web_search_circuit_reopened",
      provider: name,
      consecutiveFailedQuestions: state.consecutiveFailedQuestions,
      reopensAt: new Date(Date.now() + BREAKER_OPEN_MS).toISOString(),
      lastFailureReason: state.lastFailureReason,
    }));
  }
  // Question-level verdict, for the operator: did this reader get evidence?
  if (scope.succeeded.size > 0) status.consecutiveFailures = 0;
  else status.consecutiveFailures += 1;
}

function recordProviderSuccess(name: string): void {
  const scope = questionScope.getStore();
  scope?.succeeded.add(name);
  const state = healthOf(name);
  state.successes += 1;
  state.lastGoodAt = new Date().toISOString();
  // A success closes the breaker immediately: health is evidence-driven, and
  // holding a working provider shut serves nobody.
  state.consecutiveFailedQuestions = 0;
  state.openedAt = 0;
  state.halfOpenProbe = false;
}

function recordProviderFailure(name: string, reason: WebSearchFailureReason): void {
  questionScope.getStore()?.failed.add(name);
  const state = healthOf(name);
  state.failures += 1;
  state.lastFailureReason = reason;
  if (reason === "rate_limited") {
    const at = new Date().toISOString();
    state.lastThrottledAt = at;
    status.lastThrottledAt = at;
  }
}

// ─── Concurrency gate ───────────────────────────────────────────────────────

let active = 0;
const waiters: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  while (active >= searchConcurrency()) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  active += 1;
}

function releaseSlot(): void {
  active -= 1;
  waiters.shift()?.();
}

type CacheEntry = { expiresAt: number; results: WebSearchResult[] };
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<WebSearchOutcome>>();

function cloneOutcome(outcome: WebSearchOutcome): WebSearchOutcome {
  return { ...outcome, results: outcome.results.map((result) => ({ ...result })) };
}

function degraded(
  reason: WebSearchFailureReason,
  attempts: ProviderAttempt[] = []
): WebSearchOutcome {
  return { status: "degraded", results: [], provider: null, reason, usedFallback: false, attempts };
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

/** Jittered so a burst of throttled searches does not retry in lockstep. */
function backoffFor(attempt: number, hint: number | null): number {
  const base = RETRY_BASE_MS * 2 ** (attempt - 1);
  const wanted = hint ?? base;
  if (hint !== null && hint > RETRY_DELAY_CAP_MS) return -1; // too long: fail over instead
  return Math.min(wanted, RETRY_DELAY_CAP_MS) * (0.5 + Math.random());
}

// ─── Public entry points ────────────────────────────────────────────────────

/**
 * Runs one question's planned searches under a single question scope, bounded
 * concurrency, and provider failover.
 */
export async function searchWebBatch(
  queries: readonly string[],
  signal?: AbortSignal
): Promise<WebSearchOutcome[]> {
  if (queries.length === 0) return [];
  return withSearchQuestion(async () => {
    const outcomes: WebSearchOutcome[] = new Array(queries.length);
    let next = 0;
    const worker = async (): Promise<void> => {
      for (let index = next++; index < queries.length; index = next++) {
        outcomes[index] = await searchWeb(queries[index], signal)
          .catch((error) => degraded(classifyThrown(error).reason));
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(searchConcurrency(), queries.length) }, worker)
    );
    const usable = outcomes.filter(outcomeIsUsable).length;
    console.log(JSON.stringify({
      event: "web_search_batch_completed",
      queries: queries.length,
      withEvidence: usable,
      degraded: outcomes.filter((outcome) => outcome.status === "degraded").length,
      empty: outcomes.filter((outcome) => outcome.status === "empty").length,
      providers: [...new Set(outcomes.map((o) => o.provider).filter(Boolean))],
      usedFallback: outcomes.some((outcome) => outcome.usedFallback),
    }));
    return outcomes;
  });
}

/**
 * Searches the web, returning a typed outcome.
 *
 * It never reports an infrastructure failure as an empty result set: `empty`
 * means a healthy provider searched and the web had nothing, and every other
 * failure carries its own reason so the caller can degrade on purpose.
 */
export async function searchWeb(
  query: string,
  signal?: AbortSignal
): Promise<WebSearchOutcome> {
  const trimmed = query.trim().slice(0, MAX_QUERY_LENGTH);
  if (!trimmed) {
    return { status: "empty", results: [], provider: null, reason: null, usedFallback: false, attempts: [] };
  }

  const cacheKey = trimmed.toLocaleLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      status: "ok",
      results: cached.results.map((result) => ({ ...result })),
      provider: status.lastGoodProvider,
      reason: null,
      usedFallback: false,
      attempts: [],
    };
  }

  const existing = inFlight.get(cacheKey);
  if (existing) return existing.then(cloneOutcome);

  const request = searchUncached(trimmed, signal).finally(() => inFlight.delete(cacheKey));
  inFlight.set(cacheKey, request);
  return request.then(cloneOutcome);
}

/**
 * Walks the enabled chain. A provider is skipped when its own breaker is open;
 * it is retried once on a transient fault; and any failure -- throttle, outage,
 * timeout, garbage payload -- moves to the next provider rather than being
 * mistaken for the web having no answer.
 */
async function searchUncached(trimmed: string, signal?: AbortSignal): Promise<WebSearchOutcome> {
  const startedAt = Date.now();
  status.totalSearches += 1;
  const scope = questionScope.getStore();
  if (scope) scope.searches += 1;

  const chain = enabledChain();
  const attempts: ProviderAttempt[] = [];
  if (chain.length === 0) {
    return finishDegraded("not_configured", attempts, trimmed, startedAt);
  }
  const primary = chain[0].name;
  let sawEmpty = false;

  for (const provider of chain) {
    const state = healthOf(provider.name);
    const skip = (): void => {
      attempts.push({ provider: provider.name, outcome: "skipped", reason: "circuit_open", attempts: 0 });
      console.warn(JSON.stringify({
        event: "web_search_circuit_open",
        provider: provider.name,
        reopensAt: new Date(state.openedAt + BREAKER_OPEN_MS).toISOString(),
      }));
    };
    if (circuitIsOpen(state)) {
      skip();
      continue;
    }
    if (state.openedAt > 0) {
      // The open window has elapsed. Exactly one probe at a time is allowed
      // through, so recovery is detected without a thundering herd against a
      // provider that may still be down. A probe that fails re-arms the window
      // in settleQuestion; without that the breaker would stay expired and let
      // every subsequent search upstream, protecting nothing after the first
      // window.
      if (state.halfOpenProbe) {
        skip();
        continue;
      }
      state.halfOpenProbe = true;
    }

    // Whether this provider has already lost a search earlier in this same
    // question. Captured before the attempt, because the attempt itself will
    // add to that set. Once a provider is known-bad for this question, its
    // retry is dropped: retrying is a bet on a transient blip, and the bet has
    // already been settled. Without this, one question's six searches doubled
    // into twelve calls against a provider that was plainly down.
    const alreadyFailedThisQuestion = questionScope.getStore()?.failed.has(provider.name) ?? false;

    let tries = 0;
    let lastReason: WebSearchFailureReason = "provider_unavailable";
    // Distinguishes "this provider answered, with nothing" from "this provider
    // ran out of attempts"; both leave the retry loop, and only the second is a
    // failure to record.
    let answeredEmpty = false;
    while (tries < MAX_ATTEMPTS_PER_PROVIDER) {
      tries += 1;
      await acquireSlot();
      let results: WebSearchResult[] | null = null;
      let failure: ProviderError | null = null;
      try {
        results = await provider.run(trimmed, signal);
      } catch (error) {
        // The slot is released by `finally` on every path, including this one.
        // Releasing it here as well double-decremented `active`, so each
        // cancelled search permanently widened the gate: after enough aborted
        // requests `active` goes negative, `acquireSlot` stops blocking, and
        // the burst control that exists to keep a subscription key under its
        // rate limit is silently gone.
        if (signal?.aborted) throw error;
        failure = classifyThrown(error);
      } finally {
        releaseSlot();
      }

      if (results) {
        if (results.length === 0) {
          // Structurally valid emptiness. Not a failure -- do not count it
          // against the provider -- but try the next one before telling the
          // model the web had nothing.
          sawEmpty = true;
          answeredEmpty = true;
          recordProviderSuccess(provider.name);
          attempts.push({ provider: provider.name, outcome: "empty", reason: null, attempts: tries });
          break;
        }
        recordProviderSuccess(provider.name);
        status.lastGoodProvider = provider.name;
        status.lastGoodAt = new Date().toISOString();
        cache.set(trimmed.toLocaleLowerCase(), {
          expiresAt: Date.now()
            + (VOLATILE_QUERY.test(trimmed) ? VOLATILE_CACHE_TTL_MS : CACHE_TTL_MS),
          results,
        });
        attempts.push({ provider: provider.name, outcome: "ok", reason: null, attempts: tries });
        const usedFallback = provider.name !== primary;
        console.log(JSON.stringify({
          event: "web_search_completed",
          provider: provider.name,
          outcome: "success",
          resultCount: results.length,
          durationMs: Date.now() - startedAt,
          attempts: tries,
          usedFallback,
          ...(usedFallback ? { primaryProvider: primary } : {}),
        }));
        return { status: "ok", results, provider: provider.name, reason: null, usedFallback, attempts };
      }

      const error = failure as ProviderError;
      lastReason = error.reason;
      recordProviderFailure(provider.name, error.reason);
      const wait = error.retryable && !alreadyFailedThisQuestion
        && tries < MAX_ATTEMPTS_PER_PROVIDER
        ? backoffFor(tries, error.retryAfterMs)
        : -1;
      console.warn(JSON.stringify({
        event: error.reason === "rate_limited" ? "web_search_rate_limited" : "web_search_provider_failed",
        provider: provider.name,
        reason: error.reason,
        attempt: tries,
        willRetry: wait >= 0,
        retryInMs: wait >= 0 ? Math.round(wait) : null,
        message: error.message.slice(0, 200),
      }));
      if (wait < 0) break;
      await delay(wait, signal);
    }
    if (answeredEmpty) continue;
    attempts.push({ provider: provider.name, outcome: "failed", reason: lastReason, attempts: tries });
    const nextProvider = chain[chain.indexOf(provider) + 1];
    if (nextProvider) {
      console.warn(JSON.stringify({
        event: "web_search_failover",
        from: provider.name,
        to: nextProvider.name,
        reason: lastReason,
      }));
    }
  }

  // Every enabled provider answered structurally, and none had anything: this
  // is the web's answer, not an outage.
  if (sawEmpty && attempts.every((attempt) => attempt.outcome !== "failed")) {
    console.log(JSON.stringify({
      event: "web_search_completed",
      outcome: "empty",
      durationMs: Date.now() - startedAt,
    }));
    return { status: "empty", results: [], provider: null, reason: null, usedFallback: false, attempts };
  }

  const everySkipped = attempts.length > 0 && attempts.every((a) => a.outcome === "skipped");
  const reason: WebSearchFailureReason = everySkipped
    ? "circuit_open"
    : attempts.length > 1
      ? "providers_exhausted"
      : (attempts.find((a) => a.outcome === "failed")?.reason ?? "providers_exhausted");
  return finishDegraded(reason, attempts, trimmed, startedAt);
}

function finishDegraded(
  reason: WebSearchFailureReason,
  attempts: ProviderAttempt[],
  query: string,
  startedAt: number
): WebSearchOutcome {
  status.degradedSearches += 1;
  status.lastDegradedReason = reason;
  status.lastDegradedAt = new Date().toISOString();
  console.warn(JSON.stringify({
    event: "web_search_degraded",
    outcome: "degraded",
    reason,
    // The operator's headline: answer quality dropped because retrieval failed,
    // not because the model got worse.
    impact: "answer_has_no_search_evidence",
    durationMs: Date.now() - startedAt,
    queryLength: query.length,
    attempts,
    enabledProviders: enabledChain().map((provider) => provider.name),
  }));
  return degraded(reason, attempts);
}
