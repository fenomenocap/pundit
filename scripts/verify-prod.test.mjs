import assert from "node:assert/strict";
import test from "node:test";

import { apiStartupPollPassed } from "./verify-prod-lib.mjs";

const FLOOR = "c56c1e3f187161f572f32cdde27a88786d01dd2f";

test("startup 200 with an acceptable SHA passes immediately", () => {
  assert.deepEqual(apiStartupPollPassed({
    startupHttp: "200",
    healthHttp: "200",
    servedSha: FLOOR,
    floorSha: FLOOR,
  }), {
    pass: true,
    shaState: "match",
    reason: "startup-ready",
    startupHttp: "200",
    healthHttp: "200",
  });
});

test("startup 502 with matching SHA and live health passes as rollout proxy race", () => {
  assert.deepEqual(apiStartupPollPassed({
    startupHttp: "502",
    healthHttp: "200",
    servedSha: FLOOR,
    floorSha: FLOOR,
  }), {
    pass: true,
    shaState: "match",
    reason: "rollout-proxy-502",
    startupHttp: "502",
    healthHttp: "200",
  });
});

test("startup 502 without live health keeps polling", () => {
  assert.equal(apiStartupPollPassed({
    startupHttp: "502",
    healthHttp: "502",
    servedSha: FLOOR,
    floorSha: FLOOR,
  }).pass, false);
});

test("startup 503 with matching SHA keeps polling until caches are ready", () => {
  const result = apiStartupPollPassed({
    startupHttp: "503",
    healthHttp: "200",
    servedSha: FLOOR,
    floorSha: FLOOR,
  });
  assert.equal(result.pass, false);
  assert.equal(result.reason, "waiting");
});

test("startup 200 with a stale SHA does not pass", () => {
  const result = apiStartupPollPassed({
    startupHttp: "200",
    healthHttp: "200",
    servedSha: "0000000000000000000000000000000000000000",
    floorSha: FLOOR,
  });
  assert.equal(result.pass, false);
  assert.equal(result.reason, "sha-not-ready");
});
