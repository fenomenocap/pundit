import {
  classifyServedShaWithRefresh,
  isAcceptableServedSha,
} from "./resolve-deployed-sha.mjs";

/**
 * Decide whether the API startup poll in verify-prod.sh can stop.
 *
 * Step 2 normally waits for /startup HTTP 200 plus an acceptable served SHA.
 * During Railway rollouts the edge can return 502 on the healthcheck path
 * while /version already serves the target commit and /health is live — that
 * is a proxy race, not a stale deploy.
 */
export function apiStartupPollPassed({
  startupHttp,
  healthHttp = null,
  servedSha,
  floorSha,
  cwd = process.cwd(),
}) {
  const shaState = floorSha
    ? classifyServedShaWithRefresh(floorSha, servedSha, { cwd })
    : "missing";
  const shaOk = isAcceptableServedSha(shaState);

  if (!shaOk) {
    return { pass: false, shaState, reason: "sha-not-ready", startupHttp, healthHttp };
  }

  if (startupHttp === "200") {
    return { pass: true, shaState, reason: "startup-ready", startupHttp, healthHttp };
  }

  if (startupHttp === "502" && healthHttp === "200") {
    return {
      pass: true,
      shaState,
      reason: "rollout-proxy-502",
      startupHttp,
      healthHttp,
    };
  }

  return { pass: false, shaState, reason: "waiting", startupHttp, healthHttp };
}

const HOMEPAGE_JS_CHUNK_RE = /\/_next\/static\/[^"]+\.js/g;

/** Paths referenced by the homepage document for client JS bundles. */
export function extractHomepageJsChunks(html) {
  return [...new Set(html.match(HOMEPAGE_JS_CHUNK_RE) ?? [])];
}

/** HTTP statuses that often clear during Vercel static-asset propagation. */
export function isTransientDeployHttp(status) {
  return status === 404 || status === 502 || status === 503;
}

export function inspectChunkBodies(chunks, chunkBodies, expectedApiHost) {
  let foundHost = false;
  let foundLocalhost = false;
  for (const chunk of chunks) {
    const body = chunkBodies.get(chunk);
    if (typeof body !== "string") continue;
    if (body.includes(expectedApiHost)) foundHost = true;
    if (body.includes("localhost:3001")) foundLocalhost = true;
  }
  return { foundHost, foundLocalhost };
}

/**
 * One pass of verify-prod step 9: homepage HTML, every referenced JS chunk,
 * and the production API host / localhost leak checks.
 */
export async function attemptVercelBundleCheck({
  webUrl,
  expectedApiHost,
  fetchImpl = fetch,
}) {
  const base = webUrl.replace(/\/$/, "");
  const homepage = await fetchImpl(`${base}/`);
  if (!homepage.ok) {
    const httpStatus = homepage.status;
    return {
      pass: false,
      reason: isTransientDeployHttp(httpStatus) ? "homepage-transient" : "homepage-fail",
      httpStatus,
      retryable: isTransientDeployHttp(httpStatus),
    };
  }

  const html = await homepage.text();
  const chunks = extractHomepageJsChunks(html);
  if (chunks.length === 0) {
    return { pass: false, reason: "no-chunks", retryable: false };
  }

  const bodies = new Map();
  for (const chunk of chunks) {
    const response = await fetchImpl(`${base}${chunk}`);
    if (!response.ok) {
      const httpStatus = response.status;
      return {
        pass: false,
        reason: isTransientDeployHttp(httpStatus) ? "chunk-transient" : "chunk-fail",
        httpStatus,
        failedChunk: chunk,
        chunkCount: chunks.length,
        retryable: isTransientDeployHttp(httpStatus),
      };
    }
    bodies.set(chunk, await response.text());
  }

  const { foundHost, foundLocalhost } = inspectChunkBodies(chunks, bodies, expectedApiHost);
  if (!foundHost) {
    return {
      pass: false,
      reason: "host-not-found",
      retryable: false,
      chunkCount: chunks.length,
      inspected: chunks,
    };
  }
  if (foundLocalhost) {
    return {
      pass: false,
      reason: "localhost-leak",
      retryable: false,
      chunkCount: chunks.length,
      inspected: chunks,
    };
  }

  return {
    pass: true,
    reason: "ok",
    chunkCount: chunks.length,
    inspected: chunks,
  };
}

/**
 * Step 3 can pass while /api/version already serves the target SHA but
 * `/_next/static/*` chunks from the same deployment are still propagating
 * (pundit-vp-37224148805). Retry transient homepage/chunk fetches.
 */
export async function pollVercelBundleCheck({
  webUrl,
  expectedApiHost,
  maxAttempts = 48,
  intervalMs = 5000,
  fetchImpl = fetch,
  sleepImpl = sleep,
}) {
  let last = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    last = await attemptVercelBundleCheck({ webUrl, expectedApiHost, fetchImpl });
    if (last.pass) {
      return { ...last, attempts: attempt };
    }
    if (!last.retryable || attempt === maxAttempts) {
      return { ...last, attempts: attempt };
    }
    await sleepImpl(intervalMs);
  }
  return { ...last, attempts: maxAttempts };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function flag(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

function printJson(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function runCli() {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (command === "startup-poll") {
    printJson(apiStartupPollPassed({
      startupHttp: flag(argv, "--startup") ?? "",
      healthHttp: flag(argv, "--health") ?? null,
      servedSha: flag(argv, "--served") ?? "",
      floorSha: flag(argv, "--floor") ?? "",
    }));
    process.exit(0);
  }

  if (command === "bundle-check") {
    const webUrl = flag(argv, "--web") ?? "";
    const expectedApiHost = flag(argv, "--host") ?? "";
    const maxAttempts = Number(flag(argv, "--attempts") ?? "48");
    const intervalArg = flag(argv, "--interval");
    const intervalMs = intervalArg != null ? Number(intervalArg) * 1000 : 5000;

    if (!webUrl || !expectedApiHost) {
      console.error("usage: verify-prod-lib.mjs bundle-check --web <url> --host <api-host> [--attempts N] [--interval SEC]");
      process.exit(2);
    }

    try {
      const result = await pollVercelBundleCheck({
        webUrl,
        expectedApiHost,
        maxAttempts,
        intervalMs,
      });
      printJson(result);
      process.exit(result.pass ? 0 : 1);
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  }

  console.error("usage: verify-prod-lib.mjs startup-poll ... | bundle-check --web <url> --host <api-host>");
  process.exit(2);
}

if (process.argv[1]?.endsWith("verify-prod-lib.mjs")) {
  runCli();
}
