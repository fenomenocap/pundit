import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

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

test("docs-only commits retain the latest deployed API and web path SHAs", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pundit-deployed-sha-"));
  try {
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
    assert.equal(execFileSync("bash", [helper, "api"], { cwd, encoding: "utf8" }).trim(), deployed);
    assert.equal(execFileSync("bash", [helper, "web"], { cwd, encoding: "utf8" }).trim(), deployed);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("merge commits on main resolve to the platform merge SHA, not the PR tip", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pundit-deployed-sha-"));
  try {
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
    assert.equal(execFileSync("bash", [helper, "api"], { cwd, encoding: "utf8" }).trim(), mergeSha);
    assert.equal(execFileSync("bash", [helper, "web"], { cwd, encoding: "utf8" }).trim(), git(cwd, "rev-parse", "HEAD~1"));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("unrelated merge commits that do not advance deploy paths keep the prior SHA", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pundit-deployed-sha-"));
  try {
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
    assert.equal(execFileSync("bash", [helper, "api"], { cwd, encoding: "utf8" }).trim(), deployed);
    assert.equal(execFileSync("bash", [helper, "web"], { cwd, encoding: "utf8" }).trim(), deployed);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
