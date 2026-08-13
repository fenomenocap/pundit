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

test("docs-only commits retain the latest deployed API and web path SHAs", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pundit-deployed-sha-"));
  try {
    git(cwd, "init", "-q");
    git(cwd, "config", "user.email", "test@example.com");
    git(cwd, "config", "user.name", "Test");
    write(cwd, "packages/api/src.ts", "api-1");
    write(cwd, "packages/web/page.tsx", "web-1");
    write(cwd, "scripts/vercel-ignore-build.mjs", "export {};");
    write(cwd, "package.json", "{}");
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
