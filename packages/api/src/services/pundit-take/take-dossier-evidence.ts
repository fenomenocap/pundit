import type { DossierEvidenceItem } from "../match-dossier/types";

/**
 * Take v2 may only weave dossier claims that passed page verification and explicit
 * fixture/freshness gates. Missing optional gates fail closed (no prose use).
 */
export function takeEligibleDossierEvidence(item: DossierEvidenceItem): boolean {
  if (item.verification !== "page-verified") return false;
  if (item.fixtureMatchVerified !== true) return false;
  if (item.freshnessVerified !== true) return false;
  return true;
}

export function takeEligibleDossierEvidenceItems(
  items: DossierEvidenceItem[] | undefined | null,
): DossierEvidenceItem[] {
  return (items ?? []).filter(takeEligibleDossierEvidence);
}
