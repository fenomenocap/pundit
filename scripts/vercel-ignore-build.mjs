#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { shouldBuildWeb } from "./deploy-build-paths.mjs";

// The path list lives in deploy-build-paths.mjs so the deploy-SHA resolver
// applies the identical rule. Re-exported for the existing tests and callers.
export { shouldBuildWeb };

export function changedPathsBetween(previousSha, commitSha, cwd) {
  if (!previousSha || !commitSha) return null;
  try {
    return execFileSync(
      "git",
      ["diff", "--name-only", previousSha, commitSha, "--"],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    ).split("\n").map((file) => file.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

export function decideIgnoredBuild(env = process.env) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const changedPaths = changedPathsBetween(
    env.VERCEL_GIT_PREVIOUS_SHA,
    env.VERCEL_GIT_COMMIT_SHA,
    repoRoot
  );

  // Missing or unusable Git metadata must build, never silently skip. This
  // branch is why the served frontend SHA can legitimately be *newer* than the
  // newest web-touching commit: Vercel builds a commit the diff rule alone
  // would have skipped. verify-prod.sh therefore treats the resolved SHA as a
  // floor, not an equality.
  if (changedPaths === null) return { build: true, reason: "commit range unavailable" };
  if (shouldBuildWeb(changedPaths)) return { build: true, reason: "web/shared input changed" };
  return { build: false, reason: "only API, corpus, or documentation changed" };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const decision = decideIgnoredBuild();
  console.log(`${decision.build ? "BUILD" : "SKIP"}: ${decision.reason}`);
  process.exit(decision.build ? 1 : 0);
}
