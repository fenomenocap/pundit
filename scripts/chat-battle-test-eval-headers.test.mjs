import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { buildAskEvalHeaders, resolveEvalSearchReplayId } from "./chat-battle-test.mjs";

const base = {
  evalReplayGuardId: "monitor-gate-v1",
  engine: "legacy",
};

test("importing chat-battle-test.mjs does not run the CLI or perform network I/O", () => {
  const moduleUrl = pathToFileURL(path.join(import.meta.dirname, "chat-battle-test.mjs")).href;
  const snippet = `
    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (...args) => {
      fetchCalls += 1;
      return originalFetch(...args);
    };
    await import(${JSON.stringify(moduleUrl)});
    if (process.exitCode === 1) {
      console.error("exitCode was set on import");
      process.exit(2);
    }
    if (fetchCalls > 0) {
      console.error(\`fetch was called \${fetchCalls} time(s) on import\`);
      process.exit(3);
    }
  `;
  execFileSync(process.execPath, ["--input-type=module", "-e", snippet], { stdio: "pipe" });
});

test("live agent sweep uses engine header without search replay", () => {
  const options = { ...base, engine: "agent" };
  assert.equal(resolveEvalSearchReplayId(options), null);
  const headers = buildAskEvalHeaders(options);
  assert.equal(headers["x-pundit-chat-engine"], "agent");
  assert.equal(headers["x-pundit-chat-eval-search-replay"], undefined);
});

test("pinned gate fixture keeps replay header without forcing agent replay on sweeps", () => {
  const options = { ...base, gateOnly: true, engine: "legacy" };
  assert.equal(resolveEvalSearchReplayId(options), "monitor-gate-v1");
  const headers = buildAskEvalHeaders(options);
  assert.equal(headers["x-pundit-chat-eval-search-replay"], "monitor-gate-v1");
  assert.equal(headers["x-pundit-chat-engine"], "legacy");
});
