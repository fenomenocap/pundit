#!/usr/bin/env bash
# Zero-downtime, health-gated blue/green swap for the Pundit API on the
# DigitalOcean droplet (degen-dev). See deploy/do/README.md.
#
# Usage: swap.sh [<40-hex sha>]
#   With a sha:    deploy exactly that commit (must be origin/main or an ancestor of it).
#   Without a sha: deploy the current origin/main tip (legacy behaviour).
#
# Layout (deploy/do/docker-compose.yml): compose project "pundit" runs Caddy
# (pundit-caddy-1) and, until the first swap, the API as pundit-api-1. Each
# colour is the same `api` service started as its own compose project
# (pundit-blue / pundit-green) with container name pundit-api-<colour>, joined
# to the "pundit_default" network so Caddy reaches it by container name, and
# published on 127.0.0.1:<colour port> for the health gate.
#
# Flow: checkout sha (detached) -> build pundit-api:<sha> -> start the idle
# colour -> poll its /ready -> point Caddy at it (caddy reload, graceful) ->
# confirm public /version == sha -> drain -> stop the old container. A failure
# before the switch leaves the old container serving untouched; a failure
# after it rolls Caddy back first.
#
# Non-secret settings come from $SWAP_CONF (default /opt/pundit-deploy/swap.conf).
# Env values are never read here: /opt/pundit/.env.api is referenced only by
# path, through the compose file's env_file.
set -euo pipefail

SWAP_CONF="${SWAP_CONF:-/opt/pundit-deploy/swap.conf}"
if [[ -f "$SWAP_CONF" ]]; then
  # shellcheck source=/dev/null
  source "$SWAP_CONF"
fi

# ── Settings (override in swap.conf) ─────────────────────────────────────────
REPO_DIR="${REPO_DIR:-/opt/pundit}"                         # git clone = build context
GIT_REMOTE="${GIT_REMOTE:-origin}"
GIT_BRANCH="${GIT_BRANCH:-main}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/pundit-deploy}"
COMPOSE_FILE="${COMPOSE_FILE:-$DEPLOY_DIR/docker-compose.yml}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-pundit}"                # project that runs Caddy
COMPOSE_NETWORK="${COMPOSE_NETWORK:-${COMPOSE_PROJECT}_default}"
API_SERVICE="${API_SERVICE:-api}"
API_CONTAINER_PORT="${API_CONTAINER_PORT:-3001}"
LEGACY_CONTAINER="${LEGACY_CONTAINER:-pundit-api-1}"        # pre-swap API container
CADDY_SERVICE="${CADDY_SERVICE:-caddy}"
CADDY_CONFIG="${CADDY_CONFIG:-/etc/caddy/Caddyfile}"        # path inside the Caddy container
UPSTREAM_FILE="${UPSTREAM_FILE:-$DEPLOY_DIR/caddy/upstream.caddy}"  # host path; dir is mounted at /etc/caddy
IMAGE_REPO="${IMAGE_REPO:-pundit-api}"
BLUE_PORT="${BLUE_PORT:-3101}"
GREEN_PORT="${GREEN_PORT:-3102}"
PUBLIC_URL="${PUBLIC_URL:-https://134-209-121-101.sslip.io}"
READY_TIMEOUT="${READY_TIMEOUT:-300}"     # seconds for the new container's /ready
VERIFY_TIMEOUT="${VERIFY_TIMEOUT:-60}"    # seconds for public /version to show the new sha
DRAIN_SECONDS="${DRAIN_SECONDS:-20}"      # let in-flight requests on the old container finish
STOP_TIMEOUT="${STOP_TIMEOUT:-25}"        # matches stop_grace_period in docker-compose.yml
KEEP_IMAGES="${KEEP_IMAGES:-3}"           # sha-tagged images to keep (0 = never prune)
STATE_DIR="${STATE_DIR:-$DEPLOY_DIR/state}"
LOCK_FILE="${LOCK_FILE:-$DEPLOY_DIR/deploy.lock}"
LOCK_WAIT="${LOCK_WAIT:-900}"             # queue behind a running deploy, like the old deploy.sh
LOG_FILE="${LOG_FILE:-$STATE_DIR/swap.log}"
CURL="${CURL:-curl}"

# ── Helpers ──────────────────────────────────────────────────────────────────
log() {
  local line
  line="$(date -u +%Y-%m-%dT%H:%M:%SZ) [swap] $*"
  printf '%s\n' "$line" >&2
  if [[ -n "${LOG_FILE:-}" && -d "$(dirname "$LOG_FILE")" ]]; then
    printf '%s\n' "$line" >>"$LOG_FILE" || true
  fi
}
die() { log "ERROR: $1"; exit "${2:-1}"; }

colour_port() { if [[ "$1" == blue ]]; then echo "$BLUE_PORT"; else echo "$GREEN_PORT"; fi; }
other_colour() { if [[ "$1" == blue ]]; then echo green; else echo blue; fi; }
colour_container() { echo "${IMAGE_REPO}-$1"; }   # pundit-api-blue / pundit-api-green

compose_colour() {
  local colour="$1"; shift
  docker compose -p "${COMPOSE_PROJECT}-${colour}" \
    -f "$COMPOSE_FILE" -f "$STATE_DIR/override-${colour}.yml" "$@"
}

compose_main() { docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" "$@"; }

# Prints the sha a /version body reports, or nothing.
body_sha() { sed -n 's/.*"sha":"\([0-9a-f]\{40\}\)".*/\1/p' | head -n1; }
http_code() { "$CURL" -sS -m 5 -o /dev/null -w '%{http_code}' "$1" 2>/dev/null || true; }
http_body() { "$CURL" -fsS -m 5 -H 'Cache-Control: no-cache' "$1" 2>/dev/null || true; }

container_running() { [[ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null || true)" == true ]]; }

write_upstream() {
  local tmp
  tmp="$(mktemp "${UPSTREAM_FILE}.XXXXXX")"
  printf '# Managed by deploy/do/swap.sh; do not edit by hand.\nreverse_proxy %s\n' "$1" >"$tmp"
  chmod 0644 "$tmp"
  # Same directory, so the rename is atomic and visible through the
  # directory bind mount (a single-file mount would pin the old inode).
  mv -f "$tmp" "$UPSTREAM_FILE"
}

reload_caddy() {
  log "reloading Caddy (graceful): compose exec ${CADDY_SERVICE} caddy reload --config ${CADDY_CONFIG}"
  compose_main exec -T "$CADDY_SERVICE" caddy reload --config "$CADDY_CONFIG"
}

write_override() {
  local colour="$1" sha="$2" port
  port="$(colour_port "$colour")"
  cat >"$STATE_DIR/override-${colour}.yml" <<YAML
# Generated by deploy/do/swap.sh for colour ${colour}; regenerated every deploy.
services:
  ${API_SERVICE}:
    profiles: !reset []
    image: ${IMAGE_REPO}:${sha}
    container_name: $(colour_container "$colour")
    environment:
      # runtime-version.ts reads GITHUB_SHA before BUILD_SHA; set both so
      # /version reports exactly the commit this container was built from.
      GITHUB_SHA: "${sha}"
      BUILD_SHA: "${sha}"
    ports: !override
      - "127.0.0.1:${port}:${API_CONTAINER_PORT}"
    networks: !override
      - edge
networks:
  edge:
    external: true
    name: ${COMPOSE_NETWORK}
YAML
}

running_sha_of() {
  # Prints the sha tag of a running colour container's image, or nothing.
  local name
  name="$(colour_container "$1")"
  container_running "$name" || return 0
  docker inspect -f '{{.Config.Image}}' "$name" 2>/dev/null | sed -n "s/^${IMAGE_REPO}:\([0-9a-f]\{40\}\)$/\1/p"
}

# ── Preconditions ────────────────────────────────────────────────────────────
TARGET_ARG="${1:-}"
if [[ $# -gt 1 ]]; then die "usage: swap.sh [<40-hex sha>]" 2; fi
if [[ -n "$TARGET_ARG" && ! "$TARGET_ARG" =~ ^[0-9a-f]{40}$ ]]; then
  die "refusing target '${TARGET_ARG}': must be a full 40-char lowercase hex sha" 2
fi
for bin in docker git flock "$CURL"; do
  command -v "$bin" >/dev/null 2>&1 || die "missing required command: $bin" 2
done
[[ -f "$COMPOSE_FILE" ]] || die "compose file not found: $COMPOSE_FILE" 2
[[ -d "$REPO_DIR/.git" ]] || die "not a git checkout: $REPO_DIR" 2
# The one-time setup seeds this with the pre-swap upstream, so a failed first
# swap can roll Caddy back (deploy/do/README.md, "One-time setup").
[[ -f "$UPSTREAM_FILE" ]] || die "Caddy upstream file not found: $UPSTREAM_FILE (one-time setup missing)" 2
mkdir -p "$STATE_DIR"

# `!override` / `!reset` in override files need Compose >= 2.24.4.
compose_version="$(docker compose version --short 2>/dev/null | sed 's/^v//')"
if ! printf '%s\n%s\n' "2.24.4" "$compose_version" | sort -V -C; then
  die "docker compose ${compose_version:-unknown} too old; need >= 2.24.4" 2
fi

# One deploy at a time: queue behind a running one (deploy-do.yml also
# serialises; this guards manual runs).
exec 9>"$LOCK_FILE"
log "waiting for deploy lock $LOCK_FILE"
flock -w "$LOCK_WAIT" 9 || die "another deploy held $LOCK_FILE for ${LOCK_WAIT}s"

# ── 1. Resolve and check out the target sha ─────────────────────────────────
log "step 1/6: fetching ${GIT_REMOTE}/${GIT_BRANCH} in $REPO_DIR"
git -C "$REPO_DIR" fetch --quiet --prune "$GIT_REMOTE" "+refs/heads/${GIT_BRANCH}:refs/remotes/${GIT_REMOTE}/${GIT_BRANCH}"
tip="$(git -C "$REPO_DIR" rev-parse "refs/remotes/${GIT_REMOTE}/${GIT_BRANCH}")"
if [[ -n "$TARGET_ARG" ]]; then
  SHA="$TARGET_ARG"
  git -C "$REPO_DIR" cat-file -e "${SHA}^{commit}" 2>/dev/null \
    || die "refusing ${SHA}: not a commit in ${GIT_REMOTE}" 3
  git -C "$REPO_DIR" merge-base --is-ancestor "$SHA" "$tip" \
    || die "refusing ${SHA}: not ${GIT_REMOTE}/${GIT_BRANCH} (${tip}) or an ancestor of it" 3
else
  SHA="$tip"
  log "no sha given; using ${GIT_REMOTE}/${GIT_BRANCH} tip"
fi
log "target sha ${SHA} (${GIT_REMOTE}/${GIT_BRANCH} tip ${tip})"

ACTIVE="$(cat "$STATE_DIR/active-colour" 2>/dev/null || echo legacy)"
case "$ACTIVE" in blue|green|legacy) ;; *) ACTIVE=legacy ;; esac
ACTIVE_SHA="$(cat "$STATE_DIR/active-sha" 2>/dev/null || true)"

# Never move backwards by accident: a late, queued CI run for an older commit
# must not replace a newer live one. A deliberate rollback sets ALLOW_OLDER=1
# by hand on the droplet (sshd does not pass client env to the forced command).
if [[ "$ACTIVE_SHA" =~ ^[0-9a-f]{40}$ && "$ACTIVE_SHA" != "$SHA" && "${ALLOW_OLDER:-0}" != 1 ]] \
  && git -C "$REPO_DIR" merge-base --is-ancestor "$SHA" "$ACTIVE_SHA" 2>/dev/null; then
  die "refusing ${SHA}: older than live ${ACTIVE_SHA} (set ALLOW_OLDER=1 for a deliberate rollback)" 3
fi

# Idempotent: already serving this sha from the active colour and publicly?
if [[ "$ACTIVE" != legacy && "$(running_sha_of "$ACTIVE")" == "$SHA" ]] \
  && [[ "$(http_body "$PUBLIC_URL/version" | body_sha)" == "$SHA" ]]; then
  log "already live: ${ACTIVE} serves ${SHA} via ${PUBLIC_URL}; nothing to do"
  exit 0
fi

git -C "$REPO_DIR" -c advice.detachedHead=false checkout --quiet --detach --force "$SHA"
log "checked out ${SHA} (detached) in $REPO_DIR"
export BUILD_SHA="$SHA"   # the base compose file interpolates ${BUILD_SHA}

if [[ "$ACTIVE" == legacy ]]; then NEW=blue; OLD_CONTAINER="$LEGACY_CONTAINER"
else NEW="$(other_colour "$ACTIVE")"; OLD_CONTAINER="$(colour_container "$ACTIVE")"; fi
NEW_CONTAINER="$(colour_container "$NEW")"
NEW_PORT="$(colour_port "$NEW")"
log "active=${ACTIVE} (${OLD_CONTAINER}) new=${NEW} (${NEW_CONTAINER}, 127.0.0.1:${NEW_PORT})"

# ── 2. Build the image and start the new colour alongside the old one ──────
write_override "$NEW" "$SHA"
if docker image inspect "${IMAGE_REPO}:${SHA}" >/dev/null 2>&1; then
  log "step 2/6: image ${IMAGE_REPO}:${SHA} already built; reusing"
else
  log "step 2/6: building ${IMAGE_REPO}:${SHA} (old container keeps serving)"
  compose_colour "$NEW" build "$API_SERVICE"
fi
compose_colour "$NEW" up -d --no-deps --no-build --force-recreate "$API_SERVICE"
log "started ${NEW_CONTAINER}"

stop_new() {
  log "stopping ${NEW_CONTAINER}; ${OLD_CONTAINER} keeps serving"
  compose_colour "$NEW" stop -t "$STOP_TIMEOUT" "$API_SERVICE" || true
}

# ── 3. Health gate: wait for the new container's /ready ─────────────────────
log "step 3/6: waiting up to ${READY_TIMEOUT}s for http://127.0.0.1:${NEW_PORT}/ready"
deadline=$((SECONDS + READY_TIMEOUT))
ready=0
code=""
while (( SECONDS < deadline )); do
  code="$(http_code "http://127.0.0.1:${NEW_PORT}/ready")"
  if [[ "$code" == 200 ]]; then
    got="$(http_body "http://127.0.0.1:${NEW_PORT}/version" | body_sha)"
    if [[ "$got" == "$SHA" ]]; then ready=1; break; fi
    log "/ready 200 but /version reports '${got:-none}', want ${SHA}"
  fi
  if ! container_running "$NEW_CONTAINER"; then
    log "new container exited; last logs:"
    docker logs --tail 50 "$NEW_CONTAINER" >&2 || true
    break
  fi
  sleep 3
done
if (( ready == 0 )); then
  stop_new
  die "new container not ready within ${READY_TIMEOUT}s (last /ready: ${code:-none})" 4
fi
log "new container ready and reports ${SHA}"

# ── 4. Switch Caddy's upstream and reload gracefully ────────────────────────
log "step 4/6: switching Caddy upstream to ${NEW_CONTAINER}:${API_CONTAINER_PORT}"
prev_upstream="$(cat "$UPSTREAM_FILE")"
rollback_caddy() {
  log "restoring previous Caddy upstream"
  local tmp
  tmp="$(mktemp "${UPSTREAM_FILE}.XXXXXX")"
  printf '%s\n' "$prev_upstream" >"$tmp" && chmod 0644 "$tmp" && mv -f "$tmp" "$UPSTREAM_FILE"
  reload_caddy || log "WARNING: Caddy reload during rollback failed"
}
write_upstream "${NEW_CONTAINER}:${API_CONTAINER_PORT}"
if ! reload_caddy; then
  rollback_caddy
  stop_new
  die "caddy reload failed; rolled back" 5
fi

# ── 5. Verify through Caddy that the public /version is the new sha ─────────
log "step 5/6: verifying ${PUBLIC_URL}/version == ${SHA} (up to ${VERIFY_TIMEOUT}s)"
deadline=$((SECONDS + VERIFY_TIMEOUT))
live=""
while (( SECONDS < deadline )); do
  live="$(http_body "$PUBLIC_URL/version" | body_sha)"
  [[ "$live" == "$SHA" ]] && break
  sleep 2
done
if [[ "$live" != "$SHA" ]]; then
  rollback_caddy
  stop_new
  die "public /version is '${live:-none}', want ${SHA}; rolled back" 6
fi
echo "$NEW" >"$STATE_DIR/active-colour.tmp" && mv -f "$STATE_DIR/active-colour.tmp" "$STATE_DIR/active-colour"
echo "$SHA" >"$STATE_DIR/active-sha.tmp" && mv -f "$STATE_DIR/active-sha.tmp" "$STATE_DIR/active-sha"
log "live: ${PUBLIC_URL} serves ${SHA} from ${NEW_CONTAINER}"

# ── 6. Drain, then stop the old container ───────────────────────────────────
log "step 6/6: draining ${DRAIN_SECONDS}s, then stopping ${OLD_CONTAINER}"
sleep "$DRAIN_SECONDS"
if container_running "$OLD_CONTAINER"; then
  docker stop -t "$STOP_TIMEOUT" "$OLD_CONTAINER" >/dev/null || log "WARNING: could not stop ${OLD_CONTAINER}"
fi
log "stopped ${OLD_CONTAINER} (kept for manual rollback)"

# Keep the newest KEEP_IMAGES sha-tagged images (never the live one), then
# drop dangling layers as the old deploy.sh did.
if (( KEEP_IMAGES > 0 )); then
  # `docker image ls` lists newest first. Removal fails harmlessly (and is
  # skipped) for an image a container still uses, e.g. the stopped old colour.
  stale="$(docker image ls "$IMAGE_REPO" --format '{{.Tag}}' 2>/dev/null \
    | { grep -E '^[0-9a-f]{40}$' || true; } | { grep -vx "$SHA" || true; } \
    | tail -n +"$KEEP_IMAGES")"
  for old in $stale; do
    if docker image rm "${IMAGE_REPO}:${old}" >/dev/null 2>&1; then
      log "pruned image ${IMAGE_REPO}:${old}"
    fi
  done
fi
docker image prune -f >/dev/null 2>&1 || true

if ! cmp -s "$REPO_DIR/deploy/do/swap.sh" "$0" 2>/dev/null; then
  log "NOTICE: $REPO_DIR/deploy/do/swap.sh at ${SHA} differs from the running copy $0; reinstall it by hand if intended (see deploy/do/README.md)"
fi
log "done: ${SHA} live on ${NEW_CONTAINER}"
