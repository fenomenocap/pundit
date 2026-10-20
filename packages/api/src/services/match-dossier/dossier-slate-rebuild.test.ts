import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { fixture } from "../__fixtures__/model-fixture";
import {
  DOSSIER_SLATE_FIXTURE_PACE_MS,
  getDossierSlateRebuildProgress,
  resetDossierSlateRebuildForTests,
  restoreSlateRebuildRunnerDepsForTests,
  setSlateRebuildRunnerDepsForTests,
  triggerDossierSlateRebuild,
} from "./dossier-slate-rebuild";

describe("dossier slate rebuild", () => {
  beforeEach(() => {
    resetDossierSlateRebuildForTests();
    process.env.MATCH_DOSSIER_ENABLED = "true";
  });

  afterEach(() => {
    restoreSlateRebuildRunnerDepsForTests();
  });

  it("paces fixture builds at most 7 per minute", () => {
    expect(DOSSIER_SLATE_FIXTURE_PACE_MS).toBeGreaterThanOrEqual(Math.ceil(60_000 / 7));
  });

  it("no-ops trigger while a rebuild is already running", async () => {
    const row = fixture("Arsenal", "Chelsea");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    setSlateRebuildRunnerDepsForTests({
      listFixtures: () => [row, fixture("Liverpool", "Forest")],
      buildFixture: async () => {
        await gate;
      },
      paceMs: 0,
      sleepFn: async () => {},
    });

    expect(triggerDossierSlateRebuild()).toBe(true);
    expect(getDossierSlateRebuildProgress().state).toBe("running");
    expect(triggerDossierSlateRebuild()).toBe(false);

    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(getDossierSlateRebuildProgress().state).toBe("completed");
    expect(getDossierSlateRebuildProgress().completedFixtures).toBe(2);
  });
});
