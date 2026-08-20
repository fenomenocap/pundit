#!/usr/bin/env bash
# Thin shim. The resolution rule lives in resolve-deployed-sha.mjs so that it
# shares one predicate module with scripts/vercel-ignore-build.mjs instead of
# re-encoding the deploy watch set as git pathspecs here.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/resolve-deployed-sha.mjs" "$@"
