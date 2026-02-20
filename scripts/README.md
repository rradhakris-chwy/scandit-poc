# SCAN_POC scripts

## One command: restart everything + phone URL

- **`./scripts/restart-all-with-ngrok.sh`** – Stops all apps and ngrok, starts the three apps and ngrok, then **prints the mobile scanner URL** to open on your Android phone (with `?socket=...` already set). Run from repo root. Requires ngrok installed.

## Stop / start apps

- **`./scripts/stop-apps.sh`** – Stop all three apps (kills processes on ports 4001, 3002, 3003).
- **`./scripts/stop-all.sh`** – Stop apps and ngrok (no error if ngrok isn’t running).
- **`./scripts/start-apps.sh`** – Start socket-server, mobile-scanner, and web-dashboard. Run from repo root. Use another terminal for ngrok or other commands.
- **`./scripts/start-apps.sh --restart`** – Stop existing apps, then start them again.
- **`./scripts/restart-apps.sh`** – Same as stop then start.

Ports:

| App             | Port |
|-----------------|------|
| Socket server   | 4001 |
| Mobile scanner  | 3002 |
| Web dashboard   | 3003 |

## Access mobile app from Android phone (ngrok)

**Easiest:** run **`./scripts/restart-all-with-ngrok.sh`** – it prints the exact URL to open on your phone.

### One-time ngrok auth (required for phone URL)

ngrok needs a free account and authtoken. The scripts use your **default ngrok config** (where the token is stored) merged with the project tunnels:

1. **Sign up:** [https://dashboard.ngrok.com/signup](https://dashboard.ngrok.com/signup)
2. **Get your authtoken:** [https://dashboard.ngrok.com/get-started/your-authtoken](https://dashboard.ngrok.com/get-started/your-authtoken)
3. **Add it on your machine:**  
   `ngrok config add-authtoken YOUR_AUTHTOKEN_HERE`  
   This writes to `~/Library/Application Support/ngrok/ngrok.yml` (macOS) or `~/.config/ngrok/ngrok.yml` (Linux).
4. Run **`./scripts/restart-all-with-ngrok.sh`** again; it will use that config and print the phone URL.

**Manual:**

1. Start the apps (if not already running):
   ```bash
   ./scripts/start-apps.sh
   ```
2. In a **second terminal**, start ngrok:
   ```bash
   ./scripts/start-ngrok.sh
   ```
3. In the ngrok output you’ll see two URLs, for example:
   - `mobile` → `https://abc123.ngrok-free.app` (mobile-scanner)
   - `socket` → `https://def456.ngrok-free.app` (socket-server)
4. On your Android phone, open the **mobile** URL and pass the **socket** URL as a query param:
   ```
   https://abc123.ngrok-free.app?socket=https://def456.ngrok-free.app
   ```
5. Join a room and scan; the web dashboard on your computer (http://localhost:3003) will receive scans.

**Requirements:** [ngrok](https://ngrok.com/download) installed (e.g. `brew install ngrok`) and signed in if required by your plan.
