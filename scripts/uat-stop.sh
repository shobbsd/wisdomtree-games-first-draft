#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RUNTIME_DIR="${UAT_RUNTIME_DIR:-$ROOT_DIR/.runtime/uat}"
PID_FILE="${UAT_PID_FILE:-$RUNTIME_DIR/server.pid}"

if [[ ! -f "$PID_FILE" ]]; then
  echo "UAT server not running (pid file missing)"
  exit 0
fi

PID="$(cat "$PID_FILE" 2>/dev/null || true)"
if [[ -z "$PID" ]]; then
  rm -f "$PID_FILE"
  echo "UAT server pid file empty; cleaned up"
  exit 0
fi

if ! kill -0 "$PID" >/dev/null 2>&1; then
  rm -f "$PID_FILE"
  echo "UAT server already stopped (stale pid ${PID} removed)"
  exit 0
fi

kill "$PID" >/dev/null 2>&1 || true

for _ in $(seq 1 40); do
  if ! kill -0 "$PID" >/dev/null 2>&1; then
    rm -f "$PID_FILE"
    echo "UAT server stopped (pid ${PID})"
    exit 0
  fi
  sleep 0.2
done

echo "UAT server did not stop gracefully; sending SIGKILL"
kill -9 "$PID" >/dev/null 2>&1 || true
rm -f "$PID_FILE"
echo "UAT server force-stopped (pid ${PID})"
