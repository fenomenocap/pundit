#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-}"
case "$TARGET" in
  api)
    PATHS=(packages/api package.json pnpm-lock.yaml pnpm-workspace.yaml .node-version .nvmrc railway.toml)
    ;;
  web)
    PATHS=(packages/web packages/shared package.json pnpm-lock.yaml pnpm-workspace.yaml .node-version .nvmrc scripts/vercel-ignore-build.mjs)
    ;;
  *)
    echo "usage: $0 api|web" >&2
    exit 2
    ;;
esac

git log -1 --format=%H -- "${PATHS[@]}"
