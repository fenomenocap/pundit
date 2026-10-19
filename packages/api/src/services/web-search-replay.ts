import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { WebSearchOutcome } from "./web-search";

export const SEARCH_REPLAY_SCHEMA_VERSION = 1;

export interface WebSearchReplayBundle {
  schemaVersion: typeof SEARCH_REPLAY_SCHEMA_VERSION;
  replayId: string;
  recordedAt?: string;
  queries: Record<string, WebSearchOutcome>;
}

export interface WebSearchReplayScope {
  replayId: string;
  recordPath: string | null;
}

const replayScope = new AsyncLocalStorage<WebSearchReplayScope>();

const bundleCache = new Map<string, WebSearchReplayBundle>();

export function normalizeSearchReplayQuery(query: string): string {
  return query.trim().toLocaleLowerCase().slice(0, 256);
}

function fixturesRoot(): string {
  const configured = process.env.CHAT_EVAL_SEARCH_REPLAY_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.resolve(__dirname, "../../../../evals/chat/fixtures/search-replays");
}

function bundlePath(replayId: string): string {
  const safe = replayId.replace(/[^a-zA-Z0-9._-]/g, "");
  if (!safe) throw new Error("Invalid search replay id");
  return path.join(fixturesRoot(), `${safe}.json`);
}

export function loadWebSearchReplayBundle(replayId: string): WebSearchReplayBundle {
  const cached = bundleCache.get(replayId);
  if (cached) return cached;
  const filePath = bundlePath(replayId);
  if (!existsSync(filePath)) {
    throw new Error(`Search replay fixture not found: ${replayId}`);
  }
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as WebSearchReplayBundle;
  if (parsed.schemaVersion !== SEARCH_REPLAY_SCHEMA_VERSION || typeof parsed.queries !== "object") {
    throw new Error(`Search replay fixture ${replayId} has an invalid schema`);
  }
  bundleCache.set(replayId, parsed);
  return parsed;
}

function cloneOutcome(outcome: WebSearchOutcome): WebSearchOutcome {
  return {
    ...outcome,
    results: outcome.results.map((row) => ({ ...row })),
    attempts: [...(outcome.attempts ?? [])],
  };
}

export function lookupWebSearchReplay(query: string, replayId: string): WebSearchOutcome | null {
  const bundle = loadWebSearchReplayBundle(replayId);
  const key = normalizeSearchReplayQuery(query);
  const hit = bundle.queries[key];
  return hit ? cloneOutcome(hit) : null;
}

function persistRecordedQuery(recordPath: string, query: string, outcome: WebSearchOutcome): void {
  const key = normalizeSearchReplayQuery(query);
  let bundle: WebSearchReplayBundle;
  if (existsSync(recordPath)) {
    bundle = JSON.parse(readFileSync(recordPath, "utf8")) as WebSearchReplayBundle;
  } else {
    mkdirSync(path.dirname(recordPath), { recursive: true });
    bundle = {
      schemaVersion: SEARCH_REPLAY_SCHEMA_VERSION,
      replayId: path.basename(recordPath, ".json"),
      recordedAt: new Date().toISOString(),
      queries: {},
    };
  }
  bundle.queries[key] = cloneOutcome(outcome);
  bundle.recordedAt = new Date().toISOString();
  writeFileSync(recordPath, `${JSON.stringify(bundle, null, 2)}\n`);
  bundleCache.set(bundle.replayId, bundle);
}

export function recordWebSearchReplayIfEnabled(query: string, outcome: WebSearchOutcome): void {
  const scope = replayScope.getStore();
  if (!scope?.recordPath) return;
  persistRecordedQuery(scope.recordPath, query, outcome);
}

export async function withWebSearchReplayScope<T>(
  scope: WebSearchReplayScope | null,
  fn: () => Promise<T>
): Promise<T> {
  if (!scope) return fn();
  return replayScope.run(scope, fn);
}

export function activeWebSearchReplayId(): string | null {
  return replayScope.getStore()?.replayId ?? null;
}

export function parseChatEvalSearchReplayHeader(
  raw: string | string[] | undefined
): WebSearchReplayScope | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const replayId = typeof value === "string" ? value.trim() : "";
  if (!replayId) return null;
  if (!/^[a-zA-Z0-9._-]+$/.test(replayId)) return null;
  const recordFlag = process.env.WEB_SEARCH_REPLAY_RECORD?.trim() === replayId;
  const recordPath = recordFlag ? bundlePath(replayId) : null;
  return { replayId, recordPath };
}

export function resetWebSearchReplayCacheForTests(): void {
  bundleCache.clear();
}
