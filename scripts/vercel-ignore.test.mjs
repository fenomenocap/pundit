import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const script = path.resolve("scripts/vercel-ignore.sh");

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function write(cwd, relative, content) {
  const target = path.join(cwd, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function commit(cwd, message, files) {
  for (const [relative, content] of Object.entries(files)) write(cwd, relative, content);
  git(cwd, "add", ".");
  git(cwd, "commit", "-qm", message);
  return git(cwd, "rev-parse", "HEAD");
}

function initRepo(cwd) {
  git(cwd, "init", "-q", "-b", "main");
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "config", "user.name", "Test");
  return commit(cwd, "base", { "packages/api/src/index.ts": "api" });
}

function run(cwd, env) {
  try {
    const stdout = execFileSync("bash", [script], {
      cwd,
      env: { PATH: process.env.PATH, HOME: process.env.HOME ?? "", ...env },
      encoding: "utf8",
    });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.status ?? 1, stdout: String(error.stdout ?? "") };
  }
}

test("main + web change builds", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "vercel-ignore-"));
  try {
    const previous = initRepo(cwd);
    const current = commit(cwd, "web", { "packages/web/src/app/page.tsx": "web" });
    const result = run(cwd, {
      VERCEL_GIT_COMMIT_REF: "main",
      VERCEL_GIT_PREVIOUS_SHA: previous,
      VERCEL_GIT_COMMIT_SHA: current,
    });
    assert.equal(result.code, 1, result.stdout);
    assert.match(result.stdout, /BUILD: web\/shared input changed/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("main + api-only change skips", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "vercel-ignore-"));
  try {
    const previous = initRepo(cwd);
    const current = commit(cwd, "api", { "packages/api/src/index.ts": "api-2" });
    const result = run(cwd, {
      VERCEL_GIT_COMMIT_REF: "main",
      VERCEL_GIT_PREVIOUS_SHA: previous,
      VERCEL_GIT_COMMIT_SHA: current,
    });
    assert.equal(result.code, 0, result.stdout);
    assert.match(result.stdout, /SKIP: only API, corpus, or documentation changed/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("PR branch + web change skips", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "vercel-ignore-"));
  try {
    const previous = initRepo(cwd);
    const current = commit(cwd, "web", { "packages/web/src/app/page.tsx": "web" });
    const result = run(cwd, {
      VERCEL_GIT_COMMIT_REF: "cursor/some-preview-9cae",
      VERCEL_GIT_PREVIOUS_SHA: previous,
      VERCEL_GIT_COMMIT_SHA: current,
    });
    assert.equal(result.code, 0, result.stdout);
    assert.match(result.stdout, /SKIP: ref is not main/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("missing previous SHA on main builds", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "vercel-ignore-"));
  try {
    const current = initRepo(cwd);
    const result = run(cwd, {
      VERCEL_GIT_COMMIT_REF: "main",
      VERCEL_GIT_COMMIT_SHA: current,
    });
    assert.equal(result.code, 1, result.stdout);
    assert.match(result.stdout, /BUILD: commit range unavailable/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("unknown previous SHA on main builds", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "vercel-ignore-"));
  try {
    const current = initRepo(cwd);
    const result = run(cwd, {
      VERCEL_GIT_COMMIT_REF: "main",
      VERCEL_GIT_PREVIOUS_SHA: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      VERCEL_GIT_COMMIT_SHA: current,
    });
    assert.equal(result.code, 1, result.stdout);
    assert.match(result.stdout, /BUILD: commit range unavailable/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
