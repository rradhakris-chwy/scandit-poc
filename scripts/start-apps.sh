#!/usr/bin/env bash
# Start all three apps: socket-server (4001), mobile-scanner (3002), web-dashboard (3003).
# Run from repo root. Apps run in background; use stop-apps.sh to stop them.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Optional: stop first
if [ "$1" = "--restart" ]; then
  echo "Stopping existing apps..."
  "$ROOT/scripts/stop-apps.sh"
  sleep 2
fi

echo "Starting socket-server on port 4001..."
(cd "$ROOT/packages/socket-server" && npm run dev) &
PID1=$!

echo "Starting mobile-scanner on port 3002..."
(cd "$ROOT/packages/mobile-scanner" && npm run dev) &
PID2=$!

echo "Starting web-dashboard on port 3003..."
(cd "$ROOT/packages/web-dashboard" && npm run dev) &
PID3=$!

# Give servers time to bind
sleep 5

echo ""
echo "Apps started (PIDs: $PID1, $PID2, $PID3)."
echo "  Socket server:    http://localhost:4001"
echo "  Mobile scanner:   http://localhost:3002"
echo "  Web dashboard:    http://localhost:3003"
echo ""
echo "To stop: ./scripts/stop-apps.sh"
echo "For Android phone access, run in another terminal: ./scripts/start-ngrok.sh"
echo ""
echo "Waiting for app processes (Ctrl+C stops this script but apps keep running until you run stop-apps.sh)..."
wait 2>/dev/null || true
