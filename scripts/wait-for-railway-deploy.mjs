#!/usr/bin/env node

/**
 * Wait for Railway's GitHub commit status before verify-prod polls /version.
 *
 * Verify Production starts on every main push. Railway often finishes later than
 * the old ~4 minute startup poll budget — pundit-vp-35766143062 failed while
 * Railway was still deploying dab41c6 and reported success ~7.5 minutes after
 * push. This helper blocks only when the push required an API rebuild.
 */

import { execFileSync } from "node:child_process";

const DEFAULT_CONTEXT = "pundit - @pundit/api";
const DEFAULT_TIMEOUT_SECONDS = 900;
const DEFAULT_INTERVAL_SECONDS = 15;
const DEFAULT_MAIN_REF = "origin/main";
const RAILWAY_INSTATUS_SUMMARY_URL = "https://railway.instatus.com/api/v2/summary.json";
const RAILWAY_INSTATUS_COMPONENTS_URL = "https://railway.instatus.com/api/v2/components.json";
const RAILWAY_INSTATUS_HISTORY_RSS_URL = "https://railway.instatus.com/history.rss";

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

/**
 * Human-readable timeout headline when Railway never posted a GitHub status.
 */
export function railwayTimeoutHeadline(sha, latestStatus) {
  if (!latestStatus) {
    return `FAIL: Railway created no deployment for ${sha}`;
  }
  return `FAIL: timed out waiting for Railway GitHub status success on ${sha}`;
}

/**
 * First status keyword in an Instatus RSS incident description (newest update first).
 */
export function latestIncidentStatusFromRssDescription(description) {
  const match = String(description ?? "").match(/GMT\+0\s*-\s*(\w+)\s*-/);
  return match?.[1]?.toLowerCase() ?? null;
}

/**
 * Open incidents from Railway's public Instatus RSS feed (read-only, no secrets).
 */
export function parseOpenIncidentsFromRss(xml) {
  const text = String(xml ?? "");
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRe.exec(text)) !== null) {
    const block = match[1];
    const title = block.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
    const link = block.match(/<link>([\s\S]*?)<\/link>/i)?.[1]?.trim() ?? "";
    const description =
      block.match(/<description>([\s\S]*?)<\/description>/i)?.[1]?.trim() ?? "";
    const latest = latestIncidentStatusFromRssDescription(description);
    if (latest && latest !== "resolved") {
      items.push({ title, link, latestStatus: latest });
    }
  }
  return items;
}

function walkNonOperationalComponents(components, prefix = "") {
  const rows = [];
  if (!Array.isArray(components)) return rows;
  for (const component of components) {
    const name = String(component?.name ?? "").trim();
    const path = prefix && name ? `${prefix} → ${name}` : name || prefix;
    const status = String(component?.status ?? "").toUpperCase();
    if (status && status !== "OPERATIONAL") {
      rows.push({ name: path || name, status });
    }
    rows.push(...walkNonOperationalComponents(component?.children, path || name));
  }
  return rows;
}

/**
 * Best-effort snapshot of Railway's public status page for CI diagnostics.
 */
export async function fetchRailwayPublicStatusReport(options = {}) {
  const { fetchImpl = fetch } = options;
  const report = {
    pageStatus: null,
    pageUrl: null,
    degradedComponents: [],
    openIncidents: [],
    fetchErrors: [],
  };

  try {
    const summaryResponse = await fetchImpl(RAILWAY_INSTATUS_SUMMARY_URL);
    if (summaryResponse.ok) {
      const summary = await summaryResponse.json();
      report.pageStatus = summary?.page?.status ?? null;
      report.pageUrl = summary?.page?.url ?? null;
    } else {
      report.fetchErrors.push(`summary HTTP ${summaryResponse.status}`);
    }
  } catch (error) {
    report.fetchErrors.push(
      `summary: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    const componentsResponse = await fetchImpl(RAILWAY_INSTATUS_COMPONENTS_URL);
    if (componentsResponse.ok) {
      const payload = await componentsResponse.json();
      report.degradedComponents = walkNonOperationalComponents(payload?.components);
    } else {
      report.fetchErrors.push(`components HTTP ${componentsResponse.status}`);
    }
  } catch (error) {
    report.fetchErrors.push(
      `components: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    const rssResponse = await fetchImpl(RAILWAY_INSTATUS_HISTORY_RSS_URL);
    if (rssResponse.ok) {
      const xml = await rssResponse.text();
      report.openIncidents = parseOpenIncidentsFromRss(xml);
    } else {
      report.fetchErrors.push(`history RSS HTTP ${rssResponse.status}`);
    }
  } catch (error) {
    report.fetchErrors.push(
      `history RSS: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return report;
}

/** Lines suitable for stderr after a Railway deploy wait failure. */
export function formatRailwayPublicStatusReport(report) {
  const lines = [];
  if (report?.pageStatus) {
    lines.push(
      `Railway public status: ${report.pageStatus}${report.pageUrl ? ` (${report.pageUrl})` : ""}`,
    );
  }
  for (const incident of report?.openIncidents ?? []) {
    const suffix = incident.link ? ` — ${incident.link}` : "";
    lines.push(`Railway open incident: ${incident.title} [${incident.latestStatus}]${suffix}`);
  }
  if ((report?.openIncidents ?? []).length === 0 && report?.pageStatus) {
    lines.push("Railway open incidents (RSS): none listed");
  }
  for (const component of report?.degradedComponents ?? []) {
    lines.push(`Railway degraded component: ${component.name} (${component.status})`);
  }
  for (const error of report?.fetchErrors ?? []) {
    lines.push(`Railway public status fetch note: ${error}`);
  }
  return lines;
}

/**
 * First-parent descendants of `sha` on main, newest first. Empty when `sha`
 * is already the deploy tip. Used to detect Railway supersession during bursts.
 */
export function parseDescendantRevList(revListOutput) {
  return String(revListOutput ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function listMainDescendantsAfter(sha, options = {}) {
  const {
    cwd = process.cwd(),
    mainRef = DEFAULT_MAIN_REF,
    fetchMain = true,
    execFile = execFileSync,
  } = options;
  const target = (sha ?? "").trim();
  if (!target) return [];

  if (fetchMain) {
    try {
      execFile("git", ["fetch", "--quiet", "origin", "main"], { cwd, stdio: "ignore" });
    } catch {
      // Best-effort; local origin/main may still be usable.
    }
  }

  try {
    const output = execFile(
      "git",
      ["rev-list", "--first-parent", `${target}..${mainRef}`],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return parseDescendantRevList(output);
  } catch {
    return [];
  }
}

/**
 * When Railway starts a newer main deploy, older SHAs often stay at pending
 * forever. Treat a descendant success as completion for the superseded commit.
 */
export async function findSupersedingSuccessfulDeploy(options = {}) {
  const {
    sha,
    context = DEFAULT_CONTEXT,
    listDescendants = listMainDescendantsAfter,
    fetchStatusesForSha,
  } = options;

  const descendants = listDescendants(sha);
  for (const descendantSha of descendants) {
    const statuses = await fetchStatusesForSha(descendantSha);
    const latest = latestStatusForContext(statuses, context);
    if (classifyRailwayStatus(latest) === "done") {
      return { supersededBy: descendantSha, status: latest };
    }
  }
  return null;
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
  let lastLatestStatus = null;

  while (now() <= deadline) {
    attempt += 1;
    const statuses = await fetchStatuses({ ...repo, sha, token, fetchImpl });
    const latest = latestStatusForContext(statuses, context);
    lastLatestStatus = latest;
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

    const supersession = await findSupersedingSuccessfulDeploy({
      sha,
      context,
      listDescendants: options.listDescendants ?? listMainDescendantsAfter,
      fetchStatusesForSha: (targetSha) =>
        fetchStatuses({ ...repo, sha: targetSha, token, fetchImpl }),
    });
    if (supersession) {
      return {
        ok: true,
        attempts: attempt,
        status: supersession.status,
        supersededBy: supersession.supersededBy,
        reason: "railway-status-superseded",
      };
    }

    if (now() + intervalSeconds * 1000 > deadline) break;
    await sleepImpl(intervalSeconds * 1000);
  }

  return {
    ok: false,
    attempts: attempt,
    reason: "railway-status-timeout",
    status: lastLatestStatus,
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
    if (result.reason === "railway-status-superseded") {
      process.stdout.write(
        `Railway deploy for ${sha} superseded by successful deploy on ${result.supersededBy}${url ? ` (${url})` : ""}\n`,
      );
    } else {
      process.stdout.write(`Railway deploy success for ${sha}${url ? ` (${url})` : ""}\n`);
    }
    process.exit(0);
  }

  if (result.reason === "railway-status-failed") {
    const description = result.status?.description ?? "deploy failed";
    const url = result.status?.target_url ?? "";
    console.error(`FAIL: Railway deploy failed for ${sha}: ${description}${url ? ` — ${url}` : ""}`);
    process.exit(1);
  }

  const publicStatus = await fetchRailwayPublicStatusReport();
  for (const line of formatRailwayPublicStatusReport(publicStatus)) {
    console.error(line);
  }
  console.error(railwayTimeoutHeadline(sha, result.status));
  process.exit(1);
}

if (process.argv[1]?.endsWith("wait-for-railway-deploy.mjs")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
