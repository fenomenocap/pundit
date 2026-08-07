#!/usr/bin/env bash
# Dumps the production readiness signals needed to diagnose a degraded cache in
# one shot. verify-prod.sh answers "is the deploy healthy" as a pass/fail gate;
# this answers "which cache is degraded and why", which is a different question
# and was previously a sequence of ad-hoc curls.
#
# Read-only. Hits public endpoints only, sends no credentials, and prints
# nothing that is not already served publicly.
#
#   bash scripts/diagnose-prod.sh
#   bash scripts/diagnose-prod.sh https://some-other-host
set -euo pipefail

API_URL="${1:-https://sports-predictapi-production.up.railway.app}"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required (brew install jq)" >&2
  exit 1
fi

# Deliberately not -f. /ready answers 503 with a full JSON body exactly when it
# is degraded, which is the only time this script is worth running; -f threw
# that body away and exited 22, so the diagnostic failed whenever it was needed.
fetch_json() {
  local url="$1" body status
  body=$(curl -sS --max-time 20 -w $'\n%{http_code}' "$url") || {
    echo "  Could not reach $url" >&2
    return 1
  }
  status=${body##*$'\n'}
  body=${body%$'\n'*}
  if [[ -z "$body" ]] || ! jq -e . >/dev/null 2>&1 <<<"$body"; then
    echo "  $url returned HTTP $status with no JSON body" >&2
    return 1
  fi
  printf '%s' "$body"
}

READY=$(fetch_json "$API_URL/ready")
MODEL=$(fetch_json "$API_URL/api/model/active")

echo "=== readiness ==="
jq '{
  status,
  model: {
    ready: .model.ready,
    fixtureCount: .model.fixtureCount,
    expectedActiveFixtureCount: .model.expectedActiveFixtureCount,
    lastUpdated: .model.lastUpdated,
    error: .model.error,
    ratingsServedFromCache: .model.ratingsServedFromCache,
    ratingsAsOf: .model.ratingsAsOf,
    ratingsAgeDays: .model.ratingsAgeDays,
    staleRatings: .model.staleRatings
  },
  football: {
    ready: .football.ready,
    lastUpdated: .football.lastUpdated,
    error: .football.error,
    competitionErrors: .football.competitionErrors
  },
  activeFixtures: {
    count: .activeFixtures.count,
    byCompetition: .activeFixtures.byCompetition,
    lastUpdated: .activeFixtures.lastUpdated
  },
  marketOdds: {
    ready: .marketOdds.ready,
    lastUpdated: .marketOdds.lastUpdated,
    error: .marketOdds.error,
    coverage: .marketOdds.coverage,
    sourceWarnings: .marketOdds.sourceWarnings
  }
}' <<<"$READY"

echo
echo "=== model fixture sample (first 5) ==="
jq '{
  count: (.fixtures | length),
  lastUpdated,
  error,
  sample: [.fixtures[:5][] | {competitionId, date, home, away}]
}' <<<"$MODEL"

echo
echo "=== read ==="
MODEL_COUNT=$(jq -r '.model.fixtureCount // 0' <<<"$READY")
ACTIVE_COUNT=$(jq -r '.activeFixtures.count // 0' <<<"$READY")
MODEL_ERROR=$(jq -r '.model.error // ""' <<<"$READY")
if [[ "$MODEL_ERROR" == *"Club ratings are not ready"* ]]; then
  echo "  No ratings at all, so no fixture can be priced. This is the ratings"
  echo "  provider, not the fixture names: ClubElo is unreachable and the"
  echo "  last-good cache in PUNDIT_DATA_DIR had nothing to restore. The cache"
  echo "  only protects an outage it did not start inside — it needs one"
  echo "  successful fetch banked first. Check that ClubElo answers at all"
  echo "  (curl http://api.clubelo.com/\$(date -u +%F)) before changing code."
elif [[ "$ACTIVE_COUNT" -gt 0 && "$MODEL_COUNT" -eq 0 ]]; then
  echo "  Fixtures exist ($ACTIVE_COUNT) but the model priced none of them."
  echo "  The model covers the active set only when it holds a row for every"
  echo "  fixture, so chat cannot reach the match tier and /ready stays"
  echo "  'loading'. Usual cause is missing club ratings for teams new to the"
  echo "  window; check model.error above and the API's [ClubRatings] logs."
elif [[ "$ACTIVE_COUNT" -gt 0 && "$MODEL_COUNT" -lt "$ACTIVE_COUNT" ]]; then
  echo "  Model covers $MODEL_COUNT of $ACTIVE_COUNT active fixtures — partial"
  echo "  coverage still leaves /ready 'loading'. Check which competition the"
  echo "  uncovered fixtures belong to."
elif [[ "$ACTIVE_COUNT" -eq 0 ]]; then
  echo "  No active fixtures in the window. Match grounding is unavailable by"
  echo "  design until the next scheduled round; nothing is broken."
else
  echo "  Model covers all $ACTIVE_COUNT active fixtures."
fi
