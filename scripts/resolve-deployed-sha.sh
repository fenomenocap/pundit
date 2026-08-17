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

# Last commit that actually changed the deploy watch set.
LEAF=$(git log -1 --format=%H -- "${PATHS[@]}")

resolve_ref() {
  local ref="${DEPLOY_REF:-}"
  if [[ -n "$ref" ]] && git rev-parse --verify "$ref" >/dev/null 2>&1; then
    printf '%s' "$ref"
    return
  fi
  for candidate in main origin/main HEAD; do
    if git rev-parse --verify "$candidate" >/dev/null 2>&1; then
      printf '%s' "$candidate"
      return
    fi
  done
  printf '%s' "HEAD"
}

path_tip_at() {
  git log -1 --format=%H "$1" -- "${PATHS[@]}"
}

is_merge_commit() {
  [[ "$(git rev-list --parents -n 1 "$1" | awk '{print NF - 1}')" -ge 2 ]]
}

REF=$(resolve_ref)

# Railway and Vercel stamp the merge commit that landed on main, not the PR
# branch tip. Walk main's first-parent history and return the youngest commit
# whose deploy watch set still resolves to LEAF:
#   - a direct commit on main (LEAF itself), or
#   - a merge commit whose first parent had not yet picked up LEAF.
while IFS= read -r commit; do
  [[ "$(path_tip_at "$commit")" == "$LEAF" ]] || continue
  if [[ "$commit" == "$LEAF" ]]; then
    printf '%s\n' "$commit"
    exit 0
  fi
  if is_merge_commit "$commit"; then
    first_parent="${commit}^1"
    if [[ "$(path_tip_at "$first_parent")" != "$LEAF" ]]; then
      printf '%s\n' "$commit"
      exit 0
    fi
  fi
done < <(git log "$REF" --first-parent --format=%H)

printf '%s\n' "$LEAF"
