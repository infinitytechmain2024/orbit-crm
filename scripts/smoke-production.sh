#!/bin/sh
set -eu

FRONTEND_URL=${FRONTEND_URL:-}
BACKEND_URL=${BACKEND_URL:-}

if [ -z "$FRONTEND_URL" ]; then
  echo "FRONTEND_URL is required" >&2
  exit 2
fi

probe() {
  label=$1
  expected=$2
  url=$3
  actual=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 60 "$url")
  if [ "$actual" != "$expected" ]; then
    echo "FAIL $label: expected HTTP $expected, got $actual" >&2
    return 1
  fi
  echo "OK   $label: HTTP $actual"
}

probe "frontend" 200 "${FRONTEND_URL%/}/"

if [ -n "$BACKEND_URL" ]; then
  probe "backend health" 200 "${BACKEND_URL%/}/api/health"
else
  echo "SKIP backend health: BACKEND_URL is not set"
fi

# Protected proxy must never expose CRM/OpenClaw data to an anonymous request.
proxy_code=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 60 \
  "${FRONTEND_URL%/}/api/backend/api/health")
case "$proxy_code" in
  401|403) echo "OK   protected proxy rejects anonymous request: HTTP $proxy_code" ;;
  *) echo "FAIL protected proxy: expected HTTP 401/403, got $proxy_code" >&2; exit 1 ;;
esac
