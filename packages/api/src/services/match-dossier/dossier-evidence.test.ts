import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixture } from "../__fixtures__/model-fixture";
import { resetWebSearchReplayCacheForTests } from "../web-search-replay";
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

  it("planDossierEvidenceQueries is stable for Chelsea vs Tottenham", () => {
    const row = fixture("Chelsea", "Tottenham", {
      utcDate: "2026-10-24T16:30:00.000Z",
    });
    const queries = planDossierEvidenceQueries(row, new Date("2026-10-19T10:40:00.000Z"));
    expect(queries.length).toBeGreaterThanOrEqual(10);
    expect(queries.some((q) => q.includes("injuries"))).toBe(true);
  });

  it("collects cited evidence deterministically from replay (no network)", async () => {
    const row = fixture("Chelsea", "Tottenham", {
      fixtureId: 401878767,
      utcDate: "2026-10-24T16:30:00.000Z",
    });
    const now = new Date("2026-10-19T10:40:00.000Z");
    const first = await collectDossierEvidence(row, {
      now,
      replayScope: { replayId: "chelsea-tottenham-weekend-v1", recordPath: null },
    });
    const second = await collectDossierEvidence(row, {
      now,
      replayScope: { replayId: "chelsea-tottenham-weekend-v1", recordPath: null },
    });
    expect(first.items.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
    for (const item of first.items) {
      expect(item.sourceUrl).toMatch(/^https:\/\//);
      expect(item.claim.length).toBeGreaterThan(10);
      expect(item.verification).toBe("cited");
      expect(item.publisher.length).toBeGreaterThan(0);
    }
  });

  it("merges evidence into dossier without changing model probabilities", async () => {
    const row = fixture("Chelsea", "Tottenham", {
      fixtureId: 401878767,
      pHome: 0.594,
      utcDate: "2026-10-24T16:30:00.000Z",
    });
    const evidence = await collectDossierEvidence(row, {
      now: new Date("2026-10-19T10:40:00.000Z"),
      replayScope: { replayId: "chelsea-tottenham-weekend-v1", recordPath: null },
    });
    const dossier = buildMatchDossierForFixture(row, {
      scheduleReason: "manual",
      now: new Date("2026-10-19T10:40:00.000Z"),
      evidence,
    });
    expect(dossier.schemaVersion).toBe(MATCH_DOSSIER_SCHEMA_VERSION);
    expect(dossier.model.value.pHome).toBe(0.594);
    expect(dossier.evidence.length).toBe(evidence.items.length);
    expect(dossier.table.home.provenance.sourceRole).toBe("interim");
    expect(dossier.evidenceBuild?.replayId).toBe("chelsea-tottenham-weekend-v1");
  });

  it("drops tier-other publishers", () => {
    const row = fixture("Chelsea", "Tottenham");
    const { items, dropped } = federatedResultsToEvidenceItems(
      row,
      [{
        title: "Fan blog rumour",
        link: "https://randomfanblog.example/post",
        snippet: "Unverified rumour about Chelsea lineup.",
        date: "2026-10-19",
        tier: "other",
      }],
      new Map([["https://randomfanblog.example/post", "chelsea injury"]]),
      "2026-10-19T10:00:00.000Z",
      "scheduled",
    );
    expect(items).toHaveLength(0);
    expect(dropped).toBe(1);
  });
});
