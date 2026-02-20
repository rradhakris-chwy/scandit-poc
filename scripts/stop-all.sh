#!/usr/bin/env bash
# Stop all three apps and ngrok. No error if ngrok is not running.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/scripts/stop-apps.sh"
killall ngrok 2>/dev/null || true
echo "Stopped apps and ngrok."
