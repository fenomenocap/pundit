import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyRailwayStatus,
  fetchRailwayPublicStatusReport,
  findSupersedingSuccessfulDeploy,
  formatRailwayPublicStatusReport,
  latestIncidentStatusFromRssDescription,
  latestStatusForContext,
  listMainDescendantsAfter,
  parseDescendantRevList,
  parseOpenIncidentsFromRss,
  railwayDeployRequired,
  railwayTimeoutHeadline,
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
    listDescendants: () => [],
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

test("parseDescendantRevList trims rev-list output", () => {
  assert.deepEqual(parseDescendantRevList("abc\n\ndef\n"), ["abc", "def"]);
});

test("findSupersedingSuccessfulDeploy returns newest descendant with Railway success", async () => {
  const supersession = await findSupersedingSuccessfulDeploy({
    sha: "97fbb9e",
    context: CONTEXT,
    listDescendants: () => ["c838735", "92daae1"],
    fetchStatusesForSha: async (targetSha) => {
      if (targetSha === "92daae1") {
        return [{ context: CONTEXT, state: "success", description: "done" }];
      }
      return [{ context: CONTEXT, state: "pending" }];
    },
  });

  assert.equal(supersession?.supersededBy, "92daae1");
});

test("findSupersedingSuccessfulDeploy ignores pending descendants", async () => {
  const supersession = await findSupersedingSuccessfulDeploy({
    sha: "97fbb9e",
    context: CONTEXT,
    listDescendants: () => ["aac3da6"],
    fetchStatusesForSha: async () => [{ context: CONTEXT, state: "pending" }],
  });

  assert.equal(supersession, null);
});

test("waitForRailwayDeploy succeeds when a newer main deploy supersedes the target SHA", async () => {
  const result = await waitForRailwayDeploy({
    sha: "97fbb9e",
    context: CONTEXT,
    token: "test-token",
    repo: { owner: "fenomenocap", repo: "pundit" },
    timeoutSeconds: 30,
    intervalSeconds: 1,
    now: () => 0,
    sleepImpl: async () => {},
    listDescendants: () => ["92daae1"],
    fetchImpl: async (_url) => ({
      ok: true,
      async json() {
        const sha = _url.split("/commits/")[1]?.split("/")[0];
        if (sha === "97fbb9e") {
          return [{ context: CONTEXT, state: "pending", description: "deploying" }];
        }
        if (sha === "92daae1") {
          return [{ context: CONTEXT, state: "success", description: "done", target_url: "https://railway.example" }];
        }
        return [];
      },
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.reason, "railway-status-superseded");
  assert.equal(result.supersededBy, "92daae1");
});

test("listMainDescendantsAfter parses rev-list from injected execFile", () => {
  const calls = [];
  const descendants = listMainDescendantsAfter("aaa1111", {
    cwd: "/tmp/fake-repo",
    fetchMain: false,
    mainRef: "origin/main",
    execFile: (cmd, args) => {
      calls.push({ cmd, args });
      if (args[0] === "rev-list") {
        return "ccc3333\nbbb2222\n";
      }
      throw new Error(`unexpected git invocation: ${args.join(" ")}`);
    },
  });

  assert.deepEqual(descendants, ["ccc3333", "bbb2222"]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["rev-list", "--first-parent", "aaa1111..origin/main"]);
});

test("listMainDescendantsAfter walks first-parent history on main", () => {
  const dir = mkdtempSync(join(tmpdir(), "pundit-wait-railway-git-"));
  try {
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
    for (const msg of ["a", "b", "c", "d"]) {
      execFileSync("git", ["commit", "--allow-empty", "-m", msg], { cwd: dir });
    }

    const bSha = execFileSync("git", ["rev-parse", "HEAD~2"], { cwd: dir, encoding: "utf8" }).trim();
    const cSha = execFileSync("git", ["rev-parse", "HEAD~1"], { cwd: dir, encoding: "utf8" }).trim();
    const dSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();

    const descendants = listMainDescendantsAfter(bSha, {
      cwd: dir,
      fetchMain: false,
      mainRef: "main",
    });

    assert.ok(descendants.some((sha) => sha.startsWith(cSha.slice(0, 7))));
    assert.ok(descendants.some((sha) => sha.startsWith(dSha.slice(0, 7))));
    assert.equal(descendants[0]?.slice(0, 7), dSha.slice(0, 7));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listMainDescendantsAfter returns empty when rev-list fails", () => {
  const descendants = listMainDescendantsAfter("missing-sha", {
    cwd: "/tmp/fake-repo",
    fetchMain: false,
    mainRef: "origin/main",
    execFile: () => {
      throw new Error("unknown revision");
    },
  });
  assert.deepEqual(descendants, []);
});

test("railwayTimeoutHeadline distinguishes missing GitHub status from pending timeout", () => {
  assert.match(
    railwayTimeoutHeadline("abc123", null),
    /Railway created no deployment for abc123/,
  );
  assert.match(
    railwayTimeoutHeadline("abc123", { state: "pending" }),
    /timed out waiting for Railway GitHub status success on abc123/,
  );
});

test("parseOpenIncidentsFromRss keeps unresolved incidents only", () => {
  const xml = `<?xml version="1.0"?><rss><channel>
<item><title>Open outage</title><link>https://status.railway.com/incident/open</link>
<description>Mar 1, 10:00:00 GMT+0 - Investigating - Still broken.</description></item>
<item><title>Closed outage</title><link>https://status.railway.com/incident/closed</link>
<description>Mar 1, 11:00:00 GMT+0 - Resolved - Fixed.</description></item>
</channel></rss>`;
  const open = parseOpenIncidentsFromRss(xml);
  assert.equal(open.length, 1);
  assert.equal(open[0].title, "Open outage");
  assert.equal(open[0].latestStatus, "investigating");
  assert.equal(latestIncidentStatusFromRssDescription("Mar 1, 11:00:00 GMT+0 - Resolved - ok"), "resolved");
});

test("formatRailwayPublicStatusReport lists page status and open incidents", () => {
  const lines = formatRailwayPublicStatusReport({
    pageStatus: "HASISSUES",
    pageUrl: "https://status.railway.com",
    openIncidents: [{ title: "Build delays", link: "https://status.railway.com/incident/x", latestStatus: "monitoring" }],
    degradedComponents: [{ name: "Builds", status: "DEGRADEDPERFORMANCE" }],
    fetchErrors: [],
  });
  assert.ok(lines.some((line) => line.includes("Railway public status: HASISSUES")));
  assert.ok(lines.some((line) => line.includes("Railway open incident: Build delays")));
  assert.ok(lines.some((line) => line.includes("Railway degraded component: Builds")));
});

test("fetchRailwayPublicStatusReport uses injected fetch only", async () => {
  const urls = [];
  const report = await fetchRailwayPublicStatusReport({
    fetchImpl: async (url) => {
      urls.push(url);
      if (url.includes("summary.json")) {
        return { ok: true, async json() { return { page: { status: "UP", url: "https://status.railway.com" } }; } };
      }
      if (url.includes("components.json")) {
        return { ok: true, async json() { return { components: [{ name: "API", status: "OPERATIONAL", children: [] }] }; } };
      }
      return {
        ok: true,
        async text() {
          return `<rss><channel><item><title>Done</title><description>GMT+0 - Resolved - ok</description></item></channel></rss>`;
        },
      };
    },
  });
  assert.equal(report.pageStatus, "UP");
  assert.deepEqual(report.openIncidents, []);
  assert.equal(urls.length, 3);
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
    listDescendants: () => [],
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
  assert.equal(result.status?.state, "pending");
});
