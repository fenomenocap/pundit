import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(repoRoot, "packages/api");
const ciWorkflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8");

test("API CI type-check runs tsc with emit (Railway build does not use --noEmit)", () => {
  const apiTypecheckBlock = ciWorkflow.match(
    /- name: Type-check API \(emit; matches Railway build\)[\s\S]*?run: ([^\n]+)/,
  );
  assert.ok(apiTypecheckBlock, "expected API emit type-check step in ci.yml");
  const command = apiTypecheckBlock[1].trim();
  assert.equal(command, "pnpm test:api-tsc-emit", command);
  assert.doesNotMatch(
    command,
    /--noEmit/,
    "API type-check must use emit mode (Railway build runs plain tsc)",
  );
});

test("packages/api tsc emit succeeds (matches @sports-predict/api build compile step)", () => {
  execFileSync("pnpm", ["exec", "tsc"], {
    cwd: apiDir,
    stdio: "pipe",
    env: process.env,
  });
});
