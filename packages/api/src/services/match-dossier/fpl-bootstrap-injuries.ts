import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ModelFixture } from "../model-data";
import type { DossierEvidenceItem, FplPlayerAvailabilityStatus } from "./types";
import { matchDossierFplEnabled, matchDossierFplPrefetchEnabled } from "./flags";
import {
  findFplTeamByFixtureSide,
  fixtureFplTeamIdsFromMap,
  fixtureSideLabelForFplTeam,
} from "./fpl-team-map";

const FPL_BOOTSTRAP_URL = "https://fantasy.premierleague.com/api/bootstrap-static/";
const FPL_BOOTSTRAP_TIMEOUT_MS = 10_000;
const FPL_BOOTSTRAP_MAX_ATTEMPTS = 2;
const FPL_BOOTSTRAP_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface FplBootstrapTeam {
  id: number;
  name: string;
  short_name: string;
  code?: number;
  /** Pulselive team id (matches footballapi fixture team.id). */
  pulse_id?: number;
}

export interface FplBootstrapElement {
  id: number;
  web_name: string;
  team: number;
  /** FPL element code (matches Pulselive staff altIds.opta numeric suffix). */
  code?: number;
  status: string;
  news: string;
  news_added: string | null;
  chance_of_playing_next_round: number | null;
}

export interface FplBootstrapSnapshot {
  teams: FplBootstrapTeam[];
  elements: FplBootstrapElement[];
}

export interface DossierFplFetchStatus {
  ok: boolean;
  status: number | null;
  error: string | null;
  fetchedAt: string | null;
}

let buildPassCache: { snapshot: FplBootstrapSnapshot; fetchedAt: string } | null = null;
let lastFplFetchStatus: DossierFplFetchStatus = {
  ok: false,
  status: null,
  error: null,
  fetchedAt: null,
};

export function logDossierFplFetch(payload: {
  status: number | null;
  error: string | null;
  ms: number;
  players: number | null;
}): void {
  console.log(JSON.stringify({
    event: "dossier_fpl_fetch",
    status: payload.status,
    error: payload.error,
    ms: payload.ms,
    players: payload.players,
  }));
}

function setLastFplFetchStatus(status: number | null, error: string | null, fetchedAt: string | null): void {
  lastFplFetchStatus = {
    ok: false,
    status,
    error,
    fetchedAt,
  };
}

export function getDossierFplStatus(): DossierFplFetchStatus {
  if (!matchDossierFplEnabled()) {
    return { ok: false, status: null, error: "fpl_disabled", fetchedAt: null };
  }
  if (buildPassCache) {
    return {
      ok: true,
      status: 200,
      error: null,
      fetchedAt: buildPassCache.fetchedAt,
    };
  }
  return { ...lastFplFetchStatus };
}

function normalizeFplStatus(raw: string, hasNews: boolean): FplPlayerAvailabilityStatus {
  const code = raw.trim().toLocaleLowerCase();
  if (code === "d" || code === "i" || code === "s" || code === "u" || code === "n") return code;
  if (hasNews) return "n";
  return "n";
}

function evidenceIdForFpl(playerId: number, fixture: ModelFixture): string {
  return createHash("sha256").update(`fpl:${playerId}:${fixture.fixtureId}`).digest("hex").slice(0, 16);
}

export function resetFplBootstrapCacheForTests(): void {
  buildPassCache = null;
  lastFplFetchStatus = { ok: false, status: null, error: null, fetchedAt: null };
}

export function loadFplBootstrapFromRecordedFixture(): FplBootstrapSnapshot {
  const file = path.join(__dirname, "__fixtures__", "fpl-bootstrap-static-sample.json");
  return JSON.parse(fs.readFileSync(file, "utf8")) as FplBootstrapSnapshot;
}

export function loadFplBootstrap841Slice(): FplBootstrapSnapshot {
  const file = path.join(__dirname, "__fixtures__", "fpl-bootstrap-static-841-slice.json");
  return JSON.parse(fs.readFileSync(file, "utf8")) as FplBootstrapSnapshot;
}

/** Real FPL bootstrap-static snapshot (full teams, flagged elements). */
export function loadFplBootstrap841Recorded(): FplBootstrapSnapshot {
  const file = path.join(__dirname, "__fixtures__", "fpl-bootstrap-static-841-recorded.json");
  return JSON.parse(fs.readFileSync(file, "utf8")) as FplBootstrapSnapshot;
}

async function fetchFplBootstrapSnapshot(
  fetchFn: typeof fetch,
): Promise<FplBootstrapSnapshot | null> {
  let lastStatus: number | null = null;
  let lastError: string | null = null;
  for (let attempt = 0; attempt < FPL_BOOTSTRAP_MAX_ATTEMPTS; attempt += 1) {
    const started = Date.now();
    try {
      const response = await fetchFn(FPL_BOOTSTRAP_URL, {
        headers: {
          Accept: "application/json",
          "User-Agent": FPL_BOOTSTRAP_USER_AGENT,
        },
        signal: AbortSignal.timeout(FPL_BOOTSTRAP_TIMEOUT_MS),
      });
      lastStatus = response.status;
      if (!response.ok) {
        lastError = `http_${lastStatus}`;
        logDossierFplFetch({
          status: lastStatus,
          error: lastError,
          ms: Date.now() - started,
          players: null,
        });
        setLastFplFetchStatus(lastStatus, lastError, null);
        continue;
      }
      const snapshot = await response.json() as FplBootstrapSnapshot;
      const players = Array.isArray(snapshot.elements) ? snapshot.elements.length : null;
      logDossierFplFetch({
        status: lastStatus,
        error: null,
        ms: Date.now() - started,
        players,
      });
      return snapshot;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      logDossierFplFetch({
        status: lastStatus,
        error: lastError,
        ms: Date.now() - started,
        players: null,
      });
      setLastFplFetchStatus(lastStatus, lastError, null);
    }
  }
  return null;
}

/** At most one successful fetch per process build pass (shared cache). */
export async function prefetchFplBootstrapForBuildPass(
  fetchFn: typeof fetch = fetch,
): Promise<FplBootstrapSnapshot | null> {
  if (!matchDossierFplPrefetchEnabled()) return null;
  if (buildPassCache) return buildPassCache.snapshot;
  const snapshot = await fetchFplBootstrapSnapshot(fetchFn);
  if (!snapshot) return null;
  const fetchedAt = new Date().toISOString();
  buildPassCache = { snapshot, fetchedAt };
  lastFplFetchStatus = { ok: true, status: 200, error: null, fetchedAt };
  return snapshot;
}

export function setFplBootstrapCacheForTests(snapshot: FplBootstrapSnapshot, fetchedAt = new Date().toISOString()): void {
  buildPassCache = { snapshot, fetchedAt };
  lastFplFetchStatus = { ok: true, status: 200, error: null, fetchedAt };
}

export function getCachedFplBootstrapSnapshot(): FplBootstrapSnapshot | null {
  return buildPassCache?.snapshot ?? null;
}

/** Resolve bootstrap team id → fixture home/away label when matched. */
export function clubLabelForFplTeam(
  fixture: ModelFixture,
  team: FplBootstrapTeam,
): string {
  return fixtureSideLabelForFplTeam(fixture.home, fixture.away, team);
}

export function fixtureFplTeamIds(snapshot: FplBootstrapSnapshot, fixture: ModelFixture): Set<number> {
  return fixtureFplTeamIdsFromMap(snapshot, fixture.home, fixture.away);
}

export { findFplTeamByFixtureSide, resolveFplTeamIdForFixtureSide } from "./fpl-team-map";

export function buildFplInjuryEvidenceForFixture(
  fixture: ModelFixture,
  retrievedAt: string,
  snapshot: FplBootstrapSnapshot,
  options?: { requireNewsAdded?: boolean; dropUnavailable?: boolean },
): DossierEvidenceItem[] {
  if (fixture.competitionId !== "eng.1") return [];
  const teamIds = fixtureFplTeamIds(snapshot, fixture);
  if (!teamIds.size) return [];
  const items: DossierEvidenceItem[] = [];
  for (const player of snapshot.elements) {
    if (!teamIds.has(player.team)) continue;
    const newsText = player.news?.trim() ?? "";
    const hasNews = newsText.length > 0;
    if (player.status === "a" && !hasNews) continue;
    const team = snapshot.teams.find((t) => t.id === player.team);
    if (!team) continue;
    const club = clubLabelForFplTeam(fixture, team);
    const status = normalizeFplStatus(player.status, hasNews);
    if (options?.dropUnavailable && status === "u") continue;
    const newsAddedAt = player.news_added ?? null;
    if (options?.requireNewsAdded && !newsAddedAt && status !== "i" && status !== "s") {
      continue;
    }
    const chanceOfPlaying = player.chance_of_playing_next_round ?? null;
    items.push({
      id: evidenceIdForFpl(player.id, fixture),
      claim: `${player.web_name} (${club})`,
      sourceUrl: FPL_BOOTSTRAP_URL,
      publisher: "fantasy.premierleague.com",
      publishedAt: newsAddedAt ?? retrievedAt,
      retrievedAt,
      trustTier: "interim",
      verification: "cited",
      direction: "neutral",
      relatedFactor: "injuries",
      category: "injuries",
      origin: "scheduled",
      source: "fpl-bootstrap-static",
      tier: "interim",
      internalOnly: true,
      player: player.web_name,
      club,
      status,
      chanceOfPlaying,
      newsAddedAt,
      fplElementId: player.id,
      fplElementCode: player.code ?? null,
      fplTeamId: player.team,
      newsText: hasNews ? newsText : undefined,
    });
  }
  return items;
}

export function fplInjuryEvidenceForFixtureIfCached(
  fixture: ModelFixture,
  retrievedAt: string,
): DossierEvidenceItem[] {
  if (!matchDossierFplEnabled() || !buildPassCache) return [];
  return buildFplInjuryEvidenceForFixture(fixture, retrievedAt, buildPassCache.snapshot);
}
