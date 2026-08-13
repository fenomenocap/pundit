export interface RuntimeVersion {
  sha: string;
}

const SHA_ENV_KEYS = [
  "RAILWAY_GIT_COMMIT_SHA",
  "VERCEL_GIT_COMMIT_SHA",
  "GITHUB_SHA",
  "BUILD_SHA",
] as const;

export function getRuntimeVersion(
  env: NodeJS.ProcessEnv = process.env
): RuntimeVersion {
  for (const key of SHA_ENV_KEYS) {
    const value = env[key]?.trim();
    if (value) return { sha: value };
  }
  return { sha: "unknown" };
}
