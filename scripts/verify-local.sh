#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-http://localhost:3001}"
WEB_URL="${WEB_URL:-http://localhost:3000}"

echo "=== 1. API health ==="
curl -fsS "$API_URL/health" | grep -q '"status":"ok"'
echo "OK"

echo "=== 2. Competitions ==="
curl -fsS "$API_URL/api/matches/competitions" | grep -q 'eng.1'
echo "OK"

echo "=== 3. Active fixtures ==="
curl -fsS "$API_URL/api/matches/active"
echo ""
echo "OK"

echo "=== 4. Model active ==="
curl -fsS "$API_URL/api/model/active"
echo ""
echo "OK"

echo "=== 5. WC evaluation unchanged ==="
curl -fsS "$API_URL/api/evaluation/wc-2026" | grep -q '"competition":"fifa.world"'
echo "OK"

echo "=== 6. Ready (soft) ==="
READY_HTTP=$(curl -sS -o /dev/null -w "%{http_code}" "$API_URL/ready")
if [[ "$READY_HTTP" != "200" && "$READY_HTTP" != "503" ]]; then
  echo "FAIL: /ready returned HTTP $READY_HTTP"
  exit 1
fi
echo "OK (HTTP $READY_HTTP)"

echo ""
echo "PASS: local verification OK against $API_URL"
