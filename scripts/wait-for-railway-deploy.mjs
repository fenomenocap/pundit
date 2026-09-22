#!/usr/bin/env node

/**
 * Wait for Railway's GitHub commit status before verify-prod polls /version.
 *
 * Verify Production starts on every main push. Railway often finishes later than
 * the old ~4 minute startup poll budget — pundit-vp-35766143062 failed while
 * Railway was still deploying dab41c6 and reported success ~7.5 minutes after
 * push. This helper blocks only when the push required an API rebuild.
 */

const DEFAULT_CONTEXT = "pundit - @pundit/api";
const DEFAULT_TIMEOUT_SECONDS = 900;
const DEFAULT_INTERVAL_SECONDS = 15;

function flag(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * True when this push is the newest commit that must rebuild the API.
 * Docs-only or web-only pushes keep an older API floor and skip the wait.
 */
export function railwayDeployRequired(apiFloorSha, pushSha) {
  const floor = (apiFloorSha ?? "").trim();
  const push = (pushSha ?? "").trim();
  return Boolean(floor && push && floor === push);
}

/**
 * Pick the newest GitHub status row for a deployment context.
 * The statuses API returns newest first.
 */
export function latestStatusForContext(statuses, context) {
  if (!Array.isArray(statuses)) return null;
  return statuses.find((row) => row?.context === context) ?? null;
}

/**
 * Map a Railway GitHub status to a wait-loop decision.
 *   done     - deploy reported success
 *   failed   - deploy reported failure/error
 *   waiting  - pending or not posted yet
 */
export function classifyRailwayStatus(status) {
  if (!status) return "waiting";
  const state = String(status.state ?? "").toLowerCase();
  if (state === "success") return "done";
  if (state === "failure" || state === "error") return "failed";
  return "waiting";
}

function repoFromEnv(env = process.env) {
  const slug = env.GITHUB_REPOSITORY;
  if (!slug) return null;
  const [owner, repo] = slug.split("/");
  if (!owner || !repo) return null;
  return { owner, repo };
}

async function fetchStatuses({ owner, repo, sha, token, fetchImpl = fetch }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/commits/${sha}/statuses`;
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub statuses HTTP ${response.status}: ${body.slice(0, 200)}`);
  }
  return response.json();
}

/**
 * Poll Railway's GitHub commit status until success, failure, or timeout.
 */
export async function waitForRailwayDeploy(options = {}) {
  const {
    sha,
    context = DEFAULT_CONTEXT,
    timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
    intervalSeconds = DEFAULT_INTERVAL_SECONDS,
    token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN,
    repo = repoFromEnv(options.env ?? process.env),
    fetchImpl = fetch,
    now = Date.now,
    sleepImpl = sleep,
  } = options;

  if (!sha) throw new Error("waitForRailwayDeploy requires --sha");
  if (!token) throw new Error("GITHUB_TOKEN or GH_TOKEN is required");
  if (!repo) throw new Error("GITHUB_REPOSITORY is required");

  const deadline = now() + timeoutSeconds * 1000;
  let attempt = 0;

  while (now() <= deadline) {
    attempt += 1;
    const statuses = await fetchStatuses({ ...repo, sha, token, fetchImpl });
    const latest = latestStatusForContext(statuses, context);
    const decision = classifyRailwayStatus(latest);

    if (decision === "done") {
      return {
        ok: true,
        attempts: attempt,
        status: latest,
      };
    }

    if (decision === "failed") {
      return {
        ok: false,
        attempts: attempt,
        status: latest,
        reason: "railway-status-failed",
      };
    }

    if (now() + intervalSeconds * 1000 > deadline) break;
    await sleepImpl(intervalSeconds * 1000);
  }

  return {
    ok: false,
    attempts: attempt,
    reason: "railway-status-timeout",
  };
}

async function main(argv = process.argv.slice(2)) {
  if (flag(argv, "--help") !== undefined || argv[0] === "help") {
    console.error("usage: wait-for-railway-deploy.mjs --sha <sha> [--context <name>] [--timeout-seconds <n>] [--interval-seconds <n>]");
    process.exit(2);
  }

  const sha = flag(argv, "--sha");
  const result = await waitForRailwayDeploy({
    sha,
    context: flag(argv, "--context") ?? DEFAULT_CONTEXT,
    timeoutSeconds: Number(flag(argv, "--timeout-seconds") ?? DEFAULT_TIMEOUT_SECONDS),
    intervalSeconds: Number(flag(argv, "--interval-seconds") ?? DEFAULT_INTERVAL_SECONDS),
  });

  if (result.ok) {
    const url = result.status?.target_url ?? "";
    process.stdout.write(`Railway deploy success for ${sha}${url ? ` (${url})` : ""}\n`);
    process.exit(0);
  }

  if (result.reason === "railway-status-failed") {
    const description = result.status?.description ?? "deploy failed";
    const url = result.status?.target_url ?? "";
    console.error(`FAIL: Railway GitHub status failed for ${sha}: ${description}${url ? ` — ${url}` : ""}`);
    process.exit(1);
  }

  console.error(`FAIL: timed out waiting for Railway GitHub status success on ${sha}`);
  process.exit(1);
}

if (process.argv[1]?.endsWith("wait-for-railway-deploy.mjs")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
