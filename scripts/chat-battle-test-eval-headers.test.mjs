import assert from "node:assert/strict";
import test from "node:test";

import { buildAskEvalHeaders, resolveEvalSearchReplayId } from "./chat-battle-test.mjs";

const base = {
  evalReplayGuardId: "monitor-gate-v1",
  engine: "legacy",
};

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
