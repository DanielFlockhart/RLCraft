#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TASK="${1:-${TRAINING_TASK:-wood_collection}}"
GENERATIONS="${GENERATIONS:-1000}"

cd "$PROJECT_DIR"
START_SERVER=true TRAINING_TASK="$TASK" GENERATIONS="$GENERATIONS" npm start
