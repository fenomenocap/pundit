import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { evidenceTier, type EvidenceTier } from "../evidence-authority";
import {
  retrieveEvidencePages,
  type EvidencePageCandidate,
  type RetrievedEvidencePage,
  type RetrievalOptions,
} from "../evidence-page-retrieval";
import type { WebSearchOutcome } from "../web-search";
import type { ModelFixture } from "../model-data";
import {
  federatedResultsToEvidenceItems,
  planDossierEvidenceQueries,
  rejectSyntheticEvidenceForRealFixture,
} from "./dossier-evidence";
import { verifyClaimAgainstPageText } from "./dossier-claim-page-verify";
import {
  decodeEvidenceClaimText,
  gateFixtureMatchEvidence,
  gateFreshnessEvidence,
  gateHeadlineMismatch,
  gatePageBodyMatch,
  gatePreFetch,
  gateTeamScope,
  gateUpcomingMatchContext,
  resolveEvidencePublishedAt,
  selectVerifiedBodyClaim,
  type EvidenceGateContext,
} from "./dossier-evidence-gate";
import { logDossierFederatedSearchStack } from "./dossier-federated-search-meta";
import { categoryForQuery } from "./dossier-evidence";
import { isDossierSyntheticTestFixture, isSyntheticDossierEvidenceHost } from "./dossier-synthetic-fixture";
import type { DossierEvidenceDroppedItem, DossierEvidenceItem } from "./types";
import { searchWebBatch } from "../web-search";
import { dossierCapturePath, writeDossierCapture } from "./storage";
import type { DossierEvidenceCollectResult } from "./dossier-evidence";

function dossierFixtureId(fixture: ModelFixture): string {
  return `espn:${fixture.competitionId}:${fixture.fixtureId}`;
}

export const DOSSIER_EVIDENCE_CAPTURE_SCHEMA_VERSION = 1 as const;

export interface DossierEvidenceCaptureSearchRow {
  query: string;
  provider: string;
  status: WebSearchOutcome["status"];
  reason: string | null;
  retrievedAt: string;
  urls: string[];
}

export interface DossierEvidenceCaptureVerificationRow {
  url: string;
  claim: string;
  query: string;
  tier: EvidenceTier;
  outcome: "verified" | "dropped";
  reason?: string;
  httpStatus?: number;
  contentSha256?: string;
  matchedSnippet?: string;
}

export interface DossierEvidenceCaptureFile {
  schemaVersion: typeof DOSSIER_EVIDENCE_CAPTURE_SCHEMA_VERSION;
  fixtureId: string;
  home: string;
  away: string;
  capturedAt: string;
  search: DossierEvidenceCaptureSearchRow[];
  verifications: DossierEvidenceCaptureVerificationRow[];
  summary: {
    candidates: number;
    verified: number;
    dropped: number;
  };
}

export interface RunDossierEvidenceCaptureOptions {
  now?: Date;
  fixtureId: string;
  searchOutcomes: WebSearchOutcome[];
  queries: string[];
  searchFn?: never;
  pageRetrieval?: RetrievalOptions;
  persistCapture?: boolean;
  extraCaptureDir?: string | null;
  origin?: DossierEvidenceItem["origin"];
}

function claimFromResult(title: string, snippet: string): string {
  const titleClean = title.trim();
  const snippetClean = snippet.trim();
  if (titleClean && snippetClean) return `${titleClean} — ${snippetClean}`.slice(0, 480);
  return (titleClean || snippetClean).slice(0, 480);
}

function tierForUrl(url: string, fixture: ModelFixture): EvidenceTier {
  if (isDossierSyntheticTestFixture(fixture) && isSyntheticDossierEvidenceHost(url)) return "news";
  return evidenceTier(url);
}

function buildSearchRows(
  queries: string[],
  outcomes: WebSearchOutcome[],
  retrievedAt: string,
): DossierEvidenceCaptureSearchRow[] {
  return queries.map((query, index) => {
    const outcome = outcomes[index] ?? {
      status: "degraded" as const,
      results: [],
      provider: "unknown",
      reason: "missing_outcome",
      usedFallback: false,
      attempts: [],
    };
    const urls = outcome.status === "ok"
      ? outcome.results.map((r) => r.link).filter(Boolean)
      : [];
    return {
      query,
      provider: outcome.provider ?? "unknown",
      status: outcome.status,
      reason: outcome.reason,
      retrievedAt,
      urls,
    };
  });
}

function pushDropped(
  list: DossierEvidenceDroppedItem[],
  row: Omit<DossierEvidenceDroppedItem, "category"> & { query: string },
): void {
  list.push({
    ...row,
    category: categoryForQuery(row.query),
  });
}

export async function verifySearchCandidatesForFixture(
  fixture: ModelFixture,
  queries: string[],
  outcomes: WebSearchOutcome[],
  retrievedAt: string,
  pageRetrieval: RetrievalOptions = {},
  gateCtx?: EvidenceGateContext,
): Promise<{
  verifications: DossierEvidenceCaptureVerificationRow[];
  verifiedItems: DossierEvidenceItem[];
  dropped: DossierEvidenceDroppedItem[];
}> {
  const ctx: EvidenceGateContext = gateCtx ?? {
    asOf: new Date(retrievedAt),
    kickoffUtc: fixture.utcDate,
  };
  const seen = new Set<string>();
  const candidates: Array<{
    url: string;
    title: string;
    snippet: string;
    date: string;
    query: string;
    tier: EvidenceTier;
  }> = [];

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
      const tier = tierForUrl(url, fixture);
      if (tier === "other") continue;
      candidates.push({
        url,
        title: result.title,
        snippet: result.snippet,
        date: result.date,
        query,
        tier,
      });
    }
  }

  const verifications: DossierEvidenceCaptureVerificationRow[] = [];
  const dropped: DossierEvidenceDroppedItem[] = [];
  const verifiedMerged: Array<{
    title: string;
    link: string;
    snippet: string;
    date: string;
    publishedAtSource: DossierEvidenceItem["publishedAtSource"];
    tier: EvidenceTier;
    pageSnippet: string;
    bodyClaim: string;
    contentSha256: string;
  }> = [];
  const queryByUrl = new Map<string, string>();

  for (const candidate of candidates.slice(0, 24)) {
    const claim = claimFromResult(candidate.title, candidate.snippet);
    if (claim.length < 12) {
      verifications.push({
        url: candidate.url,
        claim,
        query: candidate.query,
        tier: candidate.tier,
        outcome: "dropped",
        reason: "claim_too_short",
      });
      pushDropped(dropped, {
        sourceUrl: candidate.url,
        claim,
        reason: "claim_too_short",
        query: candidate.query,
      });
      continue;
    }

    const pre = gatePreFetch(fixture, {
      title: candidate.title,
      snippet: candidate.snippet,
      url: candidate.url,
      publishedAtRaw: candidate.date,
      query: candidate.query,
    }, ctx);
    if (pre) {
      verifications.push({
        url: candidate.url,
        claim,
        query: candidate.query,
        tier: candidate.tier,
        outcome: "dropped",
        reason: pre,
      });
      pushDropped(dropped, { sourceUrl: candidate.url, claim, reason: pre, query: candidate.query });
      continue;
    }

    const pageCandidate: EvidencePageCandidate = {
      id: createHash("sha256").update(candidate.url).digest("hex").slice(0, 12),
      url: candidate.url,
      title: candidate.title,
      date: candidate.date,
      authority: candidate.tier === "official" ? "official" : "reputable",
    };

    let pages: RetrievedEvidencePage[] = [];
    try {
      pages = await retrieveEvidencePages([pageCandidate], undefined, {
        articleBodyExtract: true,
        ...pageRetrieval,
      });
    } catch {
      pages = [];
    }

    if (!pages.length) {
      verifications.push({
        url: candidate.url,
        claim,
        query: candidate.query,
        tier: candidate.tier,
        outcome: "dropped",
        reason: "fetch_failed_or_non_200",
        httpStatus: undefined,
      });
      pushDropped(dropped, {
        sourceUrl: candidate.url,
        claim,
        reason: "fetch_failed_or_non_200",
        query: candidate.query,
      });
      continue;
    }

    const page = pages[0]!;
    const gateInput = {
      title: candidate.title,
      snippet: candidate.snippet,
      url: candidate.url,
      publishedAtRaw: candidate.date,
      query: candidate.query,
    };
    const resolvedDate = resolveEvidencePublishedAt(candidate.date, page.date, page.dateSource);
    const dateReason = gateFreshnessEvidence(fixture, gateInput, resolvedDate, ctx);
    if (dateReason) {
      verifications.push({
        url: candidate.url,
        claim,
        query: candidate.query,
        tier: candidate.tier,
        outcome: "dropped",
        reason: dateReason,
        httpStatus: 200,
      });
      pushDropped(dropped, { sourceUrl: candidate.url, claim, reason: dateReason, query: candidate.query });
      continue;
    }

    const category = categoryForQuery(candidate.query);
    const scopeReason = gateTeamScope(candidate.title, page.text);
    if (scopeReason) {
      verifications.push({
        url: candidate.url,
        claim,
        query: candidate.query,
        tier: candidate.tier,
        outcome: "dropped",
        reason: scopeReason,
        httpStatus: 200,
      });
      pushDropped(dropped, { sourceUrl: candidate.url, claim, reason: scopeReason, query: candidate.query });
      continue;
    }
    const headlineReason = gateHeadlineMismatch(candidate.title, page.articleHeadline ?? "");
    if (headlineReason) {
      verifications.push({
        url: candidate.url,
        claim,
        query: candidate.query,
        tier: candidate.tier,
        outcome: "dropped",
        reason: headlineReason,
        httpStatus: 200,
      });
      pushDropped(dropped, { sourceUrl: candidate.url, claim, reason: headlineReason, query: candidate.query });
      continue;
    }

    const bodyReason = gatePageBodyMatch(page.text, candidate.snippet, fixture, category);
    if (bodyReason) {
      verifications.push({
        url: candidate.url,
        claim,
        query: candidate.query,
        tier: candidate.tier,
        outcome: "dropped",
        reason: bodyReason,
        httpStatus: 200,
      });
      pushDropped(dropped, { sourceUrl: candidate.url, claim, reason: bodyReason, query: candidate.query });
      continue;
    }

    const bodyClaim = selectVerifiedBodyClaim(fixture, category, page.text, candidate.snippet)!;
    const verifyClaim = bodyClaim.slice(0, 480);
    const check = verifyClaimAgainstPageText(verifyClaim, page.text, fixture);
    if (!check.ok) {
      verifications.push({
        url: candidate.url,
        claim,
        query: candidate.query,
        tier: candidate.tier,
        outcome: "dropped",
        reason: check.reason,
        httpStatus: 200,
      });
      pushDropped(dropped, { sourceUrl: candidate.url, claim, reason: check.reason, query: candidate.query });
      continue;
    }

    const matchContextReason = gateUpcomingMatchContext(fixture, bodyClaim, category);
    if (matchContextReason) {
      verifications.push({
        url: candidate.url,
        claim: bodyClaim,
        query: candidate.query,
        tier: candidate.tier,
        outcome: "dropped",
        reason: matchContextReason,
        httpStatus: 200,
      });
      pushDropped(dropped, { sourceUrl: candidate.url, claim: bodyClaim, reason: matchContextReason, query: candidate.query });
      continue;
    }

    const fixtureMatchReason = gateFixtureMatchEvidence(fixture, gateInput);
    if (fixtureMatchReason) {
      verifications.push({
        url: candidate.url,
        claim,
        query: candidate.query,
        tier: candidate.tier,
        outcome: "dropped",
        reason: fixtureMatchReason,
        httpStatus: 200,
      });
      pushDropped(dropped, { sourceUrl: candidate.url, claim, reason: fixtureMatchReason, query: candidate.query });
      continue;
    }
    const freshnessReason = gateFreshnessEvidence(fixture, gateInput, resolvedDate, ctx);
    if (freshnessReason) {
      verifications.push({
        url: candidate.url,
        claim,
        query: candidate.query,
        tier: candidate.tier,
        outcome: "dropped",
        reason: freshnessReason,
        httpStatus: 200,
      });
      pushDropped(dropped, { sourceUrl: candidate.url, claim, reason: freshnessReason, query: candidate.query });
      continue;
    }

    const storedClaim = decodeEvidenceClaimText(bodyClaim);
    verifications.push({
      url: candidate.url,
      claim: storedClaim,
      query: candidate.query,
      tier: candidate.tier,
      outcome: "verified",
      httpStatus: 200,
      contentSha256: check.contentSha256,
      matchedSnippet: storedClaim,
    });

    queryByUrl.set(candidate.url.toLocaleLowerCase(), candidate.query);
    verifiedMerged.push({
      title: candidate.title,
      link: candidate.url,
      snippet: storedClaim,
      date: resolvedDate!.iso,
      publishedAtSource: resolvedDate!.source,
      tier: candidate.tier,
      pageSnippet: storedClaim,
      bodyClaim: storedClaim,
      contentSha256: check.contentSha256,
    });
  }

  const { items } = federatedResultsToEvidenceItems(
    fixture,
    verifiedMerged.map((row) => ({
      title: row.title,
      link: row.link,
      snippet: row.snippet,
      claim: row.bodyClaim,
      date: row.date,
      tier: row.tier,
    })),
    queryByUrl,
    retrievedAt,
    "scheduled",
  );

  const verifiedItems = rejectSyntheticEvidenceForRealFixture(
    fixture,
    items.map((item) => {
      const row = verifiedMerged.find((v) => v.link === item.sourceUrl);
      return {
        ...item,
        publishedAt: row?.date ?? item.publishedAt,
        publishedAtSource: row?.publishedAtSource,
        verification: "page-verified" as const,
        fixtureMatchVerified: true,
        freshnessVerified: true,
        claim: row?.bodyClaim ?? item.claim,
        snippet: row?.pageSnippet ?? item.snippet,
        contentSha256: row?.contentSha256,
      };
    }),
  );
  return { verifications, verifiedItems, dropped };
}

export async function runDossierEvidenceCapture(
  fixture: ModelFixture,
  options: RunDossierEvidenceCaptureOptions,
): Promise<{
  capture: DossierEvidenceCaptureFile;
  verifiedItems: DossierEvidenceItem[];
  dropped: DossierEvidenceDroppedItem[];
  capturePath: string | null;
}> {
  const now = options.now ?? new Date();
  const retrievedAt = now.toISOString();
  const queries = options.queries.length > 0
    ? options.queries
    : planDossierEvidenceQueries(fixture, now);
  const outcomes = options.searchOutcomes;

  const search = buildSearchRows(queries, outcomes, retrievedAt);
  const { verifications, verifiedItems, dropped } = await verifySearchCandidatesForFixture(
    fixture,
    queries,
    outcomes,
    retrievedAt,
    options.pageRetrieval ?? {},
    { asOf: now, kickoffUtc: fixture.utcDate },
  );

  const capture: DossierEvidenceCaptureFile = {
    schemaVersion: DOSSIER_EVIDENCE_CAPTURE_SCHEMA_VERSION,
    fixtureId: options.fixtureId,
    home: fixture.home,
    away: fixture.away,
    capturedAt: retrievedAt,
    search,
    verifications,
    summary: {
      candidates: verifications.length,
      verified: verifications.filter((v) => v.outcome === "verified").length,
      dropped: verifications.filter((v) => v.outcome === "dropped").length,
    },
  };

  let capturePath: string | null = null;
  if (options.persistCapture !== false) {
    capturePath = dossierCapturePath(options.fixtureId, retrievedAt);
    writeDossierCapture(capturePath, capture);
    if (options.extraCaptureDir) {
      const safeTs = retrievedAt.replace(/[:.]/g, "-");
      const extra = path.join(
        options.extraCaptureDir,
        options.fixtureId.replace(/:/g, "-"),
        `${safeTs}.json`,
      );
      fs.mkdirSync(path.dirname(extra), { recursive: true });
      fs.writeFileSync(extra, `${JSON.stringify(capture, null, 2)}\n`, "utf8");
      capturePath = extra;
    }
  }

  return { capture, verifiedItems, dropped, capturePath };
}

export async function collectVerifiedDossierEvidence(
  fixture: ModelFixture,
  options: {
    now?: Date;
    pageRetrieval?: RetrievalOptions;
    persistCapture?: boolean;
    extraCaptureDir?: string | null;
    origin?: DossierEvidenceItem["origin"];
  } = {},
): Promise<DossierEvidenceCollectResult & { capture: DossierEvidenceCaptureFile; capturePath: string | null }> {
  const now = options.now ?? new Date();
  logDossierFederatedSearchStack();
  const queries = planDossierEvidenceQueries(fixture, now);
  const outcomes = await searchWebBatch(queries);
  const fixtureId = dossierFixtureId(fixture);
  const { capture, verifiedItems, dropped, capturePath } = await runDossierEvidenceCapture(fixture, {
    fixtureId,
    queries,
    searchOutcomes: outcomes,
    now,
    pageRetrieval: options.pageRetrieval,
    persistCapture: options.persistCapture,
    extraCaptureDir: options.extraCaptureDir,
    origin: options.origin,
  });
  return {
    items: verifiedItems,
    dropped,
    droppedCount: dropped.length,
    queryCount: queries.length,
    replayId: null,
    captureId: capture.capturedAt,
    capture,
    capturePath,
  };
}
