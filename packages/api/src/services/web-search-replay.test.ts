import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  lookupWebSearchReplay,
  resetWebSearchReplayCacheForTests,
  withWebSearchReplayScope,
} from "./web-search-replay";
import { resetWebSearchStatus, searchWeb, withSearchQuestion } from "./web-search";

describe("web search replay", () => {
  let replayDir: string;

  beforeEach(() => {
    resetWebSearchStatus();
    resetWebSearchReplayCacheForTests();
    replayDir = mkdtempSync(path.join(tmpdir(), "pundit-search-replay-"));
    process.env.CHAT_EVAL_SEARCH_REPLAY_DIR = replayDir;
    writeFileSync(path.join(replayDir, "gate-test.json"), JSON.stringify({
      schemaVersion: 1,
      replayId: "gate-test",
      queries: {
        "everton manager": {
          status: "ok",
          results: [{
            title: "Everton manager",
            link: "https://example.com/everton",
            snippet: "Sean Dyche",
            date: "2026-09-22",
          }],
          provider: "openrouter",
          reason: null,
          usedFallback: false,
          attempts: [],
        },
      },
    }));
  });

  afterEach(() => {
    delete process.env.CHAT_EVAL_SEARCH_REPLAY_DIR;
    vi.unstubAllGlobals();
    resetWebSearchReplayCacheForTests();
  });

  it("returns recorded outcomes without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await withWebSearchReplayScope(
      { replayId: "gate-test", recordPath: null },
      () => withSearchQuestion(() => searchWeb("Everton manager")),
    );

    expect(outcome.status).toBe("ok");
    expect(outcome.results[0]?.link).toBe("https://example.com/everton");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lookup misses return null", () => {
    expect(lookupWebSearchReplay("unknown query", "gate-test")).toBeNull();
  });
});
