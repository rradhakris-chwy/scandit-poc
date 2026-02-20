#!/usr/bin/env bash
# Stop all apps + ngrok, restart apps and ngrok, then print the mobile scanner URL for your phone.
# Run from repo root.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NGROK_TUNNELS="$ROOT/scripts/ngrok.yml"

# Use default ngrok config (has authtoken) merged with our tunnels. ngrok merges when given multiple --config files.
if [ -f "$HOME/Library/Application Support/ngrok/ngrok.yml" ]; then
  NGROK_CONFIG="$HOME/Library/Application Support/ngrok/ngrok.yml,$NGROK_TUNNELS"
elif [ -f "$HOME/.config/ngrok/ngrok.yml" ]; then
  NGROK_CONFIG="$HOME/.config/ngrok/ngrok.yml,$NGROK_TUNNELS"
else
  NGROK_CONFIG="$NGROK_TUNNELS"
  echo "Note: No default ngrok config found. Run: ngrok config add-authtoken YOUR_TOKEN"
fi

echo "=== Stopping everything ==="
# Stop apps (ports 4001, 3002, 3003)
"$ROOT/scripts/stop-apps.sh"
# Stop ngrok
if command -v killall &>/dev/null; then
  killall ngrok 2>/dev/null || true
elif command -v pkill &>/dev/null; then
  pkill -f "ngrok start" 2>/dev/null || true
fi
# Also kill anything on ngrok's API port so we get a clean start
lsof -ti:4040 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 2

echo ""
echo "=== Starting apps ==="
(cd "$ROOT/packages/socket-server" && npm run dev) &
(cd "$ROOT/packages/mobile-scanner" && npm run dev) &
(cd "$ROOT/packages/web-dashboard" && npm run dev) &
sleep 6

if ! lsof -ti:3002 &>/dev/null || ! lsof -ti:4001 &>/dev/null; then
  echo "Apps failed to start. Check ports 3002 and 4001."
  exit 1
fi

if ! command -v ngrok &>/dev/null; then
  echo "ngrok not found. Apps are running; install ngrok and run this script again for phone URL."
  echo "  Mobile scanner: http://localhost:3002"
  exit 0
fi

echo ""
echo "=== Starting ngrok ==="
ngrok start --config="$NGROK_CONFIG" mobile socket --log=stdout &
NGROK_PID=$!
# Wait for ngrok API to be up and tunnels to exist (or for ngrok to exit on auth failure)
get_ngrok_urls() {
  python3 -c "
import json, urllib.request
mobile = socket_url = ''
try:
    r = urllib.request.urlopen('http://127.0.0.1:4040/api/endpoints', timeout=3)
    d = json.loads(r.read().decode())
    for e in d.get('endpoints', []):
        name = e.get('name', '')
        url = (e.get('url') or '').rstrip('/')
        if name == 'mobile' and url: mobile = url
        elif name == 'socket' and url: socket_url = url
except Exception:
    pass
if not mobile or not socket_url:
    try:
        r = urllib.request.urlopen('http://127.0.0.1:4040/api/tunnels', timeout=3)
        d = json.loads(r.read().decode())
        for t in d.get('tunnels', []):
            addr = str(t.get('config', {}).get('addr', ''))
            url = (t.get('public_url') or '').rstrip('/')
            if '3002' in addr and url: mobile = url
            elif '4001' in addr and url: socket_url = url
        if not mobile and not socket_url:
            for t in d.get('tunnels', []):
                name = t.get('name', '')
                url = (t.get('public_url') or '').rstrip('/')
                if name == 'mobile' and url: mobile = url
                elif name == 'socket' and url: socket_url = url
    except Exception:
        pass
if mobile: print('MOBILE:', mobile)
if socket_url: print('SOCKET:', socket_url)
" 2>/dev/null
}
MOBILE_URL=""
SOCKET_URL=""
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 2
  if ! kill -0 $NGROK_PID 2>/dev/null; then
    echo "ngrok exited (often due to missing authtoken)."
    break
  fi
  while IFS= read -r line; do
    if [[ "$line" == MOBILE:* ]]; then MOBILE_URL="${line#MOBILE: }"; fi
    if [[ "$line" == SOCKET:* ]]; then SOCKET_URL="${line#SOCKET: }"; fi
  done < <(get_ngrok_urls)
  [ -n "$MOBILE_URL" ] && [ -n "$SOCKET_URL" ] && break
  [ $i -eq 10 ] && echo "ngrok tunnels did not come up in time."
done

echo ""
echo "========================================================================"
if [ -n "$MOBILE_URL" ] && [ -n "$SOCKET_URL" ]; then
  echo "  Open this URL on your Android phone:"
  echo ""
  echo "  ${MOBILE_URL}?socket=${SOCKET_URL}"
  echo ""
  echo "  (Copy the line above into your phone browser.)"
else
  echo "  Phone URL not available (ngrok needs an account + authtoken)."
  echo ""
  echo "  1. Sign up: https://dashboard.ngrok.com/signup"
  echo "  2. Get authtoken: https://dashboard.ngrok.com/get-started/your-authtoken"
  echo "  3. Run: ngrok config add-authtoken <your-token>"
  echo "  4. Run this script again: ./scripts/restart-all-with-ngrok.sh"
  echo ""
  echo "  Until then, use on this machine:"
fi
echo "========================================================================"
echo ""
echo "Local:  Mobile scanner http://localhost:3002  |  Dashboard http://localhost:3003"
if [ -n "$MOBILE_URL" ] && [ -n "$SOCKET_URL" ]; then
  echo "ngrok is running (PID $NGROK_PID). To stop: ./scripts/stop-apps.sh && killall ngrok"
else
  echo "Apps are running. To stop: ./scripts/stop-apps.sh"
fi
echo ""
