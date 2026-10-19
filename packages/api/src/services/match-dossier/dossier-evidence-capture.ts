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
import { isDossierSyntheticTestFixture, isSyntheticDossierEvidenceHost } from "./dossier-synthetic-fixture";
import type { DossierEvidenceItem } from "./types";
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

export async function verifySearchCandidatesForFixture(
  fixture: ModelFixture,
  queries: string[],
  outcomes: WebSearchOutcome[],
  retrievedAt: string,
  pageRetrieval: RetrievalOptions = {},
): Promise<{
  verifications: DossierEvidenceCaptureVerificationRow[];
  verifiedItems: DossierEvidenceItem[];
}> {
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
  const verifiedMerged: Array<{
    title: string;
    link: string;
    snippet: string;
    date: string;
    tier: EvidenceTier;
    pageSnippet: string;
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
      pages = await retrieveEvidencePages([pageCandidate], undefined, pageRetrieval);
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
      continue;
    }

    const page = pages[0]!;
    const check = verifyClaimAgainstPageText(claim, page.text, fixture);
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
      continue;
    }

    verifications.push({
      url: candidate.url,
      claim,
      query: candidate.query,
      tier: candidate.tier,
      outcome: "verified",
      httpStatus: 200,
      contentSha256: check.contentSha256,
      matchedSnippet: check.matchedSnippet,
    });

    queryByUrl.set(candidate.url.toLocaleLowerCase(), candidate.query);
    verifiedMerged.push({
      title: candidate.title,
      link: candidate.url,
      snippet: check.matchedSnippet,
      date: candidate.date || page.date,
      tier: candidate.tier,
      pageSnippet: check.matchedSnippet,
      contentSha256: check.contentSha256,
    });
  }

  const { items } = federatedResultsToEvidenceItems(
    fixture,
    verifiedMerged.map((row) => ({
      title: row.title,
      link: row.link,
      snippet: row.snippet,
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
        verification: "page-verified" as const,
        snippet: row?.pageSnippet ?? item.snippet,
        contentSha256: row?.contentSha256,
      };
    }),
  );

  return { verifications, verifiedItems };
}

export async function runDossierEvidenceCapture(
  fixture: ModelFixture,
  options: RunDossierEvidenceCaptureOptions,
): Promise<{
  capture: DossierEvidenceCaptureFile;
  verifiedItems: DossierEvidenceItem[];
  capturePath: string | null;
}> {
  const now = options.now ?? new Date();
  const retrievedAt = now.toISOString();
  const queries = options.queries.length > 0
    ? options.queries
    : planDossierEvidenceQueries(fixture, now);
  const outcomes = options.searchOutcomes;

  const search = buildSearchRows(queries, outcomes, retrievedAt);
  const { verifications, verifiedItems } = await verifySearchCandidatesForFixture(
    fixture,
    queries,
    outcomes,
    retrievedAt,
    options.pageRetrieval ?? {},
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

  return { capture, verifiedItems, capturePath };
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
  const queries = planDossierEvidenceQueries(fixture, now);
  const outcomes = await searchWebBatch(queries);
  const fixtureId = dossierFixtureId(fixture);
  const { capture, verifiedItems, capturePath } = await runDossierEvidenceCapture(fixture, {
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
    droppedCount: capture.summary.dropped,
    queryCount: queries.length,
    replayId: null,
    captureId: capture.capturedAt,
    capture,
    capturePath,
  };
}
