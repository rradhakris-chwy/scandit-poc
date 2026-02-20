/**
 * Socket.io server for mobile-scanner ↔ web-dashboard flow.
 * Optional OCR backends:
 *   POST /api/ocr — Google Cloud Vision (set GOOGLE_CLOUD_VISION_API_KEY or GOOGLE_VISION_API_KEY).
 *   POST /api/ocr-paddle — PaddleOCR service (set PADDLE_OCR_SERVICE_URL e.g. http://localhost:5000).
 * Run with: npm start (default port 4001).
 */
import http from 'http';
import { Server } from 'socket.io';

const JOIN_ROOM = 'join-room';
const SEND_SCAN = 'send-scan';
const BROADCAST_TO_DASHBOARD = 'broadcast-to-dashboard';

const PORT = Number(process.env.SOCKET_PORT) || 4001;
const VISION_API_KEY = process.env.GOOGLE_CLOUD_VISION_API_KEY || process.env.GOOGLE_VISION_API_KEY;
const PADDLE_OCR_URL = process.env.PADDLE_OCR_SERVICE_URL
  ? process.env.PADDLE_OCR_SERVICE_URL.replace(/\/$/, '')
  : '';

function sendJson(res, statusCode, data) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.writeHead(statusCode);
  res.end(JSON.stringify(data));
}

async function handleOcrRequest(body) {
  if (!VISION_API_KEY) {
    return { error: 'Google Cloud Vision API key not configured. Set GOOGLE_CLOUD_VISION_API_KEY.' };
  }
  const { image } = body || {};
  if (!image || typeof image !== 'string') {
    return { error: 'Missing or invalid body: { image: "<base64>" }' };
  }
  const base64 = image.replace(/^data:image\/\w+;base64,/, '');
  const url = `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(VISION_API_KEY)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [
        {
          image: { content: base64 },
          features: [{ type: 'TEXT_DETECTION', maxResults: 1 }],
        },
      ],
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    const msg = data?.error?.message || response.statusText;
    return { error: `Vision API: ${msg}` };
  }
  const text = data?.responses?.[0]?.fullTextAnnotation?.text ?? '';
  return { text: text.trim() };
}

async function handlePaddleOcrRequest(body) {
  if (!PADDLE_OCR_URL) {
    return { error: 'PaddleOCR service not configured. Set PADDLE_OCR_SERVICE_URL (e.g. http://localhost:5000).' };
  }
  const { image } = body || {};
  if (!image || typeof image !== 'string') {
    return { error: 'Missing or invalid body: { image: "<base64>" }' };
  }
  const url = `${PADDLE_OCR_URL}/ocr`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { error: data?.error || response.statusText || 'PaddleOCR request failed' };
  }
  return { text: (data.text ?? '').trim() };
}

const server = http.createServer();

const io = new Server(server, { cors: { origin: '*' } });

server.on('request', (req, res) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === 'POST' && (req.url === '/api/ocr' || req.url === '/api/ocr/')) {
    let buf = '';
    req.on('data', (chunk) => { buf += chunk; });
    req.on('end', () => {
      let body;
      try {
        body = JSON.parse(buf || '{}');
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON body' });
        return;
      }
      handleOcrRequest(body)
        .then((result) => {
          if (result.error) sendJson(res, result.error.includes('not configured') ? 503 : 400, result);
          else sendJson(res, 200, result);
        })
        .catch((err) => sendJson(res, 500, { error: String(err?.message || err) }));
    });
    return;
  }
  if (req.method === 'POST' && (req.url === '/api/ocr-paddle' || req.url === '/api/ocr-paddle/')) {
    let buf = '';
    req.on('data', (chunk) => { buf += chunk; });
    req.on('end', () => {
      let body;
      try {
        body = JSON.parse(buf || '{}');
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON body' });
        return;
      }
      handlePaddleOcrRequest(body)
        .then((result) => {
          if (result.error) sendJson(res, result.error.includes('not configured') ? 503 : 400, result);
          else sendJson(res, 200, result);
        })
        .catch((err) => sendJson(res, 500, { error: String(err?.message || err) }));
    });
    return;
  }
});

io.on('connection', (socket) => {
  socket.on(JOIN_ROOM, (payload) => {
    const sid = payload?.sid;
    if (!sid || typeof sid !== 'string') return;
    const room = String(sid).trim();
    if (!room) return;
    socket.join(room);
  });

  socket.on(SEND_SCAN, (payload) => {
    const sid = payload?.sid;
    if (!sid || typeof sid !== 'string') return;
    const room = String(sid).trim();
    if (!room) return;
    io.to(room).emit(BROADCAST_TO_DASHBOARD, {
      type: payload.type,
      value: payload.value,
      raw: payload.raw,
      timestamp: payload.timestamp,
      sid: room,
    });
  });
});

server.listen(PORT, () => {
  console.log(`Socket server (mobile/dashboard) at http://localhost:${PORT}`);
});
