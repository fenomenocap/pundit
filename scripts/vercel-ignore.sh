#!/usr/bin/env bash
# ignoreCommand for the Vercel project rooted at packages/web.
# Exit 0 skips the deployment. Exit 1 builds.
# Builds only on main, and only when a web/shared input changed.
# A missing or unknown previous SHA fails open to a build on main only.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

MODULE="$ROOT/scripts/vercel-ignore-build.mjs" \
REPO="$REPO" \
node --input-type=module -e '
import { pathToFileURL } from "node:url";
const { decideIgnoredBuild } = await import(pathToFileURL(process.env.MODULE).href);
const decision = decideIgnoredBuild(process.env, process.env.REPO);
console.log(`${decision.build ? "BUILD" : "SKIP"}: ${decision.reason}`);
process.exit(decision.build ? 1 : 0);
'
