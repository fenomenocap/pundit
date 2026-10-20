import {
  buildMatchDossierForFixtureAsync,
  filterFixturesInKickoffWindow,
  PHASE1_WEEKEND_WINDOW,
  publicFixtureId,
} from "./builder";
import { matchDossierEnabled } from "./flags";
import { writeMatchDossier } from "./storage";
import { getCachedModelData } from "../model-data";
import type { ModelFixture } from "../model-data";

/** Max one federated fixture build per interval (~7/min). */
export const DOSSIER_SLATE_FIXTURE_PACE_MS = Math.ceil(60_000 / 7);

export type DossierSlateRebuildState = "idle" | "running" | "completed" | "failed";

export interface DossierSlateRebuildProgress {
  state: DossierSlateRebuildState;
  startedAt: string | null;
  finishedAt: string | null;
  totalFixtures: number;
  completedFixtures: number;
  currentFixtureId: string | null;
  lastError: string | null;
}

function idleProgress(): DossierSlateRebuildProgress {
  return {
    state: "idle",
    startedAt: null,
    finishedAt: null,
    totalFixtures: 0,
    completedFixtures: 0,
    currentFixtureId: null,
    lastError: null,
  };
}

let progress: DossierSlateRebuildProgress = idleProgress();

export function getDossierSlateRebuildProgress(): DossierSlateRebuildProgress {
  return { ...progress };
}

export function resetDossierSlateRebuildForTests(): void {
  progress = idleProgress();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export interface SlateRebuildRunnerDeps {
  listFixtures: () => ModelFixture[];
  buildFixture: (fixture: ModelFixture) => Promise<void>;
  paceMs: number;
  sleepFn: (ms: number) => Promise<void>;
}

const defaultRunnerDeps = (): SlateRebuildRunnerDeps => ({
  listFixtures: () => {
    const model = getCachedModelData();
    return filterFixturesInKickoffWindow(
      model.fixtures.filter((f) => f.competitionId === "eng.1"),
      PHASE1_WEEKEND_WINDOW,
    );
  },
  buildFixture: async (fixture) => {
    const dossier = await buildMatchDossierForFixtureAsync(fixture, { scheduleReason: "manual" });
    writeMatchDossier(dossier);
  },
  paceMs: DOSSIER_SLATE_FIXTURE_PACE_MS,
  sleepFn: sleep,
});

let runnerDeps: SlateRebuildRunnerDeps = defaultRunnerDeps();

export function setSlateRebuildRunnerDepsForTests(deps: Partial<SlateRebuildRunnerDeps>): void {
  runnerDeps = { ...defaultRunnerDeps(), ...deps };
}

export function restoreSlateRebuildRunnerDepsForTests(): void {
  runnerDeps = defaultRunnerDeps();
}

async function runSlateRebuild(): Promise<void> {
  if (!matchDossierEnabled()) {
    progress = { ...idleProgress(), state: "failed", lastError: "match_dossier_disabled" };
    return;
  }
  const fixtures = runnerDeps.listFixtures();
  progress = {
    state: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    totalFixtures: fixtures.length,
    completedFixtures: 0,
    currentFixtureId: null,
    lastError: null,
  };
  try {
    for (let index = 0; index < fixtures.length; index += 1) {
      const row = fixtures[index]!;
      progress.currentFixtureId = publicFixtureId(row);
      await runnerDeps.buildFixture(row);
      progress.completedFixtures = index + 1;
      if (index < fixtures.length - 1) {
        await runnerDeps.sleepFn(runnerDeps.paceMs);
      }
    }
    progress.state = "completed";
  } catch (error) {
    progress.state = "failed";
    progress.lastError = error instanceof Error ? error.message : String(error);
  } finally {
    progress.finishedAt = new Date().toISOString();
    progress.currentFixtureId = null;
  }
}

/** Starts async slate rebuild. Returns false if a run is already in progress. */
export function triggerDossierSlateRebuild(): boolean {
  if (progress.state === "running") return false;
  void runSlateRebuild();
  return true;
}
