import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { shouldBuildWeb } from "./deploy-build-paths.mjs";

const helper = path.resolve("scripts/resolve-deployed-sha.sh");

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function write(cwd, relative, content) {
  const target = path.join(cwd, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function initRepo(cwd) {
  git(cwd, "init", "-q", "-b", "main");
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "config", "user.name", "Test");
  write(cwd, "package.json", "{}");
  write(cwd, "scripts/vercel-ignore-build.mjs", "export {};");
}

function withRepo(run) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pundit-deployed-sha-"));
  try {
    run(cwd);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

function seedRepo(cwd) {
  initRepo(cwd);
  write(cwd, "packages/api/src.ts", "api-0");
  write(cwd, "packages/web/page.tsx", "web-0");
  git(cwd, "add", ".");
  git(cwd, "commit", "-qm", "seed");
  return git(cwd, "rev-parse", "HEAD");
}

function commitFiles(cwd, message, files) {
  for (const [relative, content] of Object.entries(files)) write(cwd, relative, content);
  git(cwd, "add", ".");
  git(cwd, "commit", "-qm", message);
  return git(cwd, "rev-parse", "HEAD");
}

function resolve(cwd, target) {
  return execFileSync("bash", [helper, target], { cwd, encoding: "utf8" }).trim();
}

function compare(cwd, floor, served) {
  return execFileSync(
    "bash",
    [helper, "compare", "--floor", floor, "--served", served],
    { cwd, encoding: "utf8" }
  ).trim();
}

test("docs-only commits retain the latest deployed API and web path SHAs", () => {
  withRepo((cwd) => {
    initRepo(cwd);
    write(cwd, "packages/api/src.ts", "api-1");
    write(cwd, "packages/web/page.tsx", "web-1");
    git(cwd, "add", ".");
    git(cwd, "commit", "-qm", "deploy inputs");
    const deployed = git(cwd, "rev-parse", "HEAD");
    write(cwd, "docs/readme.md", "docs only");
    git(cwd, "add", ".");
    git(cwd, "commit", "-qm", "docs only");
    assert.notEqual(git(cwd, "rev-parse", "HEAD"), deployed);
    assert.equal(resolve(cwd, "api"), deployed);
    assert.equal(resolve(cwd, "web"), deployed);
  });
});

test("merge commits on main resolve to the platform merge SHA, not the PR tip", () => {
  withRepo((cwd) => {
    initRepo(cwd);
    write(cwd, "packages/api/src.ts", "api-base");
    write(cwd, "packages/web/page.tsx", "web-base");
    git(cwd, "add", ".");
    git(cwd, "commit", "-qm", "base deploy inputs");
    git(cwd, "checkout", "-q", "-b", "feature/api-change");
    write(cwd, "packages/api/src.ts", "api-2");
    git(cwd, "add", "packages/api/src.ts");
    git(cwd, "commit", "-qm", "api change on branch");
    const branchTip = git(cwd, "rev-parse", "HEAD");
    git(cwd, "checkout", "-q", "main");
    git(cwd, "merge", "--no-ff", "-qm", "Merge pull request #1 from feature/api-change", "feature/api-change");
    const mergeSha = git(cwd, "rev-parse", "HEAD");
    assert.notEqual(branchTip, mergeSha);
    assert.equal(resolve(cwd, "api"), mergeSha);
    assert.equal(resolve(cwd, "web"), git(cwd, "rev-parse", "HEAD~1"));
  });
});

test("unrelated merge commits that do not advance deploy paths keep the prior SHA", () => {
  withRepo((cwd) => {
    initRepo(cwd);
    write(cwd, "packages/api/src.ts", "api-base");
    write(cwd, "packages/web/page.tsx", "web-base");
    git(cwd, "add", ".");
    git(cwd, "commit", "-qm", "deploy inputs");
    const deployed = git(cwd, "rev-parse", "HEAD");
    git(cwd, "checkout", "-q", "-b", "feature/docs-only");
    write(cwd, "docs/readme.md", "docs on branch");
    git(cwd, "add", "docs/readme.md");
    git(cwd, "commit", "-qm", "docs on branch");
    git(cwd, "checkout", "-q", "main");
    git(cwd, "merge", "--no-ff", "-qm", "Merge pull request #2 from feature/docs-only", "feature/docs-only");
    assert.notEqual(git(cwd, "rev-parse", "HEAD"), deployed);
    assert.equal(resolve(cwd, "api"), deployed);
    assert.equal(resolve(cwd, "web"), deployed);
  });
});

// --- The shape that broke Verify Production -------------------------------
//
// A web-touching commit lands, then a long run of API-only commits. Vercel
// skips the web build for each of those, so the frontend keeps serving an
// older commit than main's tip -- correctly. But Vercel also fails open to a
// build whenever the commit range is unusable, so it can equally end up
// serving one of those *later* API-only commits. Both are healthy. Only
// serving something older than the last commit that had to rebuild the web is
// a fault, and that is what the resolved SHA is a floor for.

test("a run of API-only commits leaves the web floor on the last web commit", () => {
  withRepo((cwd) => {
    seedRepo(cwd);
    const webCommit = commitFiles(cwd, "web change", {
      "packages/web/page.tsx": "web-1",
      "packages/api/src.ts": "api-1",
    });
    let lastApi = webCommit;
    for (let index = 0; index < 6; index += 1) {
      lastApi = commitFiles(cwd, `api only ${index}`, {
        "packages/api/src.ts": `api-only-${index}`,
        "evals/chat/scenarios.json": `[${index}]`,
      });
    }
    assert.equal(resolve(cwd, "web"), webCommit);
    assert.equal(resolve(cwd, "api"), lastApi);
  });
});

test("a web-touching commit becomes the web floor immediately", () => {
  withRepo((cwd) => {
    seedRepo(cwd);
    const apiCommit = commitFiles(cwd, "api only", { "packages/api/src.ts": "api-1" });
    const webCommit = commitFiles(cwd, "web only", { "packages/web/page.tsx": "web-1" });
    assert.equal(resolve(cwd, "web"), webCommit);
    // A web-only commit does not move the API floor.
    assert.equal(resolve(cwd, "api"), apiCommit);
  });
});

test("a mixed commit is the floor for both targets", () => {
  withRepo((cwd) => {
    seedRepo(cwd);
    const mixed = commitFiles(cwd, "api and web", {
      "packages/api/src.ts": "api-2",
      "packages/web/page.tsx": "web-2",
    });
    commitFiles(cwd, "docs only", { "docs/readme.md": "docs" });
    assert.equal(resolve(cwd, "web"), mixed);
    assert.equal(resolve(cwd, "api"), mixed);
  });
});

test("root-level toolchain changes rebuild both targets", () => {
  withRepo((cwd) => {
    seedRepo(cwd);
    const lockfile = commitFiles(cwd, "bump lockfile", { "pnpm-lock.yaml": "lockfileVersion: 9" });
    assert.equal(resolve(cwd, "web"), lockfile);
    assert.equal(resolve(cwd, "api"), lockfile);
  });
});

test("changing the shared build-path rule rebuilds the web", () => {
  withRepo((cwd) => {
    seedRepo(cwd);
    const ruleChange = commitFiles(cwd, "edit the rule", {
      "scripts/deploy-build-paths.mjs": "export const WEB_BUILD_PATHS = [];",
    });
    assert.equal(resolve(cwd, "web"), ruleChange);
  });
});

test("a later skipped commit served by the frontend is ahead, not stale", () => {
  withRepo((cwd) => {
    const seed = seedRepo(cwd);
    const webCommit = commitFiles(cwd, "web change", { "packages/web/page.tsx": "web-1" });
    const apiCommits = [];
    for (let index = 0; index < 11; index += 1) {
      apiCommits.push(commitFiles(cwd, `api only ${index}`, {
        "packages/api/src.ts": `api-only-${index}`,
      }));
    }
    const floor = resolve(cwd, "web");
    assert.equal(floor, webCommit);

    // Exactly the production symptom: Vercel built an API-only commit that the
    // diff rule alone would have skipped, so the served SHA is newer than the
    // floor. That must pass.
    assert.equal(compare(cwd, floor, apiCommits.at(-1)), "ahead");
    assert.equal(compare(cwd, floor, floor), "match");
    assert.equal(compare(cwd, floor, floor.slice(0, 7)), "match");

    // The failures the check exists for.
    assert.equal(compare(cwd, floor, seed), "stale");
    assert.equal(compare(cwd, floor, ""), "missing");
    assert.equal(compare(cwd, floor, "unknown"), "missing");
    assert.equal(compare(cwd, floor, "0".repeat(40)), "unknown");
  });
});

test("the resolver agrees with the Vercel ignore-build rule commit for commit", () => {
  withRepo((cwd) => {
    seedRepo(cwd);
    commitFiles(cwd, "web change", { "packages/web/page.tsx": "web-1" });
    commitFiles(cwd, "api only", { "packages/api/src.ts": "api-1" });
    commitFiles(cwd, "docs only", { "docs/readme.md": "docs" });

    // Independently replay the ignore rule over first-parent history: the
    // newest commit it would have built must be the resolver's answer.
    const history = git(cwd, "log", "main", "--first-parent", "--format=%H").split("\n");
    let expected = null;
    for (const sha of history) {
      const changed = git(cwd, "show", "--name-only", "--format=", sha)
        .split("\n").map((line) => line.trim()).filter(Boolean);
      if (shouldBuildWeb(changed)) {
        expected = sha;
        break;
      }
    }
    assert.equal(resolve(cwd, "web"), expected);
  });
});
