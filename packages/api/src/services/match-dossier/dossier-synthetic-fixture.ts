import type { ModelFixture } from "../model-data";

/** Reserved team names for CI-only dossier evidence replays (never real EPL clubs). */
export const DOSSIER_SYNTHETIC_HOME = "North Testborough FC";
export const DOSSIER_SYNTHETIC_AWAY = "South Example City";

export const DOSSIER_SYNTHETIC_EVIDENCE_REPLAY_ID = "synthetic-dossier-evidence-v1";

export function isDossierSyntheticTestFixture(fixture: ModelFixture): boolean {
  return fixture.home === DOSSIER_SYNTHETIC_HOME && fixture.away === DOSSIER_SYNTHETIC_AWAY;
}

export function isSyntheticDossierEvidenceHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "dossier-fixture.example.test" || host.endsWith(".example.test");
  } catch {
    return false;
  }
}
