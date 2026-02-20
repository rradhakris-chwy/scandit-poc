/**
 * Parse GS1 barcode (e.g. DataMatrix) to label JSON keys: batch_no, lot_no, expiry.
 * Uses same parser as web-dashboard; (10)=batch/lot, (17)=expiry, (01)=GTIN, (21)=serial.
 */

import { GS1Parser } from '@valentynb/gs1-parser';

const GS1_GROUP_SEPARATOR = String.fromCharCode(29);

function preprocess(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  return raw.replace(/\|/g, GS1_GROUP_SEPARATOR).trim();
}

function elToStr(el: { data?: unknown; dataString?: string } | undefined): string {
  if (!el) return '';
  const v = el.data ?? el.dataString;
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

export type Gs1LabelResult = {
  batch_no: string;
  lot_no: string;
  expiry: string;
  upc_gtin?: string;
  serial?: string;
};

const parser = new GS1Parser();

/**
 * Fallback for concatenated GS1 without group separator (e.g. 0100350111561014211010454151481217270531107981055).
 * Extracts (01) 14-digit GTIN, (21) serial, (17) 6-digit YYMMDD, (10) batch/lot.
 * We match (10) only when it appears as an AI after (17)YYMMDD, so "10" inside the GTIN is not mistaken for batch.
 */
function parseConcatenatedGs1(s: string): Gs1LabelResult | null {
  const t = s.replace(/\s/g, '');
  if (t.length < 20) return null;
  const gtinMatch = /01(\d{14})/.exec(t);
  const serialMatch = /21([A-Za-z0-9]{1,20})/.exec(t);
  const expMatch = /17(\d{6})/.exec(t);
  // (10) batch/lot: match after (17)YYMMDD; stop before (21) when present so we get MK8701 not MK870121943321361918
  let batch = '';
  const batchBeforeSerial = /17\d{6}10([A-Za-z0-9]+?)21/.exec(t);
  if (batchBeforeSerial) {
    batch = batchBeforeSerial[1];
  } else {
    const batchToEnd = /17\d{6}10([A-Za-z0-9]+)/.exec(t);
    if (batchToEnd) batch = batchToEnd[1];
  }
  const gtin = gtinMatch ? gtinMatch[1] : '';
  const serial = serialMatch ? serialMatch[1] : '';
  // Expiry: convert YYMMDD to YYYY-MM-DD (e.g. 270228 -> 2027-02-28)
  let expiry = '';
  if (expMatch) {
    const yy = expMatch[1].slice(0, 2);
    const mm = expMatch[1].slice(2, 4);
    const dd = expMatch[1].slice(4, 6);
    const yyyy = parseInt(yy, 10) >= 50 ? `19${yy}` : `20${yy}`;
    expiry = `${yyyy}-${mm}-${dd}`;
  }
  if (!gtin && !expiry && !batch && !serial) return null;
  return {
    batch_no: batch,
    lot_no: batch,
    expiry,
    ...(gtin && { upc_gtin: gtin }),
    ...(serial && { serial }),
  };
}

/**
 * Parse GS1 barcode string to label JSON. (10) -> batch_no and lot_no, (17) -> expiry (YYYY-MM).
 * Tries library first; if it fails (e.g. concatenated without separator), uses concatenated fallback.
 */
export function parseGs1ToLabelJson(raw: string): Gs1LabelResult | null {
  const normalized = preprocess(raw);
  if (!normalized) return null;

  try {
    const result = parser.decode(normalized);
    const data = result?.data as Record<string, { data?: unknown; dataString?: string }> | undefined;
    if (data && Object.keys(data).length > 0) {
      const batch = elToStr(data.batch);
      const expiryRaw = elToStr(data.expDate);
      const expiry = expiryRaw ? (expiryRaw.length >= 10 ? expiryRaw.slice(0, 10) : expiryRaw) : '';
      const gtin = elToStr(data.gtin);
      const serial = elToStr(data.serial);
      if (batch || expiry || gtin || serial) {
        return {
          batch_no: batch,
          lot_no: batch,
          expiry,
          ...(gtin && { upc_gtin: gtin }),
          ...(serial && { serial }),
        };
      }
    }
  } catch {
    // library failed, try concatenated fallback
  }

  return parseConcatenatedGs1(normalized);
}
