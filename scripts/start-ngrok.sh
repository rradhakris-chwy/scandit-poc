#!/usr/bin/env bash
# Start ngrok tunnels for mobile-scanner (3002) and socket-server (4001).
# Run this AFTER start-apps.sh so the apps are listening.
# On your Android phone, open the mobile URL and add ?socket=<socket URL> so the app can reach the socket server.
# Example: https://abc.ngrok-free.app?socket=https://def.ngrok-free.app
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NGROK_TUNNELS="$ROOT/scripts/ngrok.yml"

# Use default ngrok config (has authtoken) merged with our tunnels.
if [ -f "$HOME/Library/Application Support/ngrok/ngrok.yml" ]; then
  NGROK_CONFIG="$HOME/Library/Application Support/ngrok/ngrok.yml,$NGROK_TUNNELS"
elif [ -f "$HOME/.config/ngrok/ngrok.yml" ]; then
  NGROK_CONFIG="$HOME/.config/ngrok/ngrok.yml,$NGROK_TUNNELS"
else
  NGROK_CONFIG="$NGROK_TUNNELS"
  echo "Note: No default ngrok config found. Run: ngrok config add-authtoken YOUR_TOKEN"
fi

if ! command -v ngrok &>/dev/null; then
  echo "ngrok is not installed or not in PATH."
  echo "Install: brew install ngrok   or download from https://ngrok.com/download"
  exit 1
fi

# Check that apps are running
for port in 3002 4001; do
  if ! lsof -ti:"$port" &>/dev/null; then
    echo "Nothing is listening on port $port. Start apps first: ./scripts/start-apps.sh"
    exit 1
  fi
done

echo "Starting ngrok tunnels (mobile=3002, socket=4001)..."
echo "When ngrok shows the URLs:"
echo "  1. Note the 'mobile' URL (forwarding to 3002) and the 'socket' URL (forwarding to 4001)."
echo "  2. On your Android phone, open: <mobile URL>?socket=<socket URL>"
echo "     Example: https://abc.ngrok-free.app?socket=https://def.ngrok-free.app"
echo "  3. Join a room and scan; the dashboard on your computer can stay on http://localhost:3003"
echo ""
exec ngrok start --config="$NGROK_CONFIG" mobile socket
