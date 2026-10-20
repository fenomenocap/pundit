import { isTakeV2DossierEvidence, type DossierEvidenceItem } from "../match-dossier/types";

/**
 * Take v2 may only weave dossier claims that passed page verification and explicit
 * fixture/freshness gates. Missing optional gates fail closed (no prose use).
 */
export function takeEligibleDossierEvidence(item: DossierEvidenceItem): boolean {
  return isTakeV2DossierEvidence(item);
}

export function takeEligibleDossierEvidenceItems(
  items: DossierEvidenceItem[] | undefined | null,
): DossierEvidenceItem[] {
  return (items ?? []).filter(takeEligibleDossierEvidence);
}
