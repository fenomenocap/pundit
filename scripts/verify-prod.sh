#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/curl-bounds.sh"

API_URL="https://thepundit.up.railway.app"
WEB_URL="https://thepundit.vercel.app"
EXPECTED_API_HOST="thepundit.up.railway.app"
VERIFY_HISTORY_FETCH_TIMEOUT_SECONDS="${VERIFY_HISTORY_FETCH_TIMEOUT_SECONDS:-10}"
if ! verify_timeout_seconds \
  "VERIFY_HISTORY_FETCH_TIMEOUT_SECONDS" \
  "$VERIFY_HISTORY_FETCH_TIMEOUT_SECONDS" \
  60; then
  exit 2
fi

if [[ -n "${1:-}" ]]; then
  EXPECTED_API_SHA="$1"
else
  EXPECTED_API_SHA="$(bash "$SCRIPT_DIR/resolve-deployed-sha.sh" api)"
fi
if [[ -n "${2:-}" ]]; then
  EXPECTED_WEB_SHA="$2"
elif [[ -n "${EXPECTED_WEB_SHA:-}" ]]; then
  EXPECTED_WEB_SHA="$EXPECTED_WEB_SHA"
elif [[ -n "${1:-}" ]]; then
  EXPECTED_WEB_SHA="$EXPECTED_API_SHA"
else
  EXPECTED_WEB_SHA="$(bash "$SCRIPT_DIR/resolve-deployed-sha.sh" web)"
fi
EXPECTED_REGISTRY_MODE="${3:-${EXPECTED_REGISTRY_MODE:-shadow}}"
POLL_ATTEMPTS="${VERIFY_PROD_POLL_ATTEMPTS:-40}"
POLL_INTERVAL_SECONDS="${VERIFY_PROD_POLL_INTERVAL_SECONDS:-5}"

json_sha() {
  python3 -c 'import json,sys; print((json.load(sys.stdin).get("sha") or ""))'
}

# The resolved SHA is the oldest commit a target is allowed to be serving, not
# the only one. Vercel's ignore-build step fails open to a build whenever the
# commit range is unusable, and Railway redeploys for causes outside its
# watchPatterns, so a healthy deployment routinely serves a commit *newer* than
# the last one that had to rebuild it. Demanding equality turned that normal
# case into a red run on every push. Serving something *older* than the floor
# still fails: that is a stale or failed deploy.
sha_state() {
  node "$SCRIPT_DIR/resolve-deployed-sha.mjs" compare --floor "${2:-$EXPECTED_API_SHA}" --served "$1" 2>/dev/null || echo "error"
}

sha_matches() {
  local state
  state=$(sha_state "$1" "${2:-$EXPECTED_API_SHA}")
  # A commit this clone has never seen is usually a push that landed while the
  # check was polling. Refresh history once before treating it as a fault.
  if [[ "$state" == "unknown" && "$HISTORY_REFRESHED" == "0" ]]; then
    HISTORY_REFRESHED=1
    node "$SCRIPT_DIR/fetch-history.mjs" \
      --timeout-seconds "$VERIFY_HISTORY_FETCH_TIMEOUT_SECONDS" \
      >/dev/null 2>&1 || true
    state=$(sha_state "$1" "${2:-$EXPECTED_API_SHA}")
  fi
  [[ "$state" == "match" || "$state" == "ahead" ]]
}
HISTORY_REFRESHED=0

echo "=== 1. Minimum deployed SHA (last commit that had to rebuild each target) ==="
echo "API:        $EXPECTED_API_SHA"
echo "web:        $EXPECTED_WEB_SHA"
echo "registry:   $EXPECTED_REGISTRY_MODE"

echo "=== 2. Poll API startup/version ==="
API_SHA=""
for ((attempt = 1; attempt <= POLL_ATTEMPTS; attempt++)); do
  STARTUP_HTTP=$(curl_bounded -sS -o /dev/null -w "%{http_code}" "$API_URL/startup" || true)
  API_VERSION=$(curl_bounded -fsS "$API_URL/version" 2>/dev/null || true)
  API_SHA=$(printf '%s' "$API_VERSION" | json_sha 2>/dev/null || true)
  if [[ "$STARTUP_HTTP" == "200" ]] && sha_matches "$API_SHA" "$EXPECTED_API_SHA"; then
    echo "OK (SHA $API_SHA)"
    break
  fi
  if [[ "$attempt" -eq "$POLL_ATTEMPTS" ]]; then
    echo "FAIL: API did not serve ready startup and a SHA at or after $EXPECTED_API_SHA"
    echo "      /startup HTTP $STARTUP_HTTP, served SHA ${API_SHA:-missing} ($(sha_state "$API_SHA" "$EXPECTED_API_SHA"))"
    exit 1
  fi
  sleep "$POLL_INTERVAL_SECONDS"
done

echo "=== 3. Poll frontend version ==="
WEB_SHA=""
for ((attempt = 1; attempt <= POLL_ATTEMPTS; attempt++)); do
  WEB_VERSION=$(curl_bounded -fsS "$WEB_URL/api/version" 2>/dev/null || true)
  WEB_SHA=$(printf '%s' "$WEB_VERSION" | json_sha 2>/dev/null || true)
  if sha_matches "$WEB_SHA" "$EXPECTED_WEB_SHA"; then
    echo "OK (SHA $WEB_SHA)"
    break
  fi
  if [[ "$attempt" -eq "$POLL_ATTEMPTS" ]]; then
    echo "FAIL: frontend is not serving the web build it must have taken"
    echo "      required at or after $EXPECTED_WEB_SHA"
    echo "      served SHA ${WEB_SHA:-missing} ($(sha_state "$WEB_SHA" "$EXPECTED_WEB_SHA"))"
    exit 1
  fi
  sleep "$POLL_INTERVAL_SECONDS"
done

echo "=== 4. API health ==="
HEALTH=$(curl_bounded -fsS "$API_URL/health")
if ! echo "$HEALTH" | grep -q '"status":"ok"'; then
  echo "FAIL: /health did not contain \"status\":\"ok\""
  echo "$HEALTH"
  exit 1
fi
echo "OK"

echo "=== 5. API ready ==="
READY_TMP=$(mktemp)
READY_HTTP=$(curl_bounded -sS -w "%{http_code}" -o "$READY_TMP" "$API_URL/ready" || true)
if [[ "$READY_HTTP" != "200" ]]; then
  echo "FAIL: /ready returned HTTP $READY_HTTP (expected 200)"
  rm -f "$READY_TMP"
  exit 1
fi
if ! grep -q '"status"' "$READY_TMP"; then
  echo "FAIL: /ready JSON missing status field"
  cat "$READY_TMP"
  rm -f "$READY_TMP"
  exit 1
fi
echo "OK (HTTP $READY_HTTP)"

# Market coverage is reported, never asserted. The public odds endpoints are
# best-effort and a fixture set can legitimately carry no market line at all
# (early-season windows, thinly-priced qualifiers), so failing the deploy check
# on it would cry wolf. But 0/N across every source went unnoticed for weeks
# because nothing surfaced it where anyone looks -- /ready has carried per-source
# coverage all along. Print it here so each deploy check states it out loud.
echo "--- market coverage (informational) ---"
if command -v python3 >/dev/null 2>&1; then
  python3 - "$READY_TMP" <<'PY' || echo "  (could not parse /ready market section)"
import json, sys

with open(sys.argv[1]) as handle:
    ready = json.load(handle)
market = ready.get("marketOdds") or {}
coverage = market.get("coverage") or {}
warnings = market.get("sourceWarnings") or {}
if not coverage:
    print("  no coverage reported")
for source, counts in sorted(coverage.items()):
    matched, total = counts.get("matched", 0), counts.get("total", 0)
    note = warnings.get(source)
    print(f"  {source}: {matched}/{total}" + (f" — {note}" if note else ""))
if coverage and all((c.get("matched") or 0) == 0 for c in coverage.values()) \
        and any((c.get("total") or 0) > 0 for c in coverage.values()):
    print("  NOTE: no market line reached any active fixture, so model-vs-market")
    print("        comparison is unavailable in chat right now.")
PY
else
  echo "  (python3 unavailable; inspect $API_URL/ready manually)"
fi
echo "=== 6. Registry, search, and runtime controls ==="
REGISTRY_TMP=$(mktemp)
REGISTRY_HTTP=$(curl_bounded -sS -w "%{http_code}" -o "$REGISTRY_TMP" "$API_URL/api/fixtures/recognized" || true)
MODEL_TMP=$(mktemp)
MODEL_HTTP=$(curl_bounded -sS -w "%{http_code}" -o "$MODEL_TMP" "$API_URL/api/model/active" || true)
if [[ "$REGISTRY_HTTP" != "200" || "$MODEL_HTTP" != "200" ]]; then
  echo "FAIL: registry/model certification surfaces returned HTTP $REGISTRY_HTTP/$MODEL_HTTP"
  rm -f "$REGISTRY_TMP" "$MODEL_TMP" "$READY_TMP"
  exit 1
fi
python3 - "$READY_TMP" "$REGISTRY_TMP" "$MODEL_TMP" "$EXPECTED_REGISTRY_MODE" <<'PY'
import json, sys
from datetime import datetime, timezone

with open(sys.argv[1]) as handle:
    ready = json.load(handle)
with open(sys.argv[2]) as handle:
    snapshot = json.load(handle)
with open(sys.argv[3]) as handle:
    model = json.load(handle)

registry = ready.get("fixtureRegistry") or {}
expected_mode = sys.argv[4]
expected_enabled = expected_mode == "enabled"
if registry.get("mode") != expected_mode or registry.get("enabled") is not expected_enabled:
    raise SystemExit(f"fixture registry is not in expected {expected_mode} mode")
if registry.get("storageBlocked") is not False or registry.get("error") is not None:
    raise SystemExit("fixture registry reports blocked or failed storage")
if not isinstance(ready.get("webSearch"), dict):
    raise SystemExit("/ready is missing webSearch status")
rate = ready.get("askRateLimit") or {}
if (rate.get("scope") != "deployment" or rate.get("replicas") != 1
        or rate.get("perMinute") != 10 or rate.get("perInstance") != 10):
    raise SystemExit("ask rate-limit settings do not match the one-replica production contract")
ratings = ready.get("model") or {}
artifact_id = ratings.get("ratingArtifactId")
artifact_sha = ratings.get("ratingArtifactSha256")
ratings_as_of = ratings.get("ratingsAsOf")
try:
    parsed_ratings_as_of = datetime.fromisoformat(
        ratings_as_of.replace("Z", "+00:00")
    ) if isinstance(ratings_as_of, str) else None
except ValueError:
    parsed_ratings_as_of = None
now = datetime.now(timezone.utc)
ratings_age_seconds = (
    (now - parsed_ratings_as_of).total_seconds()
    if parsed_ratings_as_of is not None and parsed_ratings_as_of.tzinfo is not None
    else None
)
reported_age_days = ratings.get("ratingsAgeDays")
expected_age_days = (
    max(0, int(ratings_age_seconds // 86400))
    if ratings_age_seconds is not None
    else None
)
if (not isinstance(artifact_id, str) or not artifact_id.startswith("clubelo@1:")
        or not isinstance(artifact_sha, str) or len(artifact_sha) != 64
        or not artifact_id.endswith(artifact_sha)
        or not isinstance(reported_age_days, int)
        or reported_age_days != expected_age_days
        or ratings_age_seconds is None
        or ratings_age_seconds < -86400
        or ratings_age_seconds > 30 * 86400
        or ratings.get("ratingsServedFromCache") is not False):
    raise SystemExit("club-strength artifact identity, hash, or freshness is invalid")
season = ready.get("seasonSchedule") or {}
start_year = now.year if now.month >= 7 else now.year - 1
expected_season = f"{start_year}-{str(start_year + 1)[-2:]}"
if (season.get("ready") is not True or season.get("fixtureCount") != 380
        or season.get("seasonId") != expected_season
        or season.get("error") is not None
        or not isinstance(season.get("ageMinutes"), int)
        or season.get("ageMinutes") >= 360):
    raise SystemExit("complete Premier League season schedule is not ready and healthy")
endpoint_registry = snapshot.get("registry") or {}
for field in ("mode", "enabled", "storageBlocked"):
    if endpoint_registry.get(field) != registry.get(field):
        raise SystemExit(f"registry endpoint invariant {field} differs from /ready")
if endpoint_registry.get("error") is not None:
    raise SystemExit("registry endpoint reports an error")
fixtures = snapshot.get("fixtures")
if not isinstance(fixtures, list):
    raise SystemExit("registry endpoint is missing fixtures")
serialized = json.dumps(snapshot).lower()
if "candidateid" in serialized or "discoveredby" in serialized:
    raise SystemExit("candidate/search discovery data leaked into the recognized registry")

model_rows = model.get("fixtures") if isinstance(model, dict) else None
if not isinstance(model_rows, list):
    raise SystemExit("model endpoint is missing fixtures")
if (ready.get("activeFixtures") or {}).get("count", 0) > 0 and len(model_rows) == 0:
    raise SystemExit("active fixtures exist but the model has no priced rows")
model_ids = {
    f"{row.get('competitionId')}:{row.get('fixtureId')}"
    for row in model_rows if isinstance(row, dict)
}
approved_friendly = next((row for row in fixtures
    if (row.get("fixture") or {}).get("fixtureId") == "espn:club.friendly:401867142"), None)
if not approved_friendly:
    raise SystemExit("approved Arsenal-Real Betis friendly is missing from the registry")
friendly_fixture = approved_friendly.get("fixture") or {}
friendly_sources = friendly_fixture.get("observedSources") or []
if ((approved_friendly.get("capability") or {}) != {
        "status": "outside-coverage", "reason": "friendly-policy-disabled"}
        or friendly_fixture.get("recognition") != "corroborated"
        or not any(source.get("source") == "espn"
                   and source.get("authority") == "authoritative"
                   for source in friendly_sources)
        or not any(source.get("source") == "official-club"
                   and source.get("authority") == "corroborating"
                   for source in friendly_sources)):
    raise SystemExit("approved friendly identity/corroboration/capability contract failed")
for row in fixtures:
    capability = row.get("capability") or {}
    if capability.get("status") == "priced" and capability.get("modelFixtureId") not in model_ids:
        raise SystemExit("recognized priced fixture does not join to the active model")
priced_ids = {
    (row.get("capability") or {}).get("modelFixtureId")
    for row in fixtures
    if (row.get("capability") or {}).get("status") == "priced"
}
for model_id in model_ids:
    if model_id not in priced_ids:
        raise SystemExit("active model row does not join to a recognized priced fixture")
print(f"OK ({len(fixtures)} recognized fixtures; {expected_mode} registry healthy)")
PY
rm -f "$REGISTRY_TMP" "$MODEL_TMP" "$READY_TMP"

echo "=== 7. CORS good origin ==="
CORS_GOOD_HEADERS=$(curl_bounded -fsS -D - -o /dev/null -H "Origin: $WEB_URL" "$API_URL/api/matches/standings")
if ! echo "$CORS_GOOD_HEADERS" | grep -i "access-control-allow-origin:" | grep -Fq "$WEB_URL"; then
  echo "FAIL: missing access-control-allow-origin: $WEB_URL"
  echo "$CORS_GOOD_HEADERS" | grep -i access-control || true
  exit 1
fi
echo "OK"

echo "=== 8. CORS bad origin ==="
CORS_BAD_HEADERS=$(curl_bounded -fsS -D - -o /dev/null -H "Origin: https://evil.example" "$API_URL/api/matches/standings")
if echo "$CORS_BAD_HEADERS" | grep -i "access-control-allow-origin:" | grep -Fq "https://evil.example"; then
  echo "FAIL: evil origin was reflected in access-control-allow-origin"
  exit 1
fi
echo "OK"

echo "=== 9. Vercel bundle ==="
HTML=$(curl_bounded -fsS "$WEB_URL/")
# Collect every JS chunk the homepage loads (page chunk + layout chunk +
# shared/vendor chunks). API host constants live in lib/api.ts and may
# be tree-shaken into any of them depending on the build.
CHUNKS=$(echo "$HTML" | grep -oE '/_next/static/[^"]+\.js' | sort -u || true)
if [[ -z "$CHUNKS" ]]; then
  echo "FAIL: could not extract any JS chunk from homepage"
  exit 1
fi
FOUND_HOST=0
FOUND_LOCALHOST=0
INSPECTED=""
CHUNK_COUNT=0
while IFS= read -r CHUNK; do
  [[ -z "$CHUNK" ]] && continue
  CHUNK_BODY=$(curl_bounded -fsS "$WEB_URL$CHUNK")
  CHUNK_COUNT=$((CHUNK_COUNT + 1))
  INSPECTED="$INSPECTED $CHUNK"
  if echo "$CHUNK_BODY" | grep -Fq "$EXPECTED_API_HOST"; then
    FOUND_HOST=1
  fi
  if echo "$CHUNK_BODY" | grep -Fq "localhost:3001"; then
    FOUND_LOCALHOST=1
  fi
done <<< "$CHUNKS"
if [[ "$FOUND_HOST" -ne 1 ]]; then
  echo "FAIL: no homepage chunk contains expected API host ($EXPECTED_API_HOST)"
  echo "      inspected:$INSPECTED"
  exit 1
fi
if [[ "$FOUND_LOCALHOST" -ne 0 ]]; then
  echo "FAIL: a homepage chunk still contains localhost:3001 API fallback"
  echo "      inspected:$INSPECTED"
  exit 1
fi
echo "OK (chunks: $CHUNK_COUNT inspected)"

echo ""
echo "PASS: production verification OK"
echo "  - API health (/health)"
echo "  - API startup and ready"
echo "  - API serves $API_SHA (at or after required $EXPECTED_API_SHA)"
echo "  - web serves $WEB_SHA (at or after required $EXPECTED_WEB_SHA)"
echo "  - registry is $EXPECTED_REGISTRY_MODE, healthy, candidate-free, and model-joined"
echo "  - search and one-replica rate-limit status are exposed"
echo "  - CORS allow $WEB_URL"
echo "  - CORS reject https://evil.example"
echo "  - Vercel bundle uses $EXPECTED_API_HOST (no localhost:3001, all chunks inspected)"
