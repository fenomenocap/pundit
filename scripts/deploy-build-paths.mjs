/**
 * Single source of truth for "does this change rebuild a deploy target?".
 *
 * Two tools need the same answer and used to carry their own copy of the list:
 * vercel-ignore-build.mjs (regexes) decided whether Vercel builds the web app,
 * and resolve-deployed-sha.sh (git pathspecs) decided which commit the deploy
 * check expects to be served. Two encodings of one rule drift silently, and the
 * drift only shows up as a red Verify Production run days later. Both now
 * import these predicates instead.
 */

const ROOT_TOOLCHAIN_PATHS = [
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^\.node-version$/,
  /^\.nvmrc$/,
  // Local dependency source is installed from the repository at build time.
  /^vendor\/brace-patterns\//,
];

/** Inputs to the Vercel frontend build, mirroring vercel-ignore-build.mjs. */
export const WEB_BUILD_PATHS = [
  /^packages\/web\//,
  /^packages\/shared\//,
  ...ROOT_TOOLCHAIN_PATHS,
  // The ignore rule decides its own future: changing it must produce a build.
  /^scripts\/vercel-ignore-build\.mjs$/,
  /^scripts\/vercel-ignore\.sh$/,
  /^scripts\/deploy-build-paths\.mjs$/,
];

/** Inputs to the Railway API build, mirroring railway.toml's watchPatterns. */
export const API_BUILD_PATHS = [
  /^packages\/api\//,
  ...ROOT_TOOLCHAIN_PATHS,
  /^railway\.toml$/,
];

/** railway.toml watchPatterns for the API service (must stay aligned with API_BUILD_PATHS). */
export const API_WATCH_PATTERNS = [
  "/packages/api/**",
  "/railway.toml",
  "/package.json",
  "/pnpm-lock.yaml",
  "/pnpm-workspace.yaml",
  "/vendor/brace-patterns/**",
  "/.node-version",
  "/.nvmrc",
];

export const BUILD_TARGETS = {
  api: API_BUILD_PATHS,
  web: WEB_BUILD_PATHS,
};

/** True when any changed path is an input to the given target's build. */
export function shouldBuild(patterns, changedPaths) {
  return changedPaths.some((file) => patterns.some((pattern) => pattern.test(file)));
}

export function shouldBuildWeb(changedPaths) {
  return shouldBuild(WEB_BUILD_PATHS, changedPaths);
}

export function shouldBuildApi(changedPaths) {
  return shouldBuild(API_BUILD_PATHS, changedPaths);
}
