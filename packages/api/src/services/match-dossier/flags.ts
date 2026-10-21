export function matchDossierEnabled(): boolean {
  return process.env.MATCH_DOSSIER_ENABLED === "true";
}

/** When true, scheduled/on-demand dossier builds fan out federated search into evidence items. */
export function matchDossierEvidenceEnabled(): boolean {
  return process.env.MATCH_DOSSIER_EVIDENCE_ENABLED === "true";
}

/** When true, evidence requires page fetch + on-page claim verification (capture pipeline). */
export function matchDossierEvidenceVerifyEnabled(): boolean {
  return process.env.MATCH_DOSSIER_EVIDENCE_VERIFY === "true";
}

/** Interim FPL bootstrap-static injury rows (internalOnly; default off). */
export function matchDossierFplEnabled(): boolean {
  return process.env.MATCH_DOSSIER_FPL_ENABLED === "true";
}

/** Fixture-first source groups (PL identity + FPL team news); default off — no prod behaviour change. */
export function matchDossierFixtureFirstEnabled(): boolean {
  return process.env.MATCH_DOSSIER_FIXTURE_FIRST_ENABLED === "true";
}

/** FPL bootstrap fetch for dossier builds (legacy FPL flag or fixture-first pipeline). */
export function matchDossierFplPrefetchEnabled(): boolean {
  return matchDossierFplEnabled() || matchDossierFixtureFirstEnabled();
}

export const MATCH_DOSSIER_BUILDER_VERSION = "phase2-2026-10-19";

export const DOSSIER_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const DOSSIER_PRE_KICKOFF_MS = 90 * 60 * 1000;
export const DOSSIER_PRE_KICKOFF_POLL_MS = 15 * 60 * 1000;

/** Default CI replay — synthetic teams + example.test URLs only (`synthetic: true`). */
export { DOSSIER_SYNTHETIC_EVIDENCE_REPLAY_ID as DOSSIER_EVIDENCE_REPLAY_ID } from "./dossier-synthetic-fixture";
