#!/usr/bin/env bash
set -euo pipefail

API_URL="https://sports-predictapi-production.up.railway.app"
WEB_URL="https://thepundit.vercel.app"
EXPECTED_API_HOST="sports-predictapi-production.up.railway.app"

COMMIT_ARG="${1:-}"

echo "=== 1. API health ==="
HEALTH=$(curl -fsS "$API_URL/health")
if ! echo "$HEALTH" | grep -q '"status":"ok"'; then
  echo "FAIL: /health did not contain \"status\":\"ok\""
  echo "$HEALTH"
  exit 1
fi
echo "OK"

echo "=== 2. API ready (soft) ==="
READY_TMP=$(mktemp)
READY_HTTP=$(curl -sS -w "%{http_code}" -o "$READY_TMP" "$API_URL/ready" || true)
if [[ "$READY_HTTP" != "200" && "$READY_HTTP" != "503" ]]; then
  echo "FAIL: /ready returned HTTP $READY_HTTP (expected 200 or 503)"
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
rm -f "$READY_TMP"

echo "=== 3. CORS good origin ==="
CORS_GOOD_HEADERS=$(curl -fsS -D - -o /dev/null -H "Origin: $WEB_URL" "$API_URL/api/matches/standings")
if ! echo "$CORS_GOOD_HEADERS" | grep -i "access-control-allow-origin:" | grep -Fq "$WEB_URL"; then
  echo "FAIL: missing access-control-allow-origin: $WEB_URL"
  echo "$CORS_GOOD_HEADERS" | grep -i access-control || true
  exit 1
fi
echo "OK"

echo "=== 4. CORS bad origin ==="
CORS_BAD_HEADERS=$(curl -fsS -D - -o /dev/null -H "Origin: https://evil.example" "$API_URL/api/matches/standings")
if echo "$CORS_BAD_HEADERS" | grep -i "access-control-allow-origin:" | grep -Fq "https://evil.example"; then
  echo "FAIL: evil origin was reflected in access-control-allow-origin"
  exit 1
fi
echo "OK"

echo "=== 5. Vercel bundle ==="
HTML=$(curl -fsS "$WEB_URL/")
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
  CHUNK_BODY=$(curl -fsS "$WEB_URL$CHUNK")
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
echo "  - API ready (/ready, soft)"
echo "  - CORS allow $WEB_URL"
echo "  - CORS reject https://evil.example"
echo "  - Vercel bundle uses $EXPECTED_API_HOST (no localhost:3001, all chunks inspected)"
if [[ -n "$COMMIT_ARG" ]]; then
  echo "  - note: commit arg = $COMMIT_ARG"
fi
