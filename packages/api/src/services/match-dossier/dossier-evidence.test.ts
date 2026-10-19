import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixture } from "../__fixtures__/model-fixture";
import { resetWebSearchReplayCacheForTests } from "../web-search-replay";
import {
  DOSSIER_SYNTHETIC_AWAY,
  DOSSIER_SYNTHETIC_EVIDENCE_REPLAY_ID,
  DOSSIER_SYNTHETIC_HOME,
} from "./dossier-synthetic-fixture";
import {
  collectDossierEvidence,
  federatedResultsToEvidenceItems,
  planDossierEvidenceQueries,
} from "./dossier-evidence";
import { buildMatchDossierForFixture } from "./builder";
import { MATCH_DOSSIER_SCHEMA_VERSION } from "./types";

const REPLAY_DIR = path.join(
  __dirname,
  "../../../data/research/match-dossier/search-replays",
);

describe("dossier evidence (Phase 2)", () => {
  const prevReplayDir = process.env.CHAT_EVAL_SEARCH_REPLAY_DIR;

  beforeEach(() => {
    process.env.CHAT_EVAL_SEARCH_REPLAY_DIR = REPLAY_DIR;
    resetWebSearchReplayCacheForTests();
  });

  afterEach(() => {
    if (prevReplayDir === undefined) delete process.env.CHAT_EVAL_SEARCH_REPLAY_DIR;
    else process.env.CHAT_EVAL_SEARCH_REPLAY_DIR = prevReplayDir;
    resetWebSearchReplayCacheForTests();
  });

  it("planDossierEvidenceQueries is stable for synthetic test fixture", () => {
    const row = fixture(DOSSIER_SYNTHETIC_HOME, DOSSIER_SYNTHETIC_AWAY, {
      utcDate: "2026-10-24T15:00:00.000Z",
    });
    const queries = planDossierEvidenceQueries(row, new Date("2026-10-19T12:00:00.000Z"));
    expect(queries.length).toBeGreaterThanOrEqual(10);
    expect(queries.some((q) => q.includes("injuries"))).toBe(true);
  });

  it("collects cited evidence deterministically from synthetic replay (no network)", async () => {
    const row = fixture(DOSSIER_SYNTHETIC_HOME, DOSSIER_SYNTHETIC_AWAY, {
      fixtureId: 909990001,
      utcDate: "2026-10-24T15:00:00.000Z",
    });
    const now = new Date("2026-10-19T12:00:00.000Z");
    const scope = { replayId: DOSSIER_SYNTHETIC_EVIDENCE_REPLAY_ID, recordPath: null };
    const first = await collectDossierEvidence(row, { now, replayScope: scope });
    const second = await collectDossierEvidence(row, { now, replayScope: scope });
    expect(first.items.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
    for (const item of first.items) {
      expect(item.sourceUrl).toMatch(/\.example\.test\//);
      expect(item.claim).toMatch(/SYNTHETIC/i);
      expect(item.verification).toBe("cited");
    }
  });

  it("refuses synthetic replay for real EPL fixtures (no evidence written)", async () => {
    const row = fixture("Chelsea", "Tottenham", {
      fixtureId: 401878767,
      utcDate: "2026-10-24T16:30:00.000Z",
    });
    const evidence = await collectDossierEvidence(row, {
      now: new Date("2026-10-19T12:00:00.000Z"),
      replayScope: { replayId: DOSSIER_SYNTHETIC_EVIDENCE_REPLAY_ID, recordPath: null },
    });
    expect(evidence.items).toEqual([]);
    expect(evidence.syntheticReplayBlocked).toBe(true);

    const dossier = buildMatchDossierForFixture(row, {
      scheduleReason: "manual",
      now: new Date("2026-10-19T12:00:00.000Z"),
      evidence,
    });
    expect(dossier.evidence).toEqual([]);
    expect(dossier.evidenceBuild).toBeUndefined();
  });

  it("merges synthetic evidence into dossier without changing model probabilities", async () => {
    const row = fixture(DOSSIER_SYNTHETIC_HOME, DOSSIER_SYNTHETIC_AWAY, {
      fixtureId: 909990001,
      pHome: 0.512,
      utcDate: "2026-10-24T15:00:00.000Z",
    });
    const evidence = await collectDossierEvidence(row, {
      now: new Date("2026-10-19T12:00:00.000Z"),
      replayScope: { replayId: DOSSIER_SYNTHETIC_EVIDENCE_REPLAY_ID, recordPath: null },
    });
    const dossier = buildMatchDossierForFixture(row, {
      scheduleReason: "manual",
      now: new Date("2026-10-19T12:00:00.000Z"),
      evidence,
    });
    expect(dossier.schemaVersion).toBe(MATCH_DOSSIER_SCHEMA_VERSION);
    expect(dossier.model.value.pHome).toBe(0.512);
    expect(dossier.evidence.length).toBe(evidence.items.length);
    expect(dossier.evidenceBuild?.replayId).toBe(DOSSIER_SYNTHETIC_EVIDENCE_REPLAY_ID);
  });

  it("drops tier-other publishers", () => {
    const row = fixture(DOSSIER_SYNTHETIC_HOME, DOSSIER_SYNTHETIC_AWAY);
    const { items, dropped } = federatedResultsToEvidenceItems(
      row,
      [{
        title: "Fan blog rumour",
        link: "https://randomfanblog.example/post",
        snippet: "Unverified rumour about lineup.",
        date: "2026-10-19",
        tier: "other",
      }],
      new Map([["https://randomfanblog.example/post", "injury"]]),
      "2026-10-19T10:00:00.000Z",
      "scheduled",
    );
    expect(items).toHaveLength(0);
    expect(dropped).toBe(1);
  });
});
