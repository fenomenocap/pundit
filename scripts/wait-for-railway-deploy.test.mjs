import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyRailwayStatus,
  latestStatusForContext,
  railwayDeployRequired,
  waitForRailwayDeploy,
} from "./wait-for-railway-deploy.mjs";

const CONTEXT = "pundit - @pundit/api";

test("railway deploy is required only when the API floor equals the push SHA", () => {
  assert.equal(railwayDeployRequired("abc", "abc"), true);
  assert.equal(railwayDeployRequired("abc", "def"), false);
  assert.equal(railwayDeployRequired("", "abc"), false);
});

test("latestStatusForContext returns the newest matching row", () => {
  const statuses = [
    { context: CONTEXT, state: "success", description: "done" },
    { context: "other", state: "success" },
    { context: CONTEXT, state: "pending", description: "old pending" },
  ];
  assert.equal(latestStatusForContext(statuses, CONTEXT)?.description, "done");
  assert.equal(latestStatusForContext(statuses, "missing"), null);
});

test("classifyRailwayStatus maps GitHub states to wait decisions", () => {
  assert.equal(classifyRailwayStatus(null), "waiting");
  assert.equal(classifyRailwayStatus({ state: "pending" }), "waiting");
  assert.equal(classifyRailwayStatus({ state: "success" }), "done");
  assert.equal(classifyRailwayStatus({ state: "failure" }), "failed");
  assert.equal(classifyRailwayStatus({ state: "error" }), "failed");
});

test("waitForRailwayDeploy exits successfully on Railway success", async () => {
  let calls = 0;
  const result = await waitForRailwayDeploy({
    sha: "dab41c6",
    context: CONTEXT,
    token: "test-token",
    repo: { owner: "fenomenocap", repo: "pundit" },
    timeoutSeconds: 30,
    intervalSeconds: 1,
    now: () => 0,
    sleepImpl: async () => {},
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: true,
        async json() {
          return calls === 1
            ? [{ context: CONTEXT, state: "pending", description: "deploying" }]
            : [{ context: CONTEXT, state: "success", description: "done", target_url: "https://railway.example" }];
        },
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.equal(result.status?.state, "success");
});

test("waitForRailwayDeploy fails fast when Railway reports failure", async () => {
  const result = await waitForRailwayDeploy({
    sha: "deadbeef",
    context: CONTEXT,
    token: "test-token",
    repo: { owner: "fenomenocap", repo: "pundit" },
    timeoutSeconds: 30,
    intervalSeconds: 1,
    now: () => 0,
    sleepImpl: async () => {},
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return [{ context: CONTEXT, state: "failure", description: "build crashed" }];
      },
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "railway-status-failed");
});

test("waitForRailwayDeploy times out when status never succeeds", async () => {
  let nowMs = 0;
  const result = await waitForRailwayDeploy({
    sha: "slow",
    context: CONTEXT,
    token: "test-token",
    repo: { owner: "fenomenocap", repo: "pundit" },
    timeoutSeconds: 5,
    intervalSeconds: 2,
    now: () => nowMs,
    sleepImpl: async (ms) => {
      nowMs += ms;
    },
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return [{ context: CONTEXT, state: "pending" }];
      },
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "railway-status-timeout");
});
