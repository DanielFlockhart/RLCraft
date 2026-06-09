#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_DIR="$ROOT_DIR/server"
SERVER_LOG="${SERVER_LOG:-$SERVER_DIR/server.log}"
SERVER_STARTUP_WAIT="${SERVER_STARTUP_WAIT:-10}"
RESTART_WAIT="${RESTART_WAIT:-5}"

while true; do
  echo "Starting server..."
  "$SERVER_DIR/start_server.sh" > "$SERVER_LOG" 2>&1 &
  SERVER_PID=$!

  sleep "$SERVER_STARTUP_WAIT"

  echo "Starting PVP bots..."
  (cd "$SCRIPT_DIR" && npm run start:pvp) || true

  echo "Bots stopped; stopping server..."
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true

  echo "Restarting in ${RESTART_WAIT} seconds..."
  sleep "$RESTART_WAIT"
done
