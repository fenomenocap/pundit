import assert from "node:assert/strict";
import test from "node:test";
import { decideIgnoredBuild, shouldBuildWeb } from "./vercel-ignore-build.mjs";

test("builds web and shared-root changes", () => {
  for (const file of [
    "packages/web/src/app/page.tsx",
    "packages/shared/src/types.ts",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "vendor/brace-patterns/lib/compile.js",
    "vendor/brace-patterns/package.json",
    ".node-version",
    ".nvmrc",
    "scripts/vercel-ignore-build.mjs",
    "scripts/vercel-ignore.sh",
    // The rule module both the ignore step and the deploy-SHA resolver import.
    "scripts/deploy-build-paths.mjs",
  ]) {
    assert.equal(shouldBuildWeb([file]), true, file);
  }
});

test("skips API-only, corpus, evaluator, and documentation changes", () => {
  assert.equal(shouldBuildWeb([
    "packages/api/src/index.ts",
    "packages/api/data/research/corpus.json",
    "docs/api-reference/ask.md",
    "evals/chat/scenarios.json",
    "README.md",
  ]), false);
});

test("builds when any file in a mixed change affects the web", () => {
  assert.equal(shouldBuildWeb([
    "packages/api/src/index.ts",
    "packages/web/src/lib/api.ts",
  ]), true);
});

test("skips when the ref is not main, even with no commit metadata", () => {
  assert.deepEqual(decideIgnoredBuild({}), {
    build: false,
    reason: "ref is not main",
  });
  assert.deepEqual(decideIgnoredBuild({ VERCEL_GIT_COMMIT_REF: "chat-eval-data" }), {
    build: false,
    reason: "ref is not main",
  });
});

test("fails open to a build on main when the commit range is unavailable", () => {
  assert.deepEqual(decideIgnoredBuild({ VERCEL_GIT_COMMIT_REF: "main" }), {
    build: true,
    reason: "commit range unavailable",
  });
});
