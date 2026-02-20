import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { createWorker } from 'tesseract.js';
import {
  createSocketClient,
  joinRoom,
  sendScan,
  type ScanPayload,
} from '@scanning-poc/shared';
import { extractLabelFromOcr } from './labelFormats';
import { LabelCaptureScan } from './LabelCaptureScan';

/** Socket server URL: use ?socket=https://... for ngrok/HTTPS, else hostname:4001 */
function getSocketUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:4001';
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get('socket');
  if (fromQuery && (fromQuery.startsWith('http://') || fromQuery.startsWith('https://')))
    return fromQuery.replace(/\/$/, '');
  return `${window.location.protocol}//${window.location.hostname}:4001`;
}

function getSidFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get('sid') || params.get('room') || null;
}

export default function App() {
  const [sid, setSid] = useState<string | null>(() => getSidFromUrl());
  const [manualSid, setManualSid] = useState('');
  const [mode, setMode] = useState<'barcode' | 'ocr' | null>(null);
  const [joinScanActive, setJoinScanActive] = useState(false);
  const [joinScanError, setJoinScanError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [lastScan, setLastScan] = useState<string>('');
  const [ocrProvider, setOcrProvider] = useState<'tesseract' | 'vision' | 'paddle'>('tesseract');
  const [showScanditLabel, setShowScanditLabel] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const joinScannerRef = useRef<Html5Qrcode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoOcrRef = useRef<HTMLVideoElement | null>(null);
  const socketRef = useRef(createSocketClient(getSocketUrl()));
  const onBarcodeSuccessRef = useRef<(decodedText: string) => void>(() => {});
  /** Single-scan: ignore further callbacks until user starts scan again */
  const barcodeScanDoneRef = useRef(false);
  const ocrScanDoneRef = useRef(false);

  useEffect(() => {
    const socket = socketRef.current;
    socket.on('connect', () => setStatus('Connected'));
    socket.on('disconnect', () => setStatus('Disconnected'));
    return () => {
      socket.off('connect');
      socket.off('disconnect');
    };
  }, []);

  useEffect(() => {
    return () => {
      if (scannerRef.current) scannerRef.current.clear().catch(() => {});
      if (joinScannerRef.current) joinScannerRef.current.clear().catch(() => {});
    };
  }, []);

  /** Preload Scandit SDK when user has joined a room so "Scan label" opens quickly */
  useEffect(() => {
    if (!sid) return;
    const preload = async () => {
      try {
        await Promise.all([
          import('@scandit/web-datacapture-core'),
          import('@scandit/web-datacapture-barcode'),
          import('@scandit/web-datacapture-label'),
        ]);
      } catch {
        // ignore; will load again when Scan label is opened
      }
    };
    preload();
  }, [sid]);

  /** Extract sid from dashboard QR URL (e.g. http://host:3002?sid=xxx) or plain text */
  function parseSidFromScannedValue(decodedText: string): string | null {
    const t = decodedText.trim();
    if (!t) return null;
    try {
      const url = new URL(t);
      const s = url.searchParams.get('sid') || url.searchParams.get('room');
      if (s) return s;
    } catch {
      // not a URL
    }
    return t.length > 0 && t.length < 200 ? t : null;
  }

  const startJoinScan = () => {
    setJoinScanError(null);
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setJoinScanError(
        'Camera requires HTTPS on this device. Use "Enter session ID" below with the ID shown on the dashboard, or open this page over HTTPS.'
      );
      setJoinScanActive(true);
      return;
    }
    setStatus('Requesting camera…');
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((stream) => {
        stream.getTracks().forEach((t) => t.stop());
        setJoinScanActive(true);
      })
      .catch((e) => {
        const msg = e?.message || String(e);
        setJoinScanError(
          msg.includes('Permission') || msg.includes('NotAllowed') || msg.includes('secure')
            ? 'Camera blocked. Allow camera in browser settings, or enter session ID manually. On Android, camera may only work over HTTPS.'
            : `Camera: ${msg}`
        );
        setJoinScanActive(true);
      });
  };

  useEffect(() => {
    if (!joinScanActive) return;
    const el = document.getElementById('qr-join-reader');
    if (!el) return;
    setJoinScanError(null);
    const timer = setTimeout(() => {
      const scanner = new Html5Qrcode('qr-join-reader');
      joinScannerRef.current = scanner;
      setStatus('Starting camera…');
      scanner
        .start(
          { facingMode: 'environment' },
          { fps: 8, qrbox: { width: 260, height: 260 } },
          (decodedText) => {
            const extracted = parseSidFromScannedValue(decodedText);
            if (extracted) {
              scanner.stop().then(() => scanner.clear()).catch(() => {});
              joinScannerRef.current = null;
              setSid(extracted);
              setJoinScanActive(false);
              setJoinScanError(null);
              setStatus(`Joined: ${extracted}`);
            }
          },
          () => {}
        )
        .then(() => setStatus('Point at the dashboard QR code'))
        .catch((e) => {
          const msg = e instanceof Error ? e.message : String(e);
          setJoinScanError(
            msg.includes('Permission') || msg.includes('NotAllowed') || msg.includes('secure')
              ? 'Camera not available. Enter session ID manually. On Android, use HTTPS for camera.'
              : msg
          );
          joinScannerRef.current = null;
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      if (joinScannerRef.current) {
        joinScannerRef.current.stop().then(() => joinScannerRef.current?.clear()).catch(() => {});
        joinScannerRef.current = null;
      }
    };
  }, [joinScanActive]);

  useEffect(() => {
    if (!sid) return;
    joinRoom(socketRef.current, sid);
    setStatus(`Joined room: ${sid}`);
  }, [sid]);

  const emitScan = (payload: ScanPayload) => {
    if (!sid) return;
    sendScan(socketRef.current, sid, {
      ...payload,
      timestamp: Date.now(),
    });
    setLastScan(payload.value);
  };

  /** Scandit Label Capture result: same format as Tesseract OCR for dashboard */
  const handleScanditLabelResult = (labelJson: { batch_no: string; lot_no: string; expiry: string; upc_gtin?: string; serial?: string }, raw: string) => {
    const valueToSend = JSON.stringify(labelJson);
    emitScan({ type: 'ocr', value: valueToSend, raw: raw || '(Scandit label capture)' });
    const summary = [
      labelJson.batch_no && `Batch: ${labelJson.batch_no}`,
      labelJson.lot_no && `Lot: ${labelJson.lot_no}`,
      labelJson.expiry && `Exp: ${labelJson.expiry}`,
      labelJson.upc_gtin && `UPC: ${labelJson.upc_gtin}`,
      labelJson.serial && `Serial: ${labelJson.serial}`,
    ]
      .filter(Boolean)
      .join(', ');
    setLastScan(summary || 'Sent');
    setStatus('Scan complete ✓ — sent to dashboard');
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(100);
  };

  const startBarcode = () => {
    if (scannerRef.current) return;
    setMode('barcode');
    setStatus('Starting camera…');
  };

  const onBarcodeSuccess = (decodedText: string) => {
    if (!sid) return;
    if (barcodeScanDoneRef.current) return;
    barcodeScanDoneRef.current = true;
    sendScan(socketRef.current, sid, {
      type: 'barcode',
      value: decodedText,
      raw: decodedText,
      timestamp: Date.now(),
    });
    setLastScan(decodedText);
    setStatus(`Sent: ${decodedText}`);
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(100);
    setMode(null);
  };
  onBarcodeSuccessRef.current = onBarcodeSuccess;

  useEffect(() => {
    if (mode !== 'barcode') return;
    barcodeScanDoneRef.current = false;
    const el = document.getElementById('qr-reader');
    if (!el) return;
    const scanner = new Html5Qrcode('qr-reader');
    scannerRef.current = scanner;
    setStatus('Starting camera…');
    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 180, height: 110 } },
        (decodedText) => onBarcodeSuccessRef.current(decodedText),
        () => {}
      )
      .then(() => setStatus('Point at a barcode or QR code'))
      .catch((e) => {
        setStatus(`Camera error: ${e instanceof Error ? e.message : String(e)}`);
        scannerRef.current = null;
      });
    return () => {
      scanner
        .stop()
        .then(() => scanner.clear())
        .catch(() => {})
        .finally(() => {
          scannerRef.current = null;
        });
    };
  }, [mode]);

  const stopBarcode = () => {
    setMode(null);
    setStatus(sid ? `Joined: ${sid}` : 'Enter room');
  };

  const startOcr = () => {
    setMode('ocr');
    setStatus('Preparing OCR…');
  };

  /** Healthcare labels: NDC, lot, expiry, serial — keep only sensible chars and filter garbage lines */
  const filterHealthcareOcrText = (raw: string): string => {
    const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const kept: string[] = [];
    for (const line of lines) {
      if (line.length < 2) continue;
      const looksLikeLotOrExp =
        /Lot\s*No\.?\s*:?\s*\d+/i.test(line) || /Exp\.?\s*:?\s*\d/i.test(line);
      const hasWord = /\d{2,}|[A-Za-z]{3,}/.test(line);
      const mostlySensible =
        (line.match(/[0-9A-Za-z\-\/.,:()@# ]/g)?.length ?? 0) / line.length > 0.6;
      if ((hasWord && mostlySensible) || looksLikeLotOrExp) kept.push(line);
    }
    return kept.join('\n').trim();
  };

  /** Extract Lot and Expiry from label text (e.g. "Lot No.: 20054138", "Exp.: 2027-02") */
  const parseLabelLotAndExpiry = (text: string): { lot?: string; expiry?: string; product?: string } => {
    const out: { lot?: string; expiry?: string; product?: string } = {};
    const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const lotMatch = text.match(/Lot\s*No\.?\s*:?\s*(\d[\d\s-]*\d|\d+)/i);
    if (lotMatch) out.lot = lotMatch[1].replace(/\s/g, '').trim();
    const expMatch = text.match(/Exp\.?\s*:?\s*(\d{4}-\d{2}(-\d{2})?|\d{2}\/\d{2}\/\d{4})/i);
    if (expMatch) out.expiry = expMatch[1].trim();
    const firstLine = lines[0];
    if (firstLine && /^[A-Z0-9]{2,10}$/i.test(firstLine) && !out.lot && !out.expiry)
      out.product = firstLine;
    return out;
  };

  /** Fix common OCR confusions in batch/product codes: 8↔B, 2↔Z (e.g. 8027 → B0Z7) */
  const correctBatchOcr = (s: string): string => {
    return s
      .replace(/8/g, 'B')
      .replace(/2/g, 'Z')
      .toUpperCase();
  };

  /** Build final label JSON: use format registry + optional OCR correction for batch (e.g. 8027→B0Z7) */
  const ocrTextToLabelJson = (ocrText: string): { batch_no: string; lot_no: string; expiry: string } => {
    const out = extractLabelFromOcr(ocrText);
    if (out.batch_no && /^\d{3,5}$/.test(out.batch_no))
      out.batch_no = correctBatchOcr(out.batch_no);
    return out;
  };

  useEffect(() => {
    if (mode !== 'ocr' || !sid) return;
    ocrScanDoneRef.current = false;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let timeoutId: ReturnType<typeof setTimeout>;
    let recognizeInProgress = false;
    const OCR_CROP_W_RATIO = 0.5;
    const OCR_CROP_H_RATIO = 0.2;

    const workerPromise =
      ocrProvider === 'tesseract'
        ? (async () => {
            const w = await createWorker('eng', 1, { logger: () => {} });
            await w.setParameters({
              tessedit_char_whitelist:
                '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz -/.,:@#()\n',
              tessedit_pageseg_mode: 6,
            });
            return w;
          })()
        : null;

    const runCapture = () => {
      if (cancelled || recognizeInProgress || ocrScanDoneRef.current) return;
      const video = videoOcrRef.current;
      if (!video || !video.videoWidth || !video.videoHeight || video.readyState < 2) return;

      recognizeInProgress = true;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const cw = Math.round(vw * OCR_CROP_W_RATIO);
      const ch = Math.round(vh * OCR_CROP_H_RATIO);
      const sx = (vw - cw) / 2;
      const sy = (vh - ch) / 2;
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(video, sx, sy, cw, ch, 0, 0, cw, ch);

      const onOcrText = (raw: string) => {
        if (cancelled || ocrScanDoneRef.current) return;
        ocrScanDoneRef.current = true;
        const t = filterHealthcareOcrText(raw);
        const labelJson = t ? ocrTextToLabelJson(t) : { batch_no: '', lot_no: '', expiry: '' };
        const valueToSend = JSON.stringify(labelJson);
        const rawForDashboard = raw.trim() || t || '(no text from OCR)';
        emitScan({ type: 'ocr', value: valueToSend, raw: rawForDashboard });
        const summary = t
          ? [
              labelJson.batch_no && `Batch: ${labelJson.batch_no}`,
              labelJson.lot_no && `Lot: ${labelJson.lot_no}`,
              labelJson.expiry && `Exp: ${labelJson.expiry}`,
            ]
              .filter(Boolean)
              .join(', ')
          : null;
        setLastScan(summary || raw.slice(0, 60) || 'Sent');
        setStatus(raw.trim() ? 'Scan complete ✓ — sent to dashboard' : 'No text found — check dashboard');
        setMode(null);
      };

      canvas.toBlob(
        (blob) => {
          if (cancelled || !blob) {
            recognizeInProgress = false;
            return;
          }
          if (ocrProvider === 'vision' || ocrProvider === 'paddle') {
            const baseUrl = getSocketUrl();
            const endpoint = ocrProvider === 'vision' ? '/api/ocr' : '/api/ocr-paddle';
            const label = ocrProvider === 'vision' ? 'Vision' : 'PaddleOCR';
            const reader = new FileReader();
            reader.onload = () => {
              const dataUrl = typeof reader.result === 'string' ? reader.result : '';
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 45000);
              fetch(`${baseUrl}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: dataUrl }),
                signal: controller.signal,
              })
                .then((r) => r.json())
                .then((data) => {
                  if (cancelled || ocrScanDoneRef.current) return;
                  if (data.error) {
                    setStatus(`${label}: ${data.error}`);
                    setMode(null);
                    return;
                  }
                  onOcrText((data.text ?? '').trim());
                })
                .catch((err) => {
                  if (!cancelled) {
                    const msg = err?.name === 'AbortError' ? 'Request timed out (45s)' : (err instanceof Error ? err.message : 'Error');
                    setStatus(`${label}: ${msg}`);
                    setMode(null);
                  }
                })
                .finally(() => {
                  clearTimeout(timeoutId);
                  recognizeInProgress = false;
                });
            };
            reader.onerror = () => {
              if (!cancelled) {
                setStatus('Failed to read image');
                setMode(null);
              }
              recognizeInProgress = false;
            };
            reader.readAsDataURL(blob);
            return;
          }
          if (workerPromise) {
            workerPromise
              .then((worker) => worker.recognize(blob))
              .then(({ data: { text } }) => {
                if (cancelled || ocrScanDoneRef.current) return;
                onOcrText(text?.trim() ?? '');
              })
              .catch((err) => {
                if (!cancelled) {
                  setStatus(`OCR: ${err instanceof Error ? err.message : 'Error'}`);
                  setMode(null);
                }
              })
              .finally(() => {
                recognizeInProgress = false;
              });
          }
        },
        'image/png',
        0.9
      );
    };

    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        streamRef.current = s;
        const video = videoOcrRef.current;
        if (!video) return;
        video.srcObject = s;
        video.autoplay = true;
        video.playsInline = true;
        video.muted = true;
        video.play().then(() => {
          if (cancelled) return;
          setStatus('Position label in blue frame — capturing once…');
        });

        const startWhenReady = () => {
          if (cancelled) return;
          if (video.readyState >= 2 && video.videoWidth > 0) {
            runCapture();
          } else {
            timeoutId = setTimeout(startWhenReady, 200);
          }
        };
        startWhenReady();
      })
      .catch((e) => {
        if (!cancelled) setStatus(`OCR error: ${e instanceof Error ? e.message : String(e)}`);
      });

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (ocrProvider === 'tesseract') workerPromise?.then((w) => w.terminate());
    };
  }, [mode, sid, ocrProvider]);

  const stopOcr = () => {
    setMode(null);
    setStatus(sid ? `Joined: ${sid}` : 'Enter room');
  };

  const submitManualSid = () => {
    const s = manualSid.trim();
    if (s) setSid(s);
  };

  if (!sid) {
    return (
      <div style={styles.container}>
        <h1 style={styles.title}>Mobile Scanner</h1>
        {!joinScanActive ? (
          <>
            <p style={styles.hint}>Enter session ID or scan the dashboard QR code</p>
            <input
              type="text"
              placeholder="Session ID"
              value={manualSid}
              onChange={(e) => setManualSid(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitManualSid()}
              style={styles.input}
              autoCapitalize="off"
              autoComplete="off"
            />
            <button type="button" onClick={submitManualSid} style={styles.button}>
              Join room
            </button>
            <button
              type="button"
              onClick={startJoinScan}
              style={styles.buttonSecondary}
            >
              Scan QR to join
            </button>
          </>
        ) : (
          <>
            {joinScanError ? (
              <div style={styles.errorBox}>
                <p style={styles.errorText}>{joinScanError}</p>
                <p style={styles.hint}>Enter the session ID from the dashboard below instead.</p>
              </div>
            ) : (
              <>
                <p style={styles.hint}>{status || 'Point at the dashboard QR code'}</p>
                <div
                  id="qr-join-reader"
                  style={{
                    width: '100%',
                    maxWidth: 320,
                    margin: '0 auto',
                    minHeight: 280,
                  }}
                />
              </>
            )}
            <button
              type="button"
              onClick={() => { setJoinScanActive(false); setJoinScanError(null); }}
              style={styles.buttonDanger}
            >
              Cancel
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.badge}>{status}</span>
        <span style={styles.sid}>Room: {sid}</span>
      </div>

      {mode === 'barcode' && (
        <>
          <p style={styles.hint}>Point at a barcode or QR — one scan, then camera stops</p>
          {lastScan && (
            <p style={styles.lastScanBarcode}>Last: {lastScan}</p>
          )}
          <div
            id="qr-reader"
            style={{
              width: '100%',
              maxWidth: 340,
              margin: '0 auto',
              minHeight: 220,
            }}
          />
          <button type="button" onClick={stopBarcode} style={styles.buttonDanger}>
            Stop camera
          </button>
        </>
      )}

      {mode === 'ocr' && (
        <>
          <p style={styles.hint}>Position label in the blue frame — one capture, then done</p>
          <div style={styles.videoWrap}>
            <video
              ref={videoOcrRef}
              autoPlay
              playsInline
              muted
              style={styles.ocrVideo}
            />
            <div style={styles.ocrOverlayTop} aria-hidden />
            <div style={styles.ocrOverlayBottom} aria-hidden />
            <div style={styles.ocrOverlayLeft} aria-hidden />
            <div style={styles.ocrOverlayRight} aria-hidden />
            <div style={styles.ocrFocusFrame} aria-hidden />
          </div>
          <button type="button" onClick={stopOcr} style={styles.buttonDanger}>
            Stop OCR
          </button>
        </>
      )}

      {!mode && (
        <>
          {lastScan && <p style={styles.lastScan}>Last: {lastScan}</p>}
          <div style={styles.ocrProviderRow}>
            <span style={styles.ocrProviderLabel}>OCR:</span>
            <button
              type="button"
              onClick={() => setOcrProvider('tesseract')}
              style={ocrProvider === 'tesseract' ? styles.ocrProviderBtnActive : styles.ocrProviderBtn}
            >
              Device (Tesseract)
            </button>
            <button
              type="button"
              onClick={() => setOcrProvider('vision')}
              style={ocrProvider === 'vision' ? styles.ocrProviderBtnActive : styles.ocrProviderBtn}
            >
              Cloud (Vision)
            </button>
            <button
              type="button"
              onClick={() => setOcrProvider('paddle')}
              style={ocrProvider === 'paddle' ? styles.ocrProviderBtnActive : styles.ocrProviderBtn}
            >
              Cloud (PaddleOCR)
            </button>
          </div>
          <button type="button" onClick={startBarcode} style={styles.button}>
            Scan barcode / QR (one at a time)
          </button>
          <button type="button" onClick={startOcr} style={styles.button}>
            Capture text (OCR) — one at a time
          </button>
          <button
            type="button"
            onClick={() => setShowScanditLabel(true)}
            style={styles.buttonScandit}
          >
            Scan label (Scandit) — batch/lot/expiry
          </button>
        </>
      )}

      {showScanditLabel && (
        <LabelCaptureScan
          onResult={handleScanditLabelResult}
          onClose={() => setShowScanditLabel(false)}
          continuous
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: 16,
    paddingTop: 'env(safe-area-inset-top, 16px)',
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 16,
  },
  header: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    maxWidth: 400,
  },
  title: { fontSize: 22, margin: 0, fontWeight: 600 },
  hint: { margin: 0, color: '#a1a1aa', fontSize: 14 },
  badge: { fontSize: 12, color: '#a1a1aa' },
  sid: { fontSize: 12, color: '#71717a' },
  input: {
    width: '100%',
    maxWidth: 320,
    padding: 12,
    fontSize: 16,
    border: '1px solid #3f3f46',
    borderRadius: 8,
    background: '#18181b',
    color: '#e4e4e7',
  },
  button: {
    padding: '12px 24px',
    fontSize: 16,
    background: '#3b82f6',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    width: '100%',
    maxWidth: 320,
  },
  buttonSecondary: {
    padding: '12px 24px',
    fontSize: 16,
    background: 'transparent',
    color: '#3b82f6',
    border: '2px solid #3b82f6',
    borderRadius: 8,
    cursor: 'pointer',
    width: '100%',
    maxWidth: 320,
  },
  buttonDanger: {
    padding: '12px 24px',
    fontSize: 16,
    background: '#dc2626',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    width: '100%',
    maxWidth: 320,
  },
  errorBox: {
    padding: 16,
    marginBottom: 8,
    background: 'rgba(220, 38, 38, 0.15)',
    border: '1px solid #dc2626',
    borderRadius: 8,
    width: '100%',
    maxWidth: 320,
  },
  errorText: { margin: '0 0 8px', fontSize: 14, color: '#fca5a5', lineHeight: 1.4 },
  lastScan: { margin: 0, fontSize: 12, color: '#a1a1aa', wordBreak: 'break-all' },
  ocrProviderRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    width: '100%',
    maxWidth: 320,
  },
  ocrProviderLabel: { fontSize: 14, color: '#a1a1aa' },
  ocrProviderBtn: {
    padding: '8px 12px',
    fontSize: 13,
    background: '#27272a',
    color: '#a1a1aa',
    border: '1px solid #3f3f46',
    borderRadius: 6,
    cursor: 'pointer',
  },
  ocrProviderBtnActive: {
    padding: '8px 12px',
    fontSize: 13,
    background: '#3b82f6',
    color: '#fff',
    border: '1px solid #3b82f6',
    borderRadius: 6,
    cursor: 'pointer',
  },
  buttonScandit: {
    padding: '12px 24px',
    fontSize: 16,
    background: '#059669',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    width: '100%',
    maxWidth: 320,
  },
  lastScanBarcode: {
    margin: 0,
    fontSize: 14,
    color: '#6ee7b7',
    wordBreak: 'break-all',
    fontWeight: 600,
  },
  videoWrap: {
    position: 'relative' as const,
    width: '100%',
    maxWidth: 400,
    borderRadius: 12,
    overflow: 'hidden',
    background: '#000',
  },
  ocrVideo: {
    display: 'block',
    width: '100%',
    height: 'auto',
    objectFit: 'cover',
    minHeight: 240,
  },
  ocrOverlayTop: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    height: '40%',
    background: 'rgba(30, 64, 175, 0.55)',
    pointerEvents: 'none',
  },
  ocrOverlayBottom: {
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    height: '40%',
    background: 'rgba(30, 64, 175, 0.55)',
    pointerEvents: 'none',
  },
  ocrOverlayLeft: {
    position: 'absolute' as const,
    top: '40%',
    left: 0,
    width: '25%',
    height: '20%',
    background: 'rgba(30, 64, 175, 0.55)',
    pointerEvents: 'none',
  },
  ocrOverlayRight: {
    position: 'absolute' as const,
    top: '40%',
    right: 0,
    width: '25%',
    height: '20%',
    background: 'rgba(30, 64, 175, 0.55)',
    pointerEvents: 'none',
  },
  ocrFocusFrame: {
    position: 'absolute' as const,
    top: '40%',
    left: '25%',
    width: '50%',
    height: '20%',
    border: '3px solid rgba(59, 130, 246, 0.95)',
    borderRadius: 8,
    pointerEvents: 'none',
    boxSizing: 'border-box' as const,
  },
};
