import {
  buildAndPersistDossiersForWindowAsync,
  buildMatchDossierForFixture,
  filterFixturesInKickoffWindow,
  publicFixtureId,
  PHASE1_WEEKEND_WINDOW,
} from "./builder";
import { getDossierFplStatus } from "./fpl-bootstrap-injuries";
import {
  DOSSIER_INTERVAL_MS,
  DOSSIER_PRE_KICKOFF_MS,
  DOSSIER_PRE_KICKOFF_POLL_MS,
  matchDossierEnabled,
  matchDossierFplEnabled,
} from "./flags";
import { readMatchDossier, writeMatchDossier } from "./storage";
import { getCachedModelData } from "../model-data";
import { getDossierSlateRebuildProgress } from "./dossier-slate-rebuild";

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let preKickoffHandle: ReturnType<typeof setInterval> | null = null;

async function prefetchFplBootstrapIfEnabled(): Promise<void> {
  if (!matchDossierFplEnabled()) return;
  const { prefetchFplBootstrapForBuildPass } = await import("./fpl-bootstrap-injuries");
  await prefetchFplBootstrapForBuildPass();
}

export async function runScheduledDossierBuild(
  reason: "interval-6h" | "manual" = "interval-6h",
): Promise<number> {
  const dossiers = await buildAndPersistDossiersForWindowAsync(PHASE1_WEEKEND_WINDOW, {
    scheduleReason: reason === "interval-6h" ? "interval-6h" : "manual",
  });
  return dossiers.length;
}

export async function runPreKickoffDossierRefresh(now = new Date()): Promise<number> {
  await prefetchFplBootstrapIfEnabled();
  const model = getCachedModelData();
  const nowMs = now.getTime();
  const upper = nowMs + DOSSIER_PRE_KICKOFF_MS;
  const imminent = model.fixtures.filter((fixture) => {
    if (fixture.competitionId !== "eng.1") return false;
    const kickoff = Date.parse(fixture.utcDate);
    return Number.isFinite(kickoff) && kickoff >= nowMs && kickoff <= upper;
  });

  let rebuilt = 0;
  for (const fixture of imminent) {
    const fixtureId = publicFixtureId(fixture);
    const existing = readMatchDossier(fixtureId);
    const stale = !existing
      || nowMs - Date.parse(existing.builtAt) > DOSSIER_PRE_KICKOFF_POLL_MS;
    if (!stale) continue;
    writeMatchDossier(buildMatchDossierForFixture(fixture, {
      scheduleReason: "pre-kickoff-90m",
      now,
    }));
    rebuilt += 1;
  }
  return rebuilt;
}

export function startMatchDossierCron(): void {
  if (!matchDossierEnabled()) return;
  if (intervalHandle) return;

  void runScheduledDossierBuild("interval-6h").catch((error) => {
    console.warn("[MatchDossier] Scheduled build failed:", error);
  });
  intervalHandle = setInterval(() => {
    void runScheduledDossierBuild("interval-6h").catch((error) => {
      console.warn("[MatchDossier] Scheduled build failed:", error);
    });
  }, DOSSIER_INTERVAL_MS);
  intervalHandle.unref?.();

  preKickoffHandle = setInterval(() => {
    void runPreKickoffDossierRefresh().catch((error) => {
      console.warn("[MatchDossier] Pre-kickoff refresh failed:", error);
    });
  }, DOSSIER_PRE_KICKOFF_POLL_MS);
  preKickoffHandle.unref?.();
}

export function stopMatchDossierCronForTests(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  if (preKickoffHandle) clearInterval(preKickoffHandle);
  intervalHandle = null;
  preKickoffHandle = null;
}

export function dossierCronStatus(): {
  enabled: boolean;
  intervalMs: number;
  preKickoffPollMs: number;
  activeWindow: typeof PHASE1_WEEKEND_WINDOW;
  slateRebuild: ReturnType<typeof getDossierSlateRebuildProgress>;
  fplStatus: ReturnType<typeof getDossierFplStatus>;
} {
  return {
    enabled: matchDossierEnabled(),
    intervalMs: DOSSIER_INTERVAL_MS,
    preKickoffPollMs: DOSSIER_PRE_KICKOFF_POLL_MS,
    activeWindow: PHASE1_WEEKEND_WINDOW,
    slateRebuild: getDossierSlateRebuildProgress(),
    fplStatus: getDossierFplStatus(),
  };
}

/** Exported for tests — count EPL fixtures in the active build window. */
export function countFixturesInActiveWindow(): number {
  const model = getCachedModelData();
  return filterFixturesInKickoffWindow(
    model.fixtures.filter((f) => f.competitionId === "eng.1"),
    PHASE1_WEEKEND_WINDOW,
  ).length;
}
