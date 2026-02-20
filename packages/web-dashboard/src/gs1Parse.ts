import { GS1Parser } from '@valentynb/gs1-parser';

const GS1_GROUP_SEPARATOR = String.fromCharCode(29); // ASCII 29 (FNC1)

/**
 * Pre-process scan string: replace pipe | (Honeywell Group Separator) with ASCII 29
 * so the GS1 parser recognizes segment boundaries.
 */
export function preprocessScan(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  return raw.replace(/\|/g, GS1_GROUP_SEPARATOR).trim();
}

/** Inferred from parsing: GS1 Linear vs DataMatrix by AI count/length; else UPC/EAN. */
export type BarcodeType = 'GS1_LINEAR' | 'GS1_DATAMATRIX' | 'UPC' | 'EAN' | 'UNKNOWN';

/** Parsed JSON shape matching frontend Dashboard (key-name value pairs). */
export interface ParsedData {
  /** Single product identifier: GTIN (01) when GS1, or raw UPC/EAN otherwise. */
  upc_gtin: string;
  batch?: string;
  expiry?: string;
  serial?: string;
  type: BarcodeType;
  raw?: string;
}

const parser = new GS1Parser();

function elToStr(el: { data?: unknown; dataString?: string } | undefined): string {
  if (!el) return '';
  const v = el.data ?? el.dataString;
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

function inferRawType(raw: string): BarcodeType {
  const digitsOnly = raw.replace(/\D/g, '');
  const len = digitsOnly.length;
  if (len === 8) return 'EAN';
  if (len === 12 || len === 13 || len === 14) return 'UPC';
  if (len > 0 && len <= 18) return 'UPC';
  return 'UNKNOWN';
}

const GS1_DATAMATRIX_LENGTH_THRESHOLD = 40;

function inferGS1Variant(
  gtin: string,
  batch: string,
  expiry: string,
  serial: string,
  normalizedLength: number
): 'GS1_LINEAR' | 'GS1_DATAMATRIX' {
  const aiCount = [gtin, batch, expiry, serial].filter(Boolean).length;
  if (aiCount >= 3) return 'GS1_DATAMATRIX';
  if (normalizedLength > GS1_DATAMATRIX_LENGTH_THRESHOLD) return 'GS1_DATAMATRIX';
  return 'GS1_LINEAR';
}

/**
 * Parse barcode string to frontend-style JSON: upc_gtin, type, batch?, expiry?, serial?.
 * Same key names as frontend/src/components/Dashboard.tsx "Parsed data (JSON)".
 */
export function parseBarcodeToData(raw: string): ParsedData {
  const normalized = preprocessScan(raw);
  if (!normalized) {
    return { upc_gtin: '', type: 'UNKNOWN' };
  }

  try {
    const result = parser.decode(normalized);
    const data = result?.data as Record<string, { data?: unknown; dataString?: string }> | undefined;
    if (!data || Object.keys(data).length === 0) {
      return { upc_gtin: normalized, type: inferRawType(normalized), raw: raw };
    }

    const gtin = elToStr(data.gtin);
    const batch = elToStr(data.batch);
    const expiry = elToStr(data.expDate);
    const serial = elToStr(data.serial);

    const hasStructuredData = Boolean(gtin || batch || expiry || serial);
    const type: BarcodeType = hasStructuredData
      ? inferGS1Variant(gtin, batch, expiry, serial, normalized.length)
      : inferRawType(normalized);
    const upc_gtin = gtin || normalized;

    return {
      upc_gtin,
      type,
      ...(batch && { batch }),
      ...(expiry && { expiry }),
      ...(serial && { serial }),
      raw: raw,
    };
  } catch {
    return { upc_gtin: normalized, type: inferRawType(normalized), raw: raw };
  }
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Format YYYY-MM-DD or YYYY-MM as "DD MMM YYYY" or "MMM YYYY". */
function formatExpiryDisplay(expiry: string): string {
  if (!expiry || !expiry.trim()) return '';
  const m = expiry.trim().match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (!m) return expiry;
  const [, y, month, day] = m;
  const mi = parseInt(month, 10) - 1;
  if (mi < 0 || mi > 11) return expiry;
  if (day) return `${day.padStart(2, '0')} ${MONTHS[mi]} ${y}`;
  return `${MONTHS[mi]} ${y}`;
}

/**
 * Format parsed GS1 data as (01) GTIN, (17) EXPIRY, (10) BATCH/LOT lines for dashboard display.
 */
export function formatGs1AsKeyValueLines(parsed: ParsedData): string {
  const lines: string[] = [];
  if (parsed.upc_gtin && (parsed.type === 'GS1_DATAMATRIX' || parsed.type === 'GS1_LINEAR')) {
    lines.push(`(01) GTIN\t${parsed.upc_gtin}`);
  }
  if (parsed.expiry) {
    lines.push(`(17) EXPIRY\t${formatExpiryDisplay(parsed.expiry)}`);
  }
  if (parsed.batch) {
    lines.push(`(10) BATCH/LOT\t${parsed.batch}`);
  }
  if (parsed.serial) {
    lines.push(`(21) SERIAL\t${parsed.serial}`);
  }
  return lines.join('\n');
}
