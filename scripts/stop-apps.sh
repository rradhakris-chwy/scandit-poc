#!/usr/bin/env bash
# Stop all three apps (socket-server, mobile-scanner, web-dashboard) by killing processes on ports 4001, 3002, 3003.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORTS="4001 3002 3003"
for port in $PORTS; do
  pid=$(lsof -ti:"$port" 2>/dev/null | tr '\n' ' ' | xargs)
  if [ -n "$pid" ]; then
    echo "Stopping process on port $port (PID(s) $pid)"
    kill -9 $pid 2>/dev/null || true
  else
    echo "Port $port: no process"
  fi
done
echo "Done. All app ports cleared."
