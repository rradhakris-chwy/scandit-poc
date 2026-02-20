import React, { useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  createSocketClient,
  joinRoom,
  onBroadcastToDashboard,
  type ScanPayload,
} from '@scanning-poc/shared';
import { parseBarcodeToData, type ParsedData } from './gs1Parse';

/** Socket server for mobile ↔ dashboard (packages/socket-server, port 4001) */
const SOCKET_URL =
  typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:4001`
    : 'http://localhost:4001';

const SID = `dashboard-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

type ScanItem = (ScanPayload & { sid?: string }) & {
  id: string;
  /** Frontend-style JSON: upc_gtin, type, batch?, expiry?, serial? (same keys as frontend Dashboard) */
  parsed?: ParsedData | null;
  /** OCR label JSON: { batch_no, lot_no, expiry, upc_gtin? } when value is JSON string */
  labelJson?: { batch_no: string; lot_no: string; expiry: string; upc_gtin?: string } | null;
  /** When OCR raw contains GS1/barcode, decoded for upc_gtin in JSON */
  ocrGs1Parsed?: ParsedData | null;
  parseError?: string;
};

/** Build display JSON with key-name pairs like frontend (upc_gtin, type, batch, expiry, serial). */
function toDisplayJson(data: ParsedData): Record<string, string> {
  const json: Record<string, string> = {
    upc_gtin: data.upc_gtin,
    type: data.type,
  };
  if (data.batch) json.batch = data.batch;
  if (data.expiry) json.expiry = data.expiry;
  if (data.serial) json.serial = data.serial;
  return json;
}

export default function App() {
  const [scans, setScans] = useState<ScanItem[]>([]);
  const [connected, setConnected] = useState(false);
  const socket = useMemo(() => createSocketClient(SOCKET_URL), []);

  useEffect(() => {
    socket.on('connect', () => {
      setConnected(true);
      joinRoom(socket, SID);
    });
    socket.on('disconnect', () => setConnected(false));
    if (socket.connected) joinRoom(socket, SID);
    const unsubscribe = onBroadcastToDashboard(socket, (payload) => {
      const item: ScanItem = {
        ...payload,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      };
      if (payload.type === 'barcode' && payload.value) {
        try {
          item.parsed = parseBarcodeToData(payload.value);
        } catch (e) {
          item.parseError = e instanceof Error ? e.message : String(e);
        }
      }
      if (payload.type === 'ocr' && payload.value) {
        try {
          const parsed = JSON.parse(payload.value) as unknown;
          if (
            parsed &&
            typeof parsed === 'object' &&
            'batch_no' in parsed &&
            'lot_no' in parsed &&
            'expiry' in parsed
          ) {
            item.labelJson = parsed as { batch_no: string; lot_no: string; expiry: string; upc_gtin?: string };
          }
        } catch {
          /* value is plain text, not JSON */
        }
        if (payload.raw && payload.raw.length > 20) {
          try {
            let rawToParse = payload.raw;
            const barcodeLine = payload.raw.match(/^Barcode:\s*(.+)$/m);
            if (barcodeLine && barcodeLine[1].trim().length > 20) {
              rawToParse = barcodeLine[1].trim();
            }
            const gs1 = parseBarcodeToData(rawToParse);
            if (gs1.type === 'GS1_DATAMATRIX' || gs1.type === 'GS1_LINEAR') {
              item.ocrGs1Parsed = gs1;
            }
          } catch {
            /* ignore */
          }
        }
      }
      setScans((prev) => [item, ...prev].slice(0, 200));
    });
    return () => {
      unsubscribe();
      socket.off('connect');
      socket.off('disconnect');
    };
  }, [socket]);

  /** URL to open on phone: mobile-scanner app with this room's sid (dev: port 3002) */
  const mobileScannerUrl =
    typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.hostname}:3002?sid=${encodeURIComponent(SID)}`
      : '';

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>Scanning Dashboard</h1>
        <span style={{ ...styles.badge, ...(connected ? styles.connected : {}) }}>
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      </header>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Scanner link (QR)</h2>
        <p style={styles.hint}>Open this on your phone and join room: {SID}</p>
        <div style={styles.qrWrap}>
          <QRCodeSVG value={mobileScannerUrl || 'https://example.com'} size={220} level="M" />
        </div>
        <p style={styles.mono}>{mobileScannerUrl}</p>
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Live scans</h2>
        <div style={styles.list}>
          {scans.length === 0 && (
            <p style={styles.empty}>No scans yet. Use the mobile scanner with sid={SID}</p>
          )}
          {scans.map((item) => (
            <div key={item.id} style={styles.card}>
              <div style={styles.cardRow}>
                <span style={styles.type}>{item.type}</span>
                {item.sid && <span style={styles.sid}>{item.sid}</span>}
              </div>
              {item.type === 'ocr' ? (
                <>
                  <div style={styles.ocrLabel}>OCR output</div>
                  <pre style={styles.ocrOutput}>
                    {item.raw || item.value || '—'}
                  </pre>
                  {(item.labelJson || item.ocrGs1Parsed) && (
                    <>
                      <div style={styles.ocrLabel}>JSON</div>
                      <pre style={styles.parsed}>
                        {JSON.stringify(
                          {
                            ...(item.labelJson || {}),
                            ...(item.ocrGs1Parsed?.upc_gtin && { upc_gtin: item.ocrGs1Parsed.upc_gtin }),
                          },
                          null,
                          2
                        )}
                      </pre>
                    </>
                  )}
                </>
              ) : (
                <>
                  <div style={styles.value}>{item.value || item.raw || '—'}</div>
                  {item.parsed && (
                    <pre style={styles.parsed}>
                      {JSON.stringify(toDisplayJson(item.parsed), null, 2)}
                    </pre>
                  )}
                </>
              )}
              {item.parseError && (
                <span style={styles.parseError}>GS1: {item.parseError}</span>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 900,
    margin: '0 auto',
    padding: 24,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 32,
  },
  title: { margin: 0, fontSize: 28, fontWeight: 600 },
  badge: {
    padding: '4px 10px',
    borderRadius: 6,
    fontSize: 12,
    background: '#475569',
    color: '#94a3b8',
  },
  connected: { background: '#065f46', color: '#6ee7b7' },
  section: { marginBottom: 32 },
  sectionTitle: { margin: '0 0 12px', fontSize: 18, fontWeight: 600 },
  hint: { margin: '0 0 12px', color: '#94a3b8', fontSize: 14 },
  qrWrap: {
    padding: 16,
    background: '#fff',
    borderRadius: 12,
    display: 'inline-block',
    marginBottom: 12,
  },
  mono: { fontFamily: 'ui-monospace, monospace', fontSize: 12, wordBreak: 'break-all', margin: 0 },
  list: { display: 'flex', flexDirection: 'column', gap: 12 },
  empty: { color: '#64748b', margin: 0 },
  card: {
    padding: 16,
    background: '#1e293b',
    borderRadius: 10,
    border: '1px solid #334155',
  },
  cardRow: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 },
  type: { fontSize: 12, color: '#38bdf8', textTransform: 'uppercase' },
  sid: { fontSize: 11, color: '#64748b' },
  value: { fontFamily: 'ui-monospace, monospace', fontSize: 14, wordBreak: 'break-all', marginBottom: 8 },
  ocrLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: '#94a3b8',
    marginTop: 12,
    marginBottom: 4,
  },
  ocrOutput: {
    margin: 0,
    padding: 12,
    background: '#0f172a',
    borderRadius: 6,
    fontSize: 12,
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    border: '1px solid #334155',
    marginBottom: 8,
  },
  parsed: {
    margin: 0,
    padding: 12,
    background: '#0f172a',
    borderRadius: 6,
    fontSize: 12,
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
  },
  parseError: { fontSize: 12, color: '#f87171' },
};
