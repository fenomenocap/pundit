#!/usr/bin/env bash
# SSH forced-command entrypoint for the deploy key. Installed on the droplet as
# /opt/pundit-deploy/deploy.sh and referenced from authorized_keys:
#   command="/opt/pundit-deploy/deploy.sh",restrict ssh-ed25519 AAAA... deploy-key
# Whatever the client asks to run arrives in $SSH_ORIGINAL_COMMAND and is only
# ever parsed, never executed. Accepted forms:
#   <40-hex sha>            deploy exactly that commit
#   deploy <40-hex sha>     same
#   deploy                  origin/main tip; only while ALLOW_TIP_DEPLOY=1
# Anything else is refused with exit 2. swap.sh then fetches and refuses a sha
# that is not origin/main or an ancestor of it (exit 3).
# Run by hand on the droplet: /opt/pundit-deploy/deploy.sh <sha>
set -euo pipefail

SWAP_CONF="${SWAP_CONF:-/opt/pundit-deploy/swap.conf}"
if [[ -f "$SWAP_CONF" ]]; then
  # shellcheck source=/dev/null
  source "$SWAP_CONF"
fi
SWAP_BIN="${SWAP_BIN:-/opt/pundit-deploy/bin/swap.sh}"
ALLOW_TIP_DEPLOY="${ALLOW_TIP_DEPLOY:-1}"

if [[ -n "${SSH_ORIGINAL_COMMAND+x}" ]]; then
  request="$SSH_ORIGINAL_COMMAND"
else
  request="$*"
fi

refuse() {
  printf 'deploy.sh: refused: %s\n' "$1" >&2
  logger -t pundit-deploy "refused: $1" 2>/dev/null || true
  exit 2
}

# Reject anything outside [a-z0-9 ] before matching, so control characters,
# quotes, ;, $, | etc. never reach a regex or a log line unescaped.
[[ "$request" =~ ^[a-z0-9\ ]{0,60}$ ]] || refuse "unexpected characters in request"

if [[ "$request" =~ ^(deploy\ )?([0-9a-f]{40})$ ]]; then
  sha="${BASH_REMATCH[2]}"
  logger -t pundit-deploy "deploy ${sha}" 2>/dev/null || true
  exec "$SWAP_BIN" "$sha"
elif [[ "$request" == deploy ]]; then
  [[ "$ALLOW_TIP_DEPLOY" == 1 ]] || refuse "branch-tip deploy disabled; send a 40-hex sha"
  logger -t pundit-deploy "deploy origin/main tip (legacy)" 2>/dev/null || true
  exec "$SWAP_BIN"
else
  refuse "expected '<40-hex sha>' or 'deploy <40-hex sha>'"
fi
