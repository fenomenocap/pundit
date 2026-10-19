import { createHash } from "node:crypto";
import { evidenceTier, type EvidenceTier } from "../evidence-authority";
import { searchWebBatch, type WebSearchOutcome } from "../web-search";
import {
  isSyntheticWebSearchReplay,
  lookupWebSearchReplay,
  normalizeSearchReplayQuery,
  withWebSearchReplayScope,
  type WebSearchReplayScope,
} from "../web-search-replay";
import {
  isDossierSyntheticTestFixture,
  isSyntheticDossierEvidenceHost,
} from "./dossier-synthetic-fixture";
import type { ModelFixture } from "../model-data";
import type {
  DossierEvidenceCategory,
  DossierEvidenceItem,
  DossierEvidenceVerification,
  EvidenceDirection,
  ModelFactorId,
} from "./types";

export interface DossierEvidenceCollectOptions {
  now?: Date;
  replayScope?: WebSearchReplayScope | null;
  origin?: DossierEvidenceItem["origin"];
}

export interface DossierEvidenceCollectResult {
  items: DossierEvidenceItem[];
  dropped: import("./types").DossierEvidenceDroppedItem[];
  droppedCount: number;
  queryCount: number;
  replayId: string | null;
  captureId?: string | null;
  /** Synthetic replay refused for a real fixture — dossier must stay evidence-empty. */
  syntheticReplayBlocked?: boolean;
}

function currentSeasonLabel(now: Date): string {
  const year = now.getUTCFullYear();
  const startYear = now.getUTCMonth() >= 7 ? year : year - 1;
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** Federated fan-out for fixture dossier evidence (#188 patterns; no new domain allowlists). */
export function planDossierEvidenceQueries(fixture: ModelFixture, now = new Date()): string[] {
  const home = fixture.home;
  const away = fixture.away;
  const fixtureLabel = `${home} vs ${away}`;
  const season = currentSeasonLabel(now);
  const day = now.toISOString().slice(0, 10);
  const analyticsHints = "fbref whoscored fotmob transfermarkt";
  const planned = [
    `${fixtureLabel} team news injuries suspensions availability ${season}`,
    `${home} injury suspension update ${day}`,
    `${away} injury suspension update ${day}`,
    `${fixtureLabel} predicted lineup rotation starting xi ${day}`,
    `${home} manager head coach appointment ${season}`,
    `${away} manager head coach appointment ${season}`,
    `${fixtureLabel} tactical preview matchup style pressing ${season}`,
    `${home} motivation title race relegation form ${season}`,
    `${away} motivation title race relegation form ${season}`,
    `${fixtureLabel} travel fatigue fixture congestion schedule ${season}`,
    `${fixtureLabel} advanced stats xG ${analyticsHints} ${season}`,
  ];
  const unique = new Map<string, string>();
  for (const query of planned) {
    const normalized = query.replace(/\s+/g, " ").trim();
    if (normalized.length >= 3) unique.set(normalized.toLocaleLowerCase(), normalized);
  }
  return [...unique.values()];
}

function publisherFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

function evidenceId(url: string, claim: string): string {
  return createHash("sha256").update(`${url}\n${claim}`).digest("hex").slice(0, 16);
}

export function categoryForQuery(query: string): DossierEvidenceCategory {
  const q = query.toLocaleLowerCase();
  if (/injur|suspension|availability/.test(q)) return "injuries";
  if (/lineup|rotation|starting xi/.test(q)) return "rotation";
  if (/manager|head coach|appointment/.test(q)) return "manager";
  if (/motivation|relegation|title race/.test(q)) return "motivation";
  if (/tactical|matchup|pressing|style/.test(q)) return "tactics";
  if (/travel|congestion|fatigue|schedule/.test(q)) return "travel-congestion";
  return "tactics";
}

function factorForCategory(category: DossierEvidenceCategory): ModelFactorId {
  switch (category) {
    case "injuries": return "injuries";
    case "rotation": return "lineups";
    case "manager": return "other";
    case "motivation": return "motivation";
    case "tactics": return "tactics";
    case "travel-congestion": return "rest-congestion";
    default: return "other";
  }
}

function inferDirection(
  claim: string,
  fixture: ModelFixture,
  category: DossierEvidenceCategory,
): EvidenceDirection {
  const text = claim.toLocaleLowerCase();
  const home = fixture.home.toLocaleLowerCase();
  const away = fixture.away.toLocaleLowerCase();
  const mentionsHome = text.includes(home);
  const mentionsAway = text.includes(away);
  if (category === "injuries" || category === "rotation") {
    if (mentionsHome && !mentionsAway) return "supports-away";
    if (mentionsAway && !mentionsHome) return "supports-home";
  }
  if (/favour|favor|strong|likely to win|dominat/.test(text)) {
    if (mentionsHome) return "supports-home";
    if (mentionsAway) return "supports-away";
  }
  if (mentionsHome && mentionsAway) return "neutral";
  return "neutral";
}

function claimFromResult(title: string, snippet: string): string {
  const titleClean = title.trim();
  const snippetClean = snippet.trim();
  if (titleClean && snippetClean) return `${titleClean} — ${snippetClean}`.slice(0, 480);
  return (titleClean || snippetClean).slice(0, 480);
}

function normalizePublishedAt(raw: string): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed}T12:00:00.000Z`;
  return null;
}

function tierAcceptable(tier: EvidenceTier): boolean {
  return tier !== "other";
}

function tierForSearchResult(
  url: string,
  syntheticEvidenceContext: boolean,
): EvidenceTier {
  if (syntheticEvidenceContext && isSyntheticDossierEvidenceHost(url)) return "news";
  return evidenceTier(url);
}

export function rejectSyntheticEvidenceForRealFixture(
  fixture: ModelFixture,
  items: DossierEvidenceItem[],
): DossierEvidenceItem[] {
  if (isDossierSyntheticTestFixture(fixture)) return items;
  return items.filter((item) => !isSyntheticDossierEvidenceHost(item.sourceUrl));
}

export function federatedResultsToEvidenceItems(
  fixture: ModelFixture,
  merged: Array<{ title: string; link: string; snippet: string; date: string; tier: EvidenceTier }>,
  queryByUrl: Map<string, string>,
  retrievedAt: string,
  origin: DossierEvidenceItem["origin"],
): { items: DossierEvidenceItem[]; dropped: number } {
  const items: DossierEvidenceItem[] = [];
  let dropped = 0;
  for (const row of merged) {
    const claim = claimFromResult(row.title, row.snippet);
    if (!claim || claim.length < 12) {
      dropped += 1;
      continue;
    }
    const tier = row.tier;
    let verification: DossierEvidenceVerification = "cited";
    if (!tierAcceptable(tier)) {
      dropped += 1;
      continue;
    }
    const publishedAt = normalizePublishedAt(row.date);
    if (!publishedAt && tier === "news") {
      verification = "unverified";
    }
    const query = queryByUrl.get(row.link.toLocaleLowerCase()) ?? "";
    const category = query ? categoryForQuery(query) : "tactics";
    items.push({
      id: evidenceId(row.link, claim),
      claim,
      sourceUrl: row.link,
      publisher: publisherFromUrl(row.link),
      publishedAt,
      retrievedAt,
      trustTier: tier,
      verification,
      direction: inferDirection(claim, fixture, category),
      relatedFactor: factorForCategory(category),
      category,
      origin,
      snippet: row.snippet.slice(0, 280),
    });
  }
  return { items, dropped };
}

async function searchQueries(
  queries: string[],
  replayScope: WebSearchReplayScope | null,
): Promise<WebSearchOutcome[]> {
  if (replayScope?.replayId) {
    return queries.map((query) => {
      const replayed = lookupWebSearchReplay(query, replayScope.replayId);
      if (replayed) return replayed;
      return {
        status: "empty" as const,
        results: [],
        provider: "replay",
        reason: "provider_unavailable" as const,
        usedFallback: false,
        attempts: [],
      };
    });
  }
  return searchWebBatch(queries);
}

export async function collectDossierEvidence(
  fixture: ModelFixture,
  options: DossierEvidenceCollectOptions = {},
): Promise<DossierEvidenceCollectResult> {
  const now = options.now ?? new Date();
  const retrievedAt = now.toISOString();
  const queries = planDossierEvidenceQueries(fixture, now);
  const origin = options.origin ?? "scheduled";
  const replayScope = options.replayScope ?? null;

  if (replayScope?.replayId && isSyntheticWebSearchReplay(replayScope.replayId)) {
    if (!isDossierSyntheticTestFixture(fixture)) {
      return {
        items: [],
        dropped: [],
        droppedCount: 0,
        queryCount: queries.length,
        replayId: null,
        syntheticReplayBlocked: true,
      };
    }
  }

  const run = async (): Promise<DossierEvidenceCollectResult> => {
    const syntheticEvidenceContext = Boolean(
      replayScope?.replayId && isSyntheticWebSearchReplay(replayScope.replayId),
    );
    const outcomes = await searchQueries(queries, replayScope);
    const seen = new Set<string>();
    const merged: Array<{ title: string; link: string; snippet: string; date: string; tier: EvidenceTier }> = [];
    const queryByUrl = new Map<string, string>();
    for (let index = 0; index < outcomes.length; index += 1) {
      const outcome = outcomes[index]!;
      const query = queries[index] ?? "";
      if (outcome.status !== "ok") continue;
      for (const result of outcome.results) {
        const url = result.link?.trim();
        if (!url) continue;
        const key = url.toLocaleLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        queryByUrl.set(key, query);
        merged.push({
          title: result.title,
          link: url,
          snippet: result.snippet,
          date: result.date,
          tier: tierForSearchResult(url, syntheticEvidenceContext),
        });
      }
    }
    const capped = merged.slice(0, 24);
    const { items, dropped } = federatedResultsToEvidenceItems(
      fixture,
      capped,
      queryByUrl,
      retrievedAt,
      origin,
    );
    const citedOnly = items.filter((item) => item.verification === "cited");
    const unverifiedDropped = items.length - citedOnly.length;
    const allowed = rejectSyntheticEvidenceForRealFixture(fixture, citedOnly);
    return {
      items: allowed,
      dropped: [],
      droppedCount: dropped + unverifiedDropped + (citedOnly.length - allowed.length),
      queryCount: queries.length,
      replayId: replayScope?.replayId ?? null,
    };
  };

  return withWebSearchReplayScope(replayScope, run);
}

/** Resolve replay queries for fixture recording (deterministic keys). */
export function dossierReplayQueryKeys(fixture: ModelFixture, now = new Date()): string[] {
  return planDossierEvidenceQueries(fixture, now).map(normalizeSearchReplayQuery);
}
