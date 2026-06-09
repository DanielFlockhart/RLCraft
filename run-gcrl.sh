#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/game-completion-rl"
TASK="${1:-${TRAINING_TASK:-wood_collection}}"
GENERATIONS="${GENERATIONS:-1000}"

cd "$SCRIPT_DIR"

START_SERVER=true TRAINING_TASK="$TASK" GENERATIONS="$GENERATIONS" npm --prefix "$PROJECT_DIR" start
