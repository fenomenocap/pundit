import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export const SEARCH_REPLAY_SCHEMA_VERSION = 1;

export function normalizeSearchReplayQuery(query) {
  return String(query ?? "").trim().toLocaleLowerCase().slice(0, 256);
}

export async function loadSearchReplayBundle(filePath) {
  const parsed = JSON.parse(await readFile(filePath, "utf8"));
  if (parsed.schemaVersion !== SEARCH_REPLAY_SCHEMA_VERSION || typeof parsed.queries !== "object") {
    throw new Error(`Invalid search replay bundle: ${filePath}`);
  }
  return parsed;
}

export async function saveSearchReplayBundle(filePath, bundle) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(bundle, null, 2)}\n`);
}

export function searchReplayHeader(replayId) {
  return { "x-pundit-chat-eval-search-replay": replayId };
}
