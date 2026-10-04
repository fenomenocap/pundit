import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  apiStartupPollPassed,
  attemptVercelBundleCheck,
  extractHomepageJsChunks,
  inspectChunkBodies,
  isTransientDeployHttp,
  pollVercelBundleCheck,
} from "./verify-prod-lib.mjs";

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

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function write(cwd, relative, content) {
  const target = path.join(cwd, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

test("extractHomepageJsChunks deduplicates script references", () => {
  const html = `
    <script src="/_next/static/chunks/app/page-abc.js"></script>
    <script src="/_next/static/chunks/webpack-def.js"></script>
    <script src="/_next/static/chunks/app/page-abc.js"></script>
  `;
  assert.deepEqual(extractHomepageJsChunks(html), [
    "/_next/static/chunks/app/page-abc.js",
    "/_next/static/chunks/webpack-def.js",
  ]);
});

test("isTransientDeployHttp treats 404 as retryable propagation", () => {
  assert.equal(isTransientDeployHttp(404), true);
  assert.equal(isTransientDeployHttp(500), false);
});

test("attemptVercelBundleCheck finds API host in a fetched chunk", async () => {
  const html = '<script src="/_next/static/chunks/app/page-1.js"></script>';
  const fetchImpl = async (url) => {
    if (url === "https://web.example/") {
      return { ok: true, status: 200, text: async () => html };
    }
    if (url === "https://web.example/_next/static/chunks/app/page-1.js") {
      return {
        ok: true,
        status: 200,
        text: async () => "const API='thepundit.up.railway.app';",
      };
    }
    throw new Error(`unexpected url ${url}`);
  };

  const result = await attemptVercelBundleCheck({
    webUrl: "https://web.example",
    expectedApiHost: "thepundit.up.railway.app",
    fetchImpl,
  });
  assert.equal(result.pass, true);
  assert.equal(result.chunkCount, 1);
});

test("pollVercelBundleCheck retries transient chunk 404 then passes", async () => {
  const html = '<script src="/_next/static/chunks/app/page-1.js"></script>';
  let chunkCalls = 0;
  const fetchImpl = async (url) => {
    if (url === "https://web.example/") {
      return { ok: true, status: 200, text: async () => html };
    }
    if (url === "https://web.example/_next/static/chunks/app/page-1.js") {
      chunkCalls += 1;
      if (chunkCalls === 1) {
        return { ok: false, status: 404, text: async () => "" };
      }
      return {
        ok: true,
        status: 200,
        text: async () => "thepundit.up.railway.app",
      };
    }
    throw new Error(`unexpected url ${url}`);
  };

  let sleeps = 0;
  const result = await pollVercelBundleCheck({
    webUrl: "https://web.example",
    expectedApiHost: "thepundit.up.railway.app",
    maxAttempts: 3,
    intervalMs: 1,
    fetchImpl,
    sleepImpl: async () => { sleeps += 1; },
  });
  assert.equal(result.pass, true);
  assert.equal(result.attempts, 2);
  assert.equal(sleeps, 1);
  assert.equal(chunkCalls, 2);
});

test("inspectChunkBodies flags localhost leak", () => {
  const chunks = ["/a.js"];
  const bodies = new Map([["/a.js", "fetch('http://localhost:3001/api')"]]);
  const { foundHost, foundLocalhost } = inspectChunkBodies(
    chunks,
    bodies,
    "thepundit.up.railway.app",
  );
  assert.equal(foundHost, false);
  assert.equal(foundLocalhost, true);
});

test("startup poll accepts a descendant served SHA after deploy history refresh", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pundit-verify-prod-"));
  try {
    const bare = path.join(root, "remote.git");
    git(root, "init", "--bare", "-q", bare);

    const publisher = path.join(root, "publisher");
    fs.mkdirSync(publisher);
    git(publisher, "init", "-q", "-b", "main");
    git(publisher, "config", "user.email", "test@example.com");
    git(publisher, "config", "user.name", "Test");
    write(publisher, "package.json", "{}");
    write(publisher, "packages/api/src.ts", "api-1");
    git(publisher, "add", ".");
    git(publisher, "commit", "-qm", "floor deploy");
    const floor = git(publisher, "rev-parse", "HEAD");

    write(publisher, "packages/api/src.ts", "api-2");
    git(publisher, "add", "packages/api/src.ts");
    git(publisher, "commit", "-qm", "later deploy");
    const served = git(publisher, "rev-parse", "HEAD");

    git(publisher, "remote", "add", "origin", bare);
    git(publisher, "push", "-q", "origin", "main");

    const consumer = path.join(root, "consumer");
    fs.mkdirSync(consumer);
    git(consumer, "init", "-q", "-b", "main");
    git(consumer, "remote", "add", "origin", bare);
    git(consumer, "fetch", "--depth", "1", "--quiet", "origin", floor);
    git(consumer, "checkout", "-q", "--detach", floor);

    const result = apiStartupPollPassed({
      startupHttp: "200",
      healthHttp: "200",
      servedSha: served,
      floorSha: floor,
      cwd: consumer,
    });
    assert.equal(result.pass, true);
    assert.equal(result.shaState, "ahead");
    assert.equal(result.reason, "startup-ready");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
