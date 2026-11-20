#!/usr/bin/env bash
set -e

echo "Starting EV SENSE containers..."
docker compose up -d

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/scripts/show_status.py" ]; then
    python3 "$SCRIPT_DIR/scripts/show_status.py" || python "$SCRIPT_DIR/scripts/show_status.py"
fi
