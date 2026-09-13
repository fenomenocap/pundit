import { spawnSync } from "node:child_process";
import path from "node:path";

/**
 * Offline reviewed-release loop: capture → build → verify.
 * Runtime model code must never import this file or contact ClubElo.
 *
 * Usage (from packages/api): pnpm refresh:clubelo-snapshot
 */
const apiRoot = path.join(__dirname, "..");
const capturePath = path.join(apiRoot, "data/model-artifacts/clubelo/.capture/club-ratings.json");
const productionPath = path.join(apiRoot, "data/model-artifacts/clubelo/production.json");

function run(script: string, args: string[]): void {
  const result = spawnSync(
    "pnpm",
    ["exec", "ts-node", "--transpile-only", path.join("scripts", script), ...args],
    { cwd: apiRoot, stdio: "inherit" }
  );
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("[refresh] Capturing ClubElo snapshot (offline; not used at runtime).");
run("capture-clubelo-snapshot.ts", [capturePath]);
console.log("[refresh] Building content-addressed clubelo@1 artifact.");
run("build-club-strength-artifact.ts", [capturePath, productionPath]);
console.log("[refresh] Verifying hash, coverage, cutover lock, and 30-day gate.");
run("verify-club-strength-artifact.ts", [productionPath]);
console.log(JSON.stringify({
  next: [
    "Review snapshotAt, ranking date, ENG/UEFA coverage, and a few active-fixture Elos.",
    "Commit the new <sha256>.json and production.json together.",
    "Deploy Railway + Vercel. Confirm /ready ratingsRefreshDue is false.",
  ],
}, null, 2));
