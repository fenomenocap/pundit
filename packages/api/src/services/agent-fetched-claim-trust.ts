import type { EvidenceBundle } from "./ask";
import type { RetrievedEvidencePage } from "./evidence-page-retrieval";
import type { ClaimDecision, VerifiableClaim } from "./response-correctness";

export type ManagerIdentityExtractor = (
  scope: { club: string },
  bundle: EvidenceBundle,
  pages: readonly RetrievedEvidencePage[],
) => { facts: { name: string; sourceId: string }[] };

function citationIds(text: string): string[] {
  return [...text.matchAll(/\[\[\s*(S\d{1,3})\s*\]\]/g)].map((match) => match[1]);
}

function managerNameFromClaim(claimText: string, club: string): string | null {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const clubRe = escape(club);
  const role = "(?:current\\s+)?(?:manager|head coach|coach|boss)";
  const name = "([\\p{Lu}][\\p{L}\\p{M}'’.-]+(?:\\s+[\\p{Lu}][\\p{L}\\p{M}'’.-]+){1,3})";
  const prose = claimText.replace(/\[\[S\d+\]\]/g, "").replace(/\*\*/g, "").trim();
  const patterns = [
    new RegExp(`^${clubRe}(?:['’]s|['’])?\\s+${role}\\s+is\\s+${name}\\b`, "iu"),
    new RegExp(`^${name}\\s+(?:is|remains)\\s+(?:the\\s+)?${clubRe}(?:['’]s|['’])?\\s+${role}\\b`, "iu"),
    new RegExp(`^${name}\\s+(?:is|remains)\\s+(?:the\\s+)?${role}\\s+(?:of|for)\\s+${clubRe}\\b`, "iu"),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(prose);
    const candidate = match?.[1]?.replace(/\s+(?:today|currently)$/i, "").trim();
    if (candidate) return candidate;
  }
  return null;
}

function managerClaimSupportedByPage(
  claim: VerifiableClaim,
  page: RetrievedEvidencePage,
  bundle: EvidenceBundle,
  club: string,
  extractManager: ManagerIdentityExtractor,
): boolean {
  const claimedName = managerNameFromClaim(claim.text, club);
  if (!claimedName) return false;
  const { facts } = extractManager({ club }, bundle, [page]);
  const key = (name: string) => name.normalize("NFC").toLocaleLowerCase("en").replace(/\s+/g, " ");
  const target = key(claimedName);
  return facts.some((fact) => fact.sourceId === page.id && key(fact.name) === target);
}

function newsClaimSupportedByPage(claim: VerifiableClaim, page: RetrievedEvidencePage): boolean {
  const body = page.text.replace(/\s+/g, " ").toLowerCase();
  if (!body.trim()) return false;
  const prose = claim.text
    .replace(/\[\[S\d+\]\]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*/g, "")
    .trim();
  const dated = /\(\d{1,2} [A-Za-z]+ \d{4}\)/.test(prose) || /\b\d{4}-\d{2}-\d{2}\b/.test(prose);
  if (!dated) return false;
  const words = prose.split(/\s+/).filter((word) => word.length > 3).slice(0, 8);
  if (words.length < 2) return false;
  return words.filter((word) => body.includes(word.toLowerCase())).length >= Math.min(3, words.length);
}

/**
 * When a claim cites a publisher body that was actually fetched this turn, and
 * that body supports the claim, return a supported decision without LLM re-verification.
 * Returns null when the claim should follow the normal verifier path.
 */
export function trustedDecisionForBodyFetchedClaim(
  claim: VerifiableClaim,
  bodyFetchedSourceIds: ReadonlySet<string>,
  pages: readonly RetrievedEvidencePage[],
  bundle: EvidenceBundle,
  scope?: { managerClub?: string; extractManager?: ManagerIdentityExtractor },
): ClaimDecision | null {
  const cited = citationIds(claim.text);
  if (!cited.length) return null;
  const fetchedCited = cited.filter((id) => bodyFetchedSourceIds.has(id));
  if (!fetchedCited.length) return null;

  const page = pages.find((row) => row.id === fetchedCited[0]);
  if (!page?.text?.trim()) return null;

  const supported = scope?.managerClub && scope.extractManager
    ? managerClaimSupportedByPage(claim, page, bundle, scope.managerClub, scope.extractManager)
    : newsClaimSupportedByPage(claim, page);
  if (!supported) return null;

  return {
    claimId: claim.id,
    outcome: "supported",
    evidenceIds: [page.id],
    explanation: "publisher body",
  };
}

export function partitionClaimsForAgentTrust(
  claims: readonly VerifiableClaim[],
  bodyFetchedSourceIds: ReadonlySet<string>,
  pages: readonly RetrievedEvidencePage[],
  bundle: EvidenceBundle,
  scope?: { managerClub?: string; extractManager?: ManagerIdentityExtractor },
): { trusted: ClaimDecision[]; verify: VerifiableClaim[] } {
  const trusted: ClaimDecision[] = [];
  const verify: VerifiableClaim[] = [];
  for (const claim of claims) {
    const decision = trustedDecisionForBodyFetchedClaim(
      claim,
      bodyFetchedSourceIds,
      pages,
      bundle,
      scope,
    );
    if (decision) trusted.push(decision);
    else verify.push(claim);
  }
  return { trusted, verify };
}
