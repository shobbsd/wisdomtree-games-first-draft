#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RUNTIME_DIR="${UAT_RUNTIME_DIR:-$ROOT_DIR/.runtime/uat}"
PID_FILE="${UAT_PID_FILE:-$RUNTIME_DIR/server.pid}"
LOG_FILE="${UAT_LOG_FILE:-$RUNTIME_DIR/server.log}"
HOST="${UAT_HTTP_HOST:-127.0.0.1}"
PORT="${UAT_HTTP_PORT:-4310}"
HEALTH_URL="http://${HOST}:${PORT}/health"

mkdir -p "$RUNTIME_DIR"

if [[ -f "$PID_FILE" ]]; then
  EXISTING_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$EXISTING_PID" ]] && kill -0 "$EXISTING_PID" >/dev/null 2>&1; then
    echo "UAT server already running (pid ${EXISTING_PID})"
    exit 1
  fi
  rm -f "$PID_FILE"
fi

nohup npm run --silent uat:serve >>"$LOG_FILE" 2>&1 &
PID="$!"
echo "$PID" >"$PID_FILE"

for _ in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    echo "UAT server started (pid ${PID}) at http://${HOST}:${PORT}"
    echo "Log: $LOG_FILE"
    exit 0
  fi
  sleep 0.2
done

echo "UAT server failed health check at ${HEALTH_URL}"
kill "$PID" >/dev/null 2>&1 || true
rm -f "$PID_FILE"
exit 1
