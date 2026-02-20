/**
 * Maps Scandit Smart Label Capture fields to the same shape as Tesseract/OCR workflow:
 * { batch_no, lot_no, expiry } for publishing to the dashboard.
 * When Barcode field contains GS1 DataMatrix, parses it to fill batch_no, lot_no, expiry.
 * Mapping is driven by labelPatterns.SCANDIT_FIELD_DEFINITIONS (outputKeys per field).
 */

import {
  normalizeExpiryForMapping,
  SCANDIT_FIELD_DEFINITIONS,
  type OutputKey,
} from './labelPatterns';
import { parseGs1ToLabelJson } from './gs1Parse';

/** Map Scandit field name -> output keys; built from SCANDIT_FIELD_DEFINITIONS */
const FIELD_TO_OUTPUT_KEYS: Record<string, OutputKey[]> = Object.fromEntries(
  SCANDIT_FIELD_DEFINITIONS.map((def) => [def.scanditFieldName, def.outputKeys])
);

export type LabelJson = {
  batch_no: string;
  lot_no: string;
  expiry: string;
  /** UPC/GTIN from scanned barcode (e.g. UPC-A 12 digits) when present */
  upc_gtin?: string;
  /** Serial number from GS1 AI (21) when present */
  serial?: string;
  /** Reference number (e.g. REF 456085) or short barcode when GS1 also present */
  ref?: string;
};

export type ScanditField = {
  name: string;
  value: string;
};

/**
 * Format a date from Scandit (day, month, year) to YYYY-MM to match expiry in labelFormats.
 */
function formatExpiry(day: number | null, month: number | null, year: number | null): string {
  if (year == null) return '';
  const y = String(year);
  if (month == null) return y.length === 4 ? y : '';
  const m = String(month).padStart(2, '0');
  if (day == null) return `${y}-${m}`;
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`.slice(0, 7); // keep YYYY-MM for consistency with OCR
}

/** True if 6-digit string looks like YYMMDD (month 01-12, day 01-31). Used to avoid treating expiry as batch/lot. */
function isLikelyYYMMDD(s: string): boolean {
  if (!/^\d{6}$/.test(s)) return false;
  const mm = parseInt(s.slice(2, 4), 10);
  const dd = parseInt(s.slice(4, 6), 10);
  return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
}

/** Obvious OCR misreads for Product code (e.g. "Lot" → "L0T", "Layout" → "Lay0ut"). */
function isProductCodeMisread(value: string): boolean {
  const s = value.trim();
  if (s.length <= 3) return true; // B0Z7 is 4; L0T, LOT, Exp are 3 or less
  const u = s.toUpperCase();
  if (/^L0?T$/.test(u) || /^EXP?$/.test(u) || /^E1P$/.test(u) || u === 'LOT') return true;
  // Common word-with-digit OCR noise (e.g. Layout → Lay0ut)
  if (/^LAY0?UT$/.test(u) || u === 'LAYOUT') return true;
  return false;
}

/** Normalize expiry to YYYY-MM for consistency with OCR format. Handles YYYY-MM, YYYY-MMM, slash/dash dates. */
function normalizeExpiry(value: string): string {
  const v = value.trim();
  const fromMmm = normalizeExpiryForMapping(v);
  if (fromMmm !== v) return fromMmm; // YYYY-MMM was normalized
  const yyyyMm = /^(\d{4})-(\d{1,2})(-(\d{1,2}))?$/.exec(v);
  if (yyyyMm) return `${yyyyMm[1]}-${yyyyMm[2].padStart(2, '0')}`;
  const mmDdYyyy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (mmDdYyyy) return `${mmDdYyyy[3]}-${mmDdYyyy[1].padStart(2, '0')}`;
  const ddMmYyyy = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(v);
  if (ddMmYyyy) return `${ddMmYyyy[3]}-${ddMmYyyy[2].padStart(2, '0')}`;
  const mmYyyy = /^(\d{1,2})\/(\d{4})$/.exec(v);
  if (mmYyyy) return `${mmYyyy[2]}-${mmYyyy[1].padStart(2, '0')}`;
  return v;
}

/** Try to parse lot number and expiry from raw text when fields are missing. */
function parseLotAndExpiryFromRaw(raw: string): { lot_no: string; expiry: string } {
  let lot_no = '';
  let expiry = '';
  const lotMatch = raw.match(/(?:Lot\s*(?:No\.?|Number|#)?\s*:?|LOT\s*NO\.?\s*:?|LOT\s*NUMBER\s*:?|LOT\s+)\s*([0-9A-Za-z]{4,15})/i);
  if (lotMatch) lot_no = lotMatch[1].trim();
  if (!lot_no) {
    const standAlone6 = raw.match(/\b(\d{6})\b/);
    if (standAlone6) lot_no = standAlone6[1];
  }
  const expiryMatch = raw.match(/(?:Exp\.?|Expiry|Expiration(?:\s*DATE)?|Use\s*[- ]?By|EXP\s+)\s*:?\s*(\d{4}-\d{2}(-\d{2})?|\d{4}\/\d{1,2}(?:\/\d{2,4})?|\d{4}-(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)|(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+\d{4}|(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\d{4}|\d{1,2}\/\d{1,2}\/\d{4}|\d{1,2}-\d{1,2}-\d{4})/i);
  if (expiryMatch) expiry = normalizeExpiry(expiryMatch[1]);
  if (!expiry) {
    const yyyyMmm = raw.match(/\b(\d{4}-(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC))\b/i);
    if (yyyyMmm) expiry = normalizeExpiry(yyyyMmm[1]);
  }
  if (!expiry) {
    const expMmmYyyy = raw.match(/\b(EXP\s+)?(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{4})\b/i);
    if (expMmmYyyy) expiry = normalizeExpiry(`${expMmmYyyy[2]} ${expMmmYyyy[3]}`);
  }
  if (!expiry) {
    const expMmmYyyyNoSpace = raw.match(/\bEXP\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{4})\b/i);
    if (expMmmYyyyNoSpace) expiry = normalizeExpiry(`${expMmmYyyyNoSpace[1]}${expMmmYyyyNoSpace[2]}`);
  }
  if (!expiry) {
    const expMmYy = raw.match(/\bEXP\s*(\d{1,2}\/\d{2})\b/i);
    if (expMmYy) expiry = normalizeExpiry(expMmYy[1]);
  }
  return { lot_no, expiry };
}

const SERIAL_FROM_RAW_REGEX = new RegExp(
  '(?:Serial\\s*(?:No\\.?|Number|#)?\\s*:?|SN\\s*:?|S/N\\s*:?)\\s*([A-Za-z0-9]{8,20})',
  'i'
);

/** Try to parse serial number from raw text when field is missing. */
function parseSerialFromRaw(raw: string): string {
  const m = raw.match(SERIAL_FROM_RAW_REGEX);
  return m ? m[1].trim() : '';
}

/**
 * Build label JSON and raw string from Scandit label fields (name + value pairs).
 * If "Barcode" field contains GS1 DataMatrix, parses it and merges into labelJson.
 * Filters out Product code misreads (e.g. L0T from "Lot") from output and batch_no.
 */
export function scanditFieldsToLabelJson(fields: ScanditField[]): {
  labelJson: LabelJson;
  raw: string;
} {
  const labelJson: LabelJson = { batch_no: '', lot_no: '', expiry: '' };
  const lines: string[] = [];
  const barcodeValues: string[] = [];

  for (const f of fields) {
    const v = (f.value ?? '').trim();
    const isMisread = f.name === 'Product code' && isProductCodeMisread(v);
    if (!isMisread) lines.push(`${f.name}: ${f.value ?? ''}`);

    if (f.name === 'Barcode') {
      barcodeValues.push(v);
      continue;
    }

    const outputKeys = FIELD_TO_OUTPUT_KEYS[f.name];
    if (outputKeys) {
      const valueToSet = outputKeys.includes('expiry') ? normalizeExpiry(v) : v;
      if (f.name === 'Product code' && isProductCodeMisread(v)) continue;
      // Batch/Lot (numeric) 6-digit: if it looks like YYMMDD (e.g. 261201), set expiry only
      if (f.name === 'Batch/Lot (numeric)' && isLikelyYYMMDD(v)) {
        labelJson.expiry = v;
        continue;
      }
      for (const key of outputKeys) {
        if (key === 'batch_no') labelJson.batch_no = valueToSet;
        if (key === 'lot_no') labelJson.lot_no = valueToSet;
        if (key === 'expiry') labelJson.expiry = valueToSet;
        if (key === 'serial') labelJson.serial = valueToSet;
        if (key === 'ref') labelJson.ref = valueToSet;
      }
      continue;
    }

    // Built-in Scandit fields not in registry
    if (f.name === 'Expiry Date') labelJson.expiry = normalizeExpiry(v);
  }

  // Prefer long GS1 barcode for parsing; treat short numeric-only barcode as ref (e.g. 456085)
  const longGs1 = barcodeValues.find((val) => val.replace(/\s/g, '').length >= 20 && /01\d{14}/.test(val.replace(/\s/g, '')));
  const barcodeValue = longGs1 ?? (barcodeValues.length ? barcodeValues.reduce((a, b) => (a.length >= b.length ? a : b)) : '');
  const shortBarcode = barcodeValues.find((val) => /^\d{5,7}$/.test(val.replace(/\s/g, '')));
  if (!labelJson.ref && shortBarcode && longGs1) {
    labelJson.ref = shortBarcode.trim();
  }
  // GS1 barcode: try parse for any length (e.g. (01)10080196743940 or longer multi-AI strings)
  if (barcodeValue.length >= 14) {
    const gs1 = parseGs1ToLabelJson(barcodeValue);
    if (gs1) {
      // Prefer GS1 over OCR so lot is MK8701 from (10), not PAA221 from second Product code
      if (gs1.batch_no) labelJson.batch_no = gs1.batch_no;
      if (gs1.lot_no) labelJson.lot_no = gs1.lot_no;
      if (gs1.expiry) labelJson.expiry = gs1.expiry;
      if (gs1.upc_gtin) labelJson.upc_gtin = gs1.upc_gtin;
      if (gs1.serial) labelJson.serial = gs1.serial;
    }
  }
  // Barcode → upc_gtin: (01)GTIN format, or plain 6–14 digit numeric
  if (!labelJson.upc_gtin && barcodeValue) {
    const trimmed = barcodeValue.trim();
    const gtinFromAi = trimmed.match(/^\(?01\)?\s*(\d{13,14})$/);
    if (gtinFromAi) {
      labelJson.upc_gtin = gtinFromAi[1];
    } else {
      const digits = barcodeValue.replace(/\s/g, '');
      if (/^\d{6,14}$/.test(digits)) labelJson.upc_gtin = digits;
    }
  }

  let raw = lines.join('\n');
  if (labelJson.serial) raw = raw ? `${raw}\nSerial: ${labelJson.serial}` : `Serial: ${labelJson.serial}`;
  // If Scandit only returned Product code, try to parse lot/expiry/serial from raw (e.g. from other captured lines)
  if (!labelJson.lot_no || !labelJson.expiry) {
    const parsed = parseLotAndExpiryFromRaw(raw);
    if (!labelJson.lot_no && parsed.lot_no) labelJson.lot_no = parsed.lot_no;
    if (!labelJson.expiry && parsed.expiry) labelJson.expiry = parsed.expiry;
  }
  if (!labelJson.serial) {
    const serialFromRaw = parseSerialFromRaw(raw);
    if (serialFromRaw) labelJson.serial = serialFromRaw;
  }

  // Barcode value must not appear as batch_no or lot_no (clear after fallback so it stays cleared)
  if (labelJson.upc_gtin) {
    if (labelJson.batch_no === labelJson.upc_gtin) labelJson.batch_no = '';
    if (labelJson.lot_no === labelJson.upc_gtin) labelJson.lot_no = '';
  }
  if (labelJson.ref) {
    if (labelJson.batch_no === labelJson.ref) labelJson.batch_no = '';
    if (labelJson.lot_no === labelJson.ref) labelJson.lot_no = '';
  }

  return { labelJson, raw };
}

/**
 * Convert Scandit LabelField-like objects (with type, text, date, barcode) into
 * the same label JSON format. Used when we have raw SDK field objects.
 */
export function scanditLabelFieldsToLabelJson(
  fields: Array<{
    name: string;
    text?: string | null;
    date?: { day: number | null; month: number | null; year: number | null } | null;
    barcode?: { data?: string } | null;
  }>
): { labelJson: LabelJson; raw: string } {
  const pairs: ScanditField[] = fields.map((field) => {
    let value: string;
    if (field.date != null) {
      value = formatExpiry(field.date.day, field.date.month, field.date.year);
    } else if (field.barcode?.data != null) {
      value = field.barcode.data;
    } else {
      value = field.text ?? '';
    }
    return { name: field.name, value };
  });
  return scanditFieldsToLabelJson(pairs);
}
