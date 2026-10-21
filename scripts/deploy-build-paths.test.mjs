import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import {
  API_BUILD_PATHS,
  API_WATCH_PATTERNS,
  shouldBuildApi,
} from "./deploy-build-paths.mjs";

function parseWatchPatternsFromToml(relativePath) {
  const text = fs.readFileSync(path.resolve(relativePath), "utf8");
  const match = text.match(/watchPatterns\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(match, `watchPatterns block missing in ${relativePath}`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((row) => row[1]);
}

function watchPatternMatchesPath(watchPattern, filePath) {
  const normalized = watchPattern.startsWith("/") ? watchPattern.slice(1) : watchPattern;
  if (normalized.endsWith("/**")) {
    const prefix = normalized.slice(0, -3);
    return filePath === prefix || filePath.startsWith(`${prefix}/`);
  }
  return filePath === normalized;
}

test("API watchPatterns in both railway.toml files match API_WATCH_PATTERNS", () => {
  for (const filename of ["railway.toml", "packages/api/railway.toml"]) {
    const patterns = parseWatchPatternsFromToml(filename);
    assert.deepEqual(patterns, API_WATCH_PATTERNS);
  }
});

test("API_WATCH_PATTERNS stay aligned with API_BUILD_PATHS", () => {
  const samples = [
    "packages/api/src/index.ts",
    "railway.toml",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "vendor/brace-patterns/lib/compile.js",
    ".node-version",
    ".nvmrc",
    "docs/readme.md",
  ];

  for (const file of samples) {
    const fromRegex = shouldBuildApi([file]);
    const fromWatch = API_WATCH_PATTERNS.some((pattern) => watchPatternMatchesPath(pattern, file));
    assert.equal(fromWatch, fromRegex, `build decision mismatch for ${file}`);
  }

  for (const pattern of API_BUILD_PATHS) {
    const probe = pattern.source.includes("packages\\/api")
      ? "packages/api/probe.ts"
      : pattern.source.includes("brace-patterns")
        ? "vendor/brace-patterns/probe.js"
        : pattern.source.replace(/^\^/, "").replace(/\$$/, "").replace(/\\\./g, ".");
    assert.ok(
      API_WATCH_PATTERNS.some((watch) => watchPatternMatchesPath(watch, probe)),
      `no watchPattern covers ${pattern}`,
    );
  }
});
