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
    ".node-version",
    ".nvmrc",
    "scripts/vercel-ignore-build.mjs",
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

test("fails safe to a build when Vercel commit metadata is unavailable", () => {
  assert.deepEqual(decideIgnoredBuild({}), {
    build: true,
    reason: "commit range unavailable",
  });
});
