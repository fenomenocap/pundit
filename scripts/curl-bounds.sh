#!/usr/bin/env bash

# Shared request bounds for the verification scripts. Keep these values
# deliberately small and validate them before curl is ever invoked. A caller
# can tune the defaults for a slow local service, but cannot turn a request
# into an unbounded wait or make the connect phase longer than the total wait.

VERIFY_CURL_CONNECT_TIMEOUT_SECONDS="${VERIFY_CURL_CONNECT_TIMEOUT_SECONDS:-5}"
VERIFY_CURL_TOTAL_TIMEOUT_SECONDS="${VERIFY_CURL_TOTAL_TIMEOUT_SECONDS:-20}"

readonly CURL_CONNECT_TIMEOUT_CAP_SECONDS=30
readonly CURL_TOTAL_TIMEOUT_CAP_SECONDS=120

_normalize_timeout_integer() {
  local value="$1"
  while [[ "$value" == 0* && "$value" != "0" ]]; do
    value="${value:1}"
  done
  printf '%s' "$value"
}

verify_timeout_seconds() {
  local name="$1"
  local value="$2"
  local cap="$3"
  local normalized

  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    echo "FAIL: $name must be a positive integer number of seconds" >&2
    return 1
  fi

  normalized="$(_normalize_timeout_integer "$value")"
  if [[ "$normalized" == "0" ]]; then
    echo "FAIL: $name must be greater than zero" >&2
    return 1
  fi

  # Compare digit lengths before using Bash arithmetic. This prevents a huge
  # environment override from overflowing the shell's integer type.
  if (( ${#normalized} > ${#cap} )) || {
    (( ${#normalized} == ${#cap} )) && (( 10#$normalized > 10#$cap ));
  }; then
    echo "FAIL: $name must be no greater than $cap seconds" >&2
    return 1
  fi
}

if ! verify_timeout_seconds \
  "VERIFY_CURL_CONNECT_TIMEOUT_SECONDS" \
  "$VERIFY_CURL_CONNECT_TIMEOUT_SECONDS" \
  "$CURL_CONNECT_TIMEOUT_CAP_SECONDS"; then
  return 1
fi
if ! verify_timeout_seconds \
  "VERIFY_CURL_TOTAL_TIMEOUT_SECONDS" \
  "$VERIFY_CURL_TOTAL_TIMEOUT_SECONDS" \
  "$CURL_TOTAL_TIMEOUT_CAP_SECONDS"; then
  return 1
fi
CURL_CONNECT_TIMEOUT_NORMALIZED="$(_normalize_timeout_integer "$VERIFY_CURL_CONNECT_TIMEOUT_SECONDS")"
CURL_TOTAL_TIMEOUT_NORMALIZED="$(_normalize_timeout_integer "$VERIFY_CURL_TOTAL_TIMEOUT_SECONDS")"
if (( CURL_CONNECT_TIMEOUT_NORMALIZED > CURL_TOTAL_TIMEOUT_NORMALIZED )); then
  echo "FAIL: VERIFY_CURL_CONNECT_TIMEOUT_SECONDS cannot exceed VERIFY_CURL_TOTAL_TIMEOUT_SECONDS" >&2
  return 1
fi

curl_bounded() {
  command curl \
    --connect-timeout "$VERIFY_CURL_CONNECT_TIMEOUT_SECONDS" \
    --max-time "$VERIFY_CURL_TOTAL_TIMEOUT_SECONDS" \
    "$@"
}
