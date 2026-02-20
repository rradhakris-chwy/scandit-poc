# Scandit POC

Proof-of-concept scanning app: **mobile scanner** (barcode, QR, label capture via Scandit; optional OCR) and **web dashboard** that receive scans in real time over a socket server.

## What’s in the repo

| Package           | Description |
|-------------------|-------------|
| `packages/mobile-scanner` | Web app for scanning: Scandit Smart Label Capture, QR/barcode, OCR (Tesseract; optional Google Vision / Paddle). |
| `packages/web-dashboard` | Dashboard that shows scans from the mobile app (same room/session). |
| `packages/socket-server` | Socket.io server that relays scan events between scanner and dashboard. |
| `packages/shared`         | Shared utilities (socket client, constants). |

## Quick start

1. **Install dependencies** (from repo root):

   ```bash
   cd packages/socket-server && npm install && cd ../..
   cd packages/shared    && npm install && cd ../..
   cd packages/mobile-scanner && npm install && cd ../..
   cd packages/web-dashboard  && npm install && cd ../..
   ```

2. **Scandit license** (required for label/barcode scanning):

   - Get a license from [Scandit](https://www.scandit.com/).
   - In `packages/mobile-scanner`, create a `.env` with:
     ```bash
     SCANDIT_LICENSE_KEY=your_license_key_here
     ```
   - Or set the `SCANDIT_LICENSE_KEY` environment variable when running the app.

3. **Start everything and get the phone URL** (from repo root):

   ```bash
   ./scripts/restart-all-with-ngrok.sh
   ```

   This script:

   - Stops any running apps and ngrok
   - Starts socket server (4001), mobile scanner (3002), and web dashboard (3003)
   - Starts ngrok tunnels for mobile and socket
   - Prints a single URL to open on your **Android phone** (with `?socket=...` already set)

   Copy that URL into your phone’s browser to use the scanner with camera. The dashboard on your computer (http://localhost:3003) will show scans from the same room.

4. **Stop everything**:

   ```bash
   ./scripts/stop-apps.sh
   killall ngrok   # if you started ngrok via the script above
   ```

## Scripts

| Script | Purpose |
|--------|---------|
| `./scripts/restart-all-with-ngrok.sh` | Stop all, start the three apps + ngrok, print the mobile URL for your phone. |
| `./scripts/stop-apps.sh` | Stop the three apps (ports 4001, 3002, 3003). |

## Ports

| Service        | Port |
|----------------|------|
| Socket server  | 4001 |
| Mobile scanner | 3002 |
| Web dashboard  | 3003 |

## Ngrok (phone access)

The mobile app needs **HTTPS** on the phone for camera access. `restart-all-with-ngrok.sh` uses [ngrok](https://ngrok.com/) to expose the scanner and socket server.

- **One-time:** Sign up at [dashboard.ngrok.com](https://dashboard.ngrok.com/signup), get your [authtoken](https://dashboard.ngrok.com/get-started/your-authtoken), then run:
  ```bash
  ngrok config add-authtoken YOUR_AUTHTOKEN
  ```
- The script merges your default ngrok config (where the token is stored) with the project’s tunnels. After that, run `./scripts/restart-all-with-ngrok.sh` and use the printed URL on your phone.

## Optional: OCR and API keys

- **Google Cloud Vision** (optional): set `GOOGLE_CLOUD_VISION_API_KEY` or `GOOGLE_VISION_API_KEY` for the socket server to enable Cloud Vision OCR.
- **PaddleOCR** (optional): set `PADDLE_OCR_SERVICE_URL` (e.g. `http://localhost:5000`) if you run a PaddleOCR service; the socket server will proxy OCR requests to it.

Without these, the mobile app can still use **Tesseract.js** (client-side) for OCR.

## Tech stack

- **Frontend:** React, Rsbuild (mobile-scanner, web-dashboard)
- **Scanning:** [Scandit Web SDK](https://docs.scandit.com/sdks/web/) (Label Capture, Barcode), html5-qrcode, Tesseract.js
- **Realtime:** Socket.io (socket-server, shared client)
