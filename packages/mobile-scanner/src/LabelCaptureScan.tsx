/**
 * Scandit Smart Label Capture for healthcare labels.
 * Captures Batch no, Lot no, Expiry Date (and optional Barcode) and reports
 * { batch_no, lot_no, expiry, upc_gtin? }. No Tesseract fallback—Scandit only.
 * @see https://docs.scandit.com/sdks/web/label-capture/intro/
 * @see https://docs.scandit.com/sdks/web/label-capture/label-definitions/
 */

import React, { useEffect, useRef, useState } from 'react';
import { SCANDIT_FIELD_DEFINITIONS } from './labelPatterns';
import { scanditLabelFieldsToLabelJson, type LabelJson } from './scanditLabelToOcrFormat';

declare const __SCANDIT_LICENSE_KEY__: string;
const SCANDIT_LICENSE_KEY = typeof __SCANDIT_LICENSE_KEY__ !== 'undefined' ? __SCANDIT_LICENSE_KEY__ : '-- ENTER YOUR SCANDIT LICENSE KEY HERE --';

export type LabelCaptureScanProps = {
  onResult: (labelJson: LabelJson, raw: string) => void;
  onClose: () => void;
  /** When true, stay open after each scan for repeated scans; user closes via Close button */
  continuous?: boolean;
};

const CAPTURE_COOLDOWN_MS = 1800;
const LABEL_STABILITY_MS = 520;

export function LabelCaptureScan({ onResult, onClose, continuous = false }: LabelCaptureScanProps) {
  const viewRef = useRef<HTMLDivElement | null>(null);
  const lastCaptureTimeRef = useRef<number>(0);
  const stabilityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingLabelRef = useRef<{ fields: Array<{ name: string; text?: string | null; date?: { day: number | null; month: number | null; year: number | null } | null; barcode?: { data?: string } | null }> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastScanToast, setLastScanToast] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let labelCapture: Awaited<ReturnType<typeof import('@scandit/web-datacapture-label').LabelCapture.forContext>> | null = null;
    let camera: Awaited<ReturnType<typeof import('@scandit/web-datacapture-core').Camera.pickBestGuess>> | null = null;
    let context: Awaited<ReturnType<typeof import('@scandit/web-datacapture-core').DataCaptureContext.forLicenseKey>> | null = null;
    let view: InstanceType<typeof import('@scandit/web-datacapture-core').DataCaptureView> | null = null;

    const init = async () => {
      try {
        const {
          Camera,
          CameraSettings,
          DataCaptureContext,
          DataCaptureView,
          FrameSourceState,
          RectangularViewfinder,
          RectangularViewfinderLineStyle,
          RectangularViewfinderStyle,
          VideoResolution,
        } = await import('@scandit/web-datacapture-core');
        const { Symbology } = await import('@scandit/web-datacapture-barcode');
        const {
          CustomBarcodeBuilder,
          CustomTextBuilder,
          ExpiryDateTextBuilder,
          LabelCapture,
          LabelCaptureBasicOverlay,
          labelCaptureLoader,
          LabelCaptureSettings,
          LabelDateComponentFormat,
          LabelDateFormat,
          LabelDefinitionBuilder,
        } = await import('@scandit/web-datacapture-label');

        if (cancelled || !viewRef.current) return;

        view = new DataCaptureView();
        view.connectToElement(viewRef.current);
        view.showProgressBar();

        const libraryLocation = new URL('library/engine', document.baseURI).toString();
        context = await DataCaptureContext.forLicenseKey(SCANDIT_LICENSE_KEY, {
          libraryLocation,
          moduleLoaders: [labelCaptureLoader()],
        });
        await view.setContext(context);

        camera = Camera.pickBestGuess();
        await context.setFrameSource(camera);
        const recommendedCameraSettings = LabelCapture.createRecommendedCameraSettings();
        const cameraSettings = new CameraSettings(recommendedCameraSettings);
        cameraSettings.preferredResolution = VideoResolution.FullHD;
        await camera.applySettings(cameraSettings);
        await camera.switchToDesiredState(FrameSourceState.On);
        view.hideProgressBar();

        let builder = new LabelDefinitionBuilder().addCustomBarcode(
          await new CustomBarcodeBuilder()
            .isOptional(true)
            .setSymbologies([
              Symbology.EAN13UPCA,
              Symbology.Code128,
              Symbology.QR,
              Symbology.DataMatrix,
              Symbology.GS1DatabarExpanded,
            ])
            .build('Barcode')
        );

        for (const def of SCANDIT_FIELD_DEFINITIONS) {
          const textBuilder = new CustomTextBuilder()
            .setValueRegexes(def.valueRegexes)
            .isOptional(def.optional);
          if (def.anchorRegexes.length > 0) {
            if (def.anchorRegexes.length === 1)
              textBuilder.setAnchorRegex(new RegExp(def.anchorRegexes[0], 'i'));
            else textBuilder.setAnchorRegexes(def.anchorRegexes);
          } else {
            textBuilder.setAnchorRegexes([]);
          }
          builder = builder.addCustomText(
            await textBuilder.build(def.scanditFieldName)
          );
        }

        builder = builder.addExpiryDateText(
          await new ExpiryDateTextBuilder()
            .isOptional(true)
            .setLabelDateFormat(new LabelDateFormat(LabelDateComponentFormat.MDY))
            .build('Expiry Date')
        );

        const labelDef = await builder.build('HealthcareLabel');
        const settings = await LabelCaptureSettings.fromLabelDefinitions([labelDef]);
        labelCapture = await LabelCapture.forContext(context, settings);
        await context.addMode(labelCapture);

        const overlay = await LabelCaptureBasicOverlay.withLabelCaptureForView(labelCapture, view);
        const viewfinder = new RectangularViewfinder(RectangularViewfinderStyle.Square, RectangularViewfinderLineStyle.Light);
        await overlay.setViewfinder(viewfinder);
        await overlay.setShouldShowScanAreaGuides(true);

        let resultSent = false;
        const UDI_STABILITY_MS = 280;

        const processLabel = async () => {
          const labelToSend = pendingLabelRef.current;
          if (cancelled || resultSent || !labelCapture || !context || !labelToSend?.fields?.length) return;
          resultSent = true;
          lastCaptureTimeRef.current = Date.now();
          if (stabilityTimerRef.current) {
            clearTimeout(stabilityTimerRef.current);
            stabilityTimerRef.current = null;
          }
          pendingLabelRef.current = null;

          await labelCapture!.setEnabled(false);
          if (!continuous) {
            await camera!.switchToDesiredState(FrameSourceState.Standby);
            await new Promise((r) => setTimeout(r, UDI_STABILITY_MS));
          } else {
            await new Promise((r) => setTimeout(r, UDI_STABILITY_MS));
          }

          if (cancelled) return;

          const rawFields = labelToSend.fields.map((f: { name: string; text?: string | null; date?: { day: number | null; month: number | null; year: number | null } | null; barcode?: { data?: string } | null }) => ({
            name: f.name,
            text: f.text ?? null,
            date: f.date ? { day: f.date.day, month: f.date.month, year: f.date.year } : null,
            barcode: f.barcode ? { data: f.barcode.data } : null,
          }));
          const { labelJson, raw } = scanditLabelFieldsToLabelJson(rawFields);

          onResult(labelJson, raw);
          if (continuous) {
            setLastScanToast(true);
            setTimeout(() => setLastScanToast(false), 2500);
            resultSent = false;
            try {
              await labelCapture!.setEnabled(true);
            } catch (_) {}
          } else {
            onClose();
          }
        };

        labelCapture.addListener({
          didUpdateSession: (_mode: unknown, session: { capturedLabels: Array<{ isComplete: boolean; fields: unknown[] }> }) => {
            if (cancelled || resultSent || !labelCapture || !context) return;
            if (continuous && Date.now() - lastCaptureTimeRef.current < CAPTURE_COOLDOWN_MS) return;

            const completeLabels = session.capturedLabels.filter((l) => l.isComplete && l.fields.length > 0);
            if (completeLabels.length === 0) return;

            const best = completeLabels.reduce((a, b) => (b.fields.length >= a.fields.length ? b : a));
            const currentPending = pendingLabelRef.current;
            if (!currentPending || best.fields.length >= currentPending.fields.length) {
              pendingLabelRef.current = best as typeof pendingLabelRef.current;
            }

            if (stabilityTimerRef.current) clearTimeout(stabilityTimerRef.current);
            stabilityTimerRef.current = setTimeout(() => {
              stabilityTimerRef.current = null;
              processLabel();
            }, LABEL_STABILITY_MS);
          },
        });

        if (!cancelled) {
          setLoading(false);
          await labelCapture.setEnabled(true);
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
          setLoading(false);
        }
      }
    };

    init();

    return () => {
      cancelled = true;
      if (stabilityTimerRef.current) {
        clearTimeout(stabilityTimerRef.current);
        stabilityTimerRef.current = null;
      }
      (async () => {
        if (camera) {
          const { FrameSourceState } = await import('@scandit/web-datacapture-core');
          await camera.switchToDesiredState(FrameSourceState.Off);
        }
        if (labelCapture) await labelCapture.setEnabled(false);
        if (view) view.detachFromElement();
        if (context) await context.dispose();
      })();
    };
  }, [onResult, onClose, continuous]);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>Scan label (Scandit)</span>
        <button type="button" onClick={onClose} style={styles.closeBtn}>
          Close
        </button>
      </div>
      {continuous && lastScanToast && (
        <div style={styles.toast}>Scanned. Point at next label or tap Close.</div>
      )}
      <div ref={viewRef} style={styles.view} />
      {loading && (
        <div style={styles.loading}>
          <p>Initializing Scandit SDK…</p>
        </div>
      )}
      {error && (
        <div style={styles.error}>
          <p>{error}</p>
          <p style={styles.hint}>Set SCANDIT_LICENSE_KEY in .env or environment.</p>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed',
    inset: 0,
    backgroundColor: '#18181b',
    display: 'flex',
    flexDirection: 'column',
    zIndex: 100,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    backgroundColor: '#27272a',
  },
  title: { margin: 0, fontSize: 18, fontWeight: 600, color: '#fff' },
  closeBtn: {
    padding: '8px 16px',
    fontSize: 14,
    background: '#dc2626',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
  },
  toast: {
    padding: '10px 12px',
    textAlign: 'center',
    backgroundColor: 'rgba(34,197,94,0.2)',
    color: '#86efac',
    fontSize: 14,
  },
  view: {
    flex: 1,
    position: 'relative',
    minHeight: 200,
  },
  loading: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    color: '#fff',
  },
  error: {
    padding: 16,
    margin: 16,
    background: 'rgba(220,38,38,0.15)',
    border: '1px solid #dc2626',
    borderRadius: 8,
    color: '#fca5a5',
  },
  hint: { margin: '8px 0 0', fontSize: 12, color: '#a1a1aa' },
};
