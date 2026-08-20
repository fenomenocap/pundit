#!/usr/bin/env node

/**
 * Resolve the commit a deploy target is *required* to have reached, and grade
 * what it actually serves against that requirement.
 *
 * The rule is the one in deploy-build-paths.mjs -- the same predicate
 * vercel-ignore-build.mjs hands to Vercel. Walking main's first-parent history
 * and diffing each commit against its first parent reproduces exactly what the
 * ignore step sees: for a direct commit, its own change; for a merge, the whole
 * set the branch brought onto main (which is the commit the platforms stamp).
 * The first commit that would NOT be skipped is the floor.
 *
 * A floor, not an equality. Both platforms build more often than the diff rule
 * strictly demands -- Vercel fails open to a build when the commit range is
 * unusable, Railway redeploys on causes outside its watchPatterns, and either
 * can be redeployed by hand. Those pushes move the served SHA *forward*, which
 * is never a deploy fault. Serving something *older* than the floor is.
 *
 * Usage:
 *   resolve-deployed-sha.mjs api|web [--ref <ref>]
 *   resolve-deployed-sha.mjs compare --floor <sha> --served <sha>
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { BUILD_TARGETS, shouldBuild } from "./deploy-build-paths.mjs";

// Git operations run against the working directory, so the resolver can be
// pointed at any clone (the tests build throwaway repositories).
const DEFAULT_CWD = () => process.cwd();

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function gitOk(args, cwd) {
  try {
    git(args, cwd);
    return true;
  } catch {
    return false;
  }
}

/**
 * The branch the platforms deploy from. DEPLOY_REF overrides for one-off
 * checks; otherwise prefer main, then origin/main, then whatever is checked out.
 */
export function resolveRef(cwd = DEFAULT_CWD(), env = process.env) {
  const candidates = [env.DEPLOY_REF, "main", "origin/main", "HEAD"];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (gitOk(["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`], cwd)) {
      return candidate;
    }
  }
  return "HEAD";
}

function changedInCommit(sha, cwd) {
  return git(["diff", "--name-only", `${sha}^1`, sha, "--"], cwd)
    .split("\n")
    .map((file) => file.trim())
    .filter(Boolean);
}

/**
 * Newest first-parent commit on the deploy ref that the ignore-build rule would
 * NOT have skipped for this target.
 */
export function resolveDeployedSha(target, options = {}) {
  const patterns = BUILD_TARGETS[target];
  if (!patterns) throw new Error(`unknown deploy target: ${target}`);
  const cwd = options.cwd ?? DEFAULT_CWD();
  const ref = options.ref ?? resolveRef(cwd, options.env ?? process.env);

  const history = git(["log", ref, "--first-parent", "--format=%H %P"], cwd)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  let oldest = null;
  for (const line of history) {
    const [sha, ...parents] = line.split(/\s+/);
    oldest = sha;
    // The root commit has no parent to diff against; it created every input.
    if (parents.length === 0) return sha;
    if (shouldBuild(patterns, changedInCommit(sha, cwd))) return sha;
  }
  return oldest;
}

/**
 * Grade a served SHA against a floor:
 *   match   - exactly the floor (or an unambiguous prefix of it)
 *   ahead   - a descendant of the floor: a later build, not a stale deploy
 *   stale   - a real fault: the deploy never reached the commit it had to
 *   unknown - served a commit this clone has never seen
 *   missing - served no SHA at all
 */
export function classifyServedSha(floor, served, options = {}) {
  const cwd = options.cwd ?? DEFAULT_CWD();
  const servedSha = (served ?? "").trim();
  const floorSha = (floor ?? "").trim();
  if (!servedSha || servedSha === "unknown") return "missing";
  if (!floorSha) return "unknown";
  if (servedSha === floorSha
      || floorSha.startsWith(servedSha)
      || servedSha.startsWith(floorSha)) {
    return "match";
  }
  if (!gitOk(["rev-parse", "--verify", "--quiet", `${servedSha}^{commit}`], cwd)) {
    return "unknown";
  }
  return gitOk(["merge-base", "--is-ancestor", floorSha, servedSha], cwd) ? "ahead" : "stale";
}

export function isAcceptableServedSha(state) {
  return state === "match" || state === "ahead";
}

function usage() {
  console.error("usage: resolve-deployed-sha.mjs api|web [--ref <ref>]");
  console.error("       resolve-deployed-sha.mjs compare --floor <sha> --served <sha>");
  process.exit(2);
}

function flag(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (command === "compare") {
    const floor = flag(argv, "--floor");
    const served = flag(argv, "--served");
    if (!floor) usage();
    console.log(classifyServedSha(floor, served));
    process.exit(0);
  }

  if (command !== "api" && command !== "web") usage();
  console.log(resolveDeployedSha(command, { ref: flag(argv, "--ref") }));
}
