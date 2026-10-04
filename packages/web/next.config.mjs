import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

// Local development only. Next reads .env files from packages/web, but the
// repo keeps one gitignored .env at the root (the API loads the same file).
// Copy its NEXT_PUBLIC_* values in before Next inlines them into the client
// bundle. Only public keys are read, so API secrets in the same file never
// enter the web process. Values already present win: shell exports, Vercel
// project env, and packages/web/.env* (which Next loads before this file).
// Vercel has no root .env, so this is a no-op there.
const rootEnvPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
if (existsSync(rootEnvPath)) {
  const parsed = parseEnv(readFileSync(rootEnvPath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (key.startsWith("NEXT_PUBLIC_") && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
  // Vercel exposes its Git SHA during the build. Embedding it here keeps the
  // version route reliable even when system Git variables are not forwarded
  // to the deployed function runtime.
  env: {
    BUILD_SHA: process.env.VERCEL_GIT_COMMIT_SHA
      || process.env.BUILD_SHA
      || "unknown",
  },
};

export default nextConfig;
