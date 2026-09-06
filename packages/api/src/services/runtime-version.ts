export interface RuntimeVersion {
  sha: string;
  /** Railway deployment UUID when the process is running on Railway. */
  deploymentId: string | null;
}

const SHA_ENV_KEYS = [
  // Platform metadata must win over a manually configured fallback so a
  // completed Railway deployment reports the exact source artifact it serves.
  "RAILWAY_GIT_COMMIT_SHA",
  "VERCEL_GIT_COMMIT_SHA",
  "GITHUB_SHA",
  "BUILD_SHA",
] as const;

function railwayDeploymentId(env: NodeJS.ProcessEnv): string | null {
  const value = env.RAILWAY_DEPLOYMENT_ID?.trim();
  return value || null;
}

export function getRuntimeVersion(
  env: NodeJS.ProcessEnv = process.env
): RuntimeVersion {
  const deploymentId = railwayDeploymentId(env);
  for (const key of SHA_ENV_KEYS) {
    const value = env[key]?.trim();
    if (value) return { sha: value, deploymentId };
  }
  return { sha: "unknown", deploymentId };
}
