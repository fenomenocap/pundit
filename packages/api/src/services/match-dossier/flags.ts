export function matchDossierEnabled(): boolean {
  return process.env.MATCH_DOSSIER_ENABLED === "true";
}

export const MATCH_DOSSIER_BUILDER_VERSION = "phase1-2026-10-19";

export const DOSSIER_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const DOSSIER_PRE_KICKOFF_MS = 90 * 60 * 1000;
export const DOSSIER_PRE_KICKOFF_POLL_MS = 15 * 60 * 1000;
