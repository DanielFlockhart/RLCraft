#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
JAR="${MINECRAFT_SERVER_JAR:-paper-1.18.1-216.jar}"
MIN_MEMORY="${MINECRAFT_MIN_MEMORY:-6G}"
MAX_MEMORY="${MINECRAFT_MAX_MEMORY:-6G}"

cd "$SCRIPT_DIR"
exec java "-Xms${MIN_MEMORY}" "-Xmx${MAX_MEMORY}" -jar "$JAR" nogui
