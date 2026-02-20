/**
 * Modular label format registry for healthcare OCR.
 * Add or edit formats here to support different manufacturers without touching the OCR pipeline.
 *
 * Technical note (Tesseract vs alternatives):
 * - Tesseract.js: Good for in-clinic use (offline, no API keys, runs in browser). Accuracy depends
 *   on contrast, font (dot-matrix/small print are harder), and crop. Use a whitelist and crop to
 *   improve results. Pattern logic lives here; Tesseract only returns raw text.
 * - For higher accuracy on difficult labels: consider cloud OCR (Google Vision, AWS Textract,
 *   Azure Document Intelligence) or a hybrid (Tesseract first, cloud fallback). Cloud adds cost,
 *   latency, and network/PHI considerations.
 */

export type LabelFormatResult = {
  batch_no?: string;
  lot_no?: string;
  expiry?: string;
};

export type LabelFormat = {
  id: string;
  name: string;
  /** Extract fields from normalized OCR text. Return only fields that were clearly found. */
  extract: (text: string) => LabelFormatResult;
};

function normalizeExpiry(raw: string): string {
  const mon: Record<string, string> = {
    JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
    JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
  };
  const yyyyMmm = raw.match(/^(\d{4})-(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)$/i);
  if (yyyyMmm) {
    const m = mon[yyyyMmm[2].toUpperCase()];
    if (m) return `${yyyyMmm[1]}-${m}`;
  }
  const mmmYyyy = raw.match(/^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{4})$/i);
  if (mmmYyyy) {
    const m = mon[mmmYyyy[1].toUpperCase()];
    if (m) return `${mmmYyyy[2]}-${m}`;
  }
  const mmmYyyyNoSpace = raw.match(/^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{4})$/i);
  if (mmmYyyyNoSpace) {
    const m = mon[mmmYyyyNoSpace[1].toUpperCase()];
    if (m) return `${mmmYyyyNoSpace[2]}-${m}`;
  }
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash)
    return `${slash[3]}-${slash[1].padStart(2, '0')}-${slash[2].padStart(2, '0')}`.slice(0, 7);
  const mmYyyy = raw.match(/^(\d{1,2})\/(\d{4})$/);
  if (mmYyyy) return `${mmYyyy[2]}-${mmYyyy[1].padStart(2, '0')}`;
  const yyyyMmSlash = raw.match(/^(\d{4})\/(\d{1,2})$/);
  if (yyyyMmSlash) return `${yyyyMmSlash[1]}-${yyyyMmSlash[2].padStart(2, '0')}`;
  return raw;
}

/** Format: "Lot No.: 20054138", "Exp.: 2027-02", product code like B0Z7 (common GS1-style) */
const gs1Style: LabelFormat = {
  id: 'gs1_style',
  name: 'GS1-style (Lot No., Exp. YYYY-MM)',
  extract(t) {
    const out: LabelFormatResult = {};
    const expiryYyyyMm = t.match(/\d{4}-\d{2}(-\d{2})?/);
    if (expiryYyyyMm) out.expiry = expiryYyyyMm[0].slice(0, 7);

    const lotMatch = t.match(/Lot\s*No\.?\s*:?\s*(\d{6,14})/i);
    if (lotMatch) out.lot_no = lotMatch[1];
    else {
      const digitStrings = t.match(/\d{6,14}/g) ?? [];
      const expiryDigits = (out.expiry ?? '').replace(/-/g, '');
      const lot = digitStrings
        .filter((s) => s !== expiryDigits)
        .sort((a, b) => b.length - a.length)[0];
      if (lot) out.lot_no = lot;
    }

    const batchMatch = t.match(/\b([A-Za-z][A-Za-z0-9]{2,7})\b/g)?.find(
      (w) => /[A-Za-z]/.test(w) && /\d/.test(w)
    );
    if (batchMatch) out.batch_no = batchMatch.toUpperCase();
    return out;
  },
};

/** Format: Standalone 6-digit batch/lot (e.g. 402655) and YYYY-MMM expiry (e.g. 2027-MAR) */
const numericLotYyyyMmm: LabelFormat = {
  id: 'numeric_lot_yyyy_mmm',
  name: '6-digit batch/lot, YYYY-MMM expiry',
  extract(t) {
    const out: LabelFormatResult = {};
    const sixDigit = t.match(/\b(\d{6})\b/);
    if (sixDigit) {
      out.batch_no = sixDigit[1];
      out.lot_no = sixDigit[1];
    }
    const yyyyMmm = t.match(/\b(\d{4}-(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC))\b/i);
    if (yyyyMmm) out.expiry = normalizeExpiry(yyyyMmm[1]);
    return out;
  },
};

/** Format: "LOT 693453", "EXP MAR 2027" or "EXP MAR2027" (embossed style) */
const lotExpMmmYyyy: LabelFormat = {
  id: 'lot_exp_mmm_yyyy',
  name: 'LOT 6digits / EXP MMM YYYY',
  extract(t) {
    const out: LabelFormatResult = {};
    const lotPrefix = t.match(/LOT\s+(\d{6})/i);
    if (lotPrefix) out.lot_no = lotPrefix[1];
    const expMmmYyyy = t.match(/EXP\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{4})/i);
    if (expMmmYyyy) out.expiry = normalizeExpiry(`${expMmmYyyy[1]} ${expMmmYyyy[2]}`);
    if (!out.expiry) {
      const expMmmYyyyNoSpace = t.match(/EXP\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{4})/i);
      if (expMmmYyyyNoSpace) out.expiry = normalizeExpiry(`${expMmmYyyyNoSpace[1]}${expMmmYyyyNoSpace[2]}`);
    }
    return out;
  },
};

/** Format: "LOT NUMBER: F809XA01X", "EXPIRATION DATE: 2028/05" (e.g. Merck-style) */
const lotNumberExpirationDate: LabelFormat = {
  id: 'lot_number_expiration_date',
  name: 'LOT NUMBER / EXPIRATION DATE YYYY/MM',
  extract(t) {
    const out: LabelFormatResult = {};
    const lotNum = t.match(/LOT\s*NUMBER\s*:?\s*([A-Z0-9]{6,15})/i);
    if (lotNum) out.lot_no = lotNum[1].trim();
    const expDate = t.match(/EXPIRATION\s*DATE\s*:?\s*(\d{4}\/\d{1,2})/i);
    if (expDate) out.expiry = normalizeExpiry(expDate[1]);
    return out;
  },
};

/** Format: "LOT # 250767C", "EXP 12/2026", standalone batch e.g. 1004 */
const lotHashExpSlash: LabelFormat = {
  id: 'lot_hash_exp_slash',
  name: 'LOT # / EXP MM/YYYY',
  extract(t) {
    const out: LabelFormatResult = {};
    const lotMatch = t.match(/LOT\s*#?\s*:?\s*([A-Za-z0-9]{4,14})/i);
    if (lotMatch) out.lot_no = lotMatch[1].toUpperCase();

    const expSlash = t.match(/(?:EXP?\.?\s*:?\s*)?(\d{1,2}\/\d{4})(?:\s|$)/i) ?? t.match(/(\d{1,2}\/\d{4})/);
    if (expSlash) out.expiry = normalizeExpiry(expSlash[1]);

    const expiryDigits = (out.expiry ?? '').replace(/-/g, '').replace(/\//g, '');
    const digit3to5 = t.match(/\b(\d{3,5})\b/g)?.find(
      (s) => s !== out.lot_no && !expiryDigits.startsWith(s)
    );
    if (digit3to5) out.batch_no = digit3to5;
    return out;
  },
};

/** Fallback: try to get expiry in any common form, lot as long alphanumeric or digits, batch as short token */
const fallback: LabelFormat = {
  id: 'fallback',
  name: 'Fallback (generic patterns)',
  extract(t) {
    const out: LabelFormatResult = {};
    const expiryYyyyMm = t.match(/\d{4}-\d{2}(-\d{2})?/);
    const expirySlash = t.match(/(\d{1,2}\/\d{4})/);
    if (expiryYyyyMm) out.expiry = expiryYyyyMm[0].slice(0, 7);
    else if (expirySlash) out.expiry = normalizeExpiry(expirySlash[1]);

    const expiryDigits = (out.expiry ?? '').replace(/-/g, '').replace(/\//g, '');
    if (!out.lot_no) {
      const lotLothash = t.match(/LOT\s*#?\s*:?\s*([A-Za-z0-9]{4,14})/i);
      if (lotLothash) out.lot_no = lotLothash[1].toUpperCase();
      else {
        const digitStrings = t.match(/\d{6,14}/g) ?? [];
        const lot = digitStrings
          .filter((s) => s !== expiryDigits && !expiryDigits.startsWith(s))
          .sort((a, b) => b.length - a.length)[0];
        if (lot) out.lot_no = lot;
      }
    }
    if (!out.batch_no) {
      const batch = t.match(/\b([A-Za-z][A-Za-z0-9]{2,7})\b/g)?.find(
        (w) => /[A-Za-z]/.test(w) && /\d/.test(w)
      );
      if (batch) out.batch_no = batch.toUpperCase();
      else {
        const d = t.match(/\b(\d{3,5})\b/g)?.find(
          (s) => s !== out.lot_no && !expiryDigits.startsWith(s)
        );
        if (d) out.batch_no = d;
      }
    }
    return out;
  },
};

/** All formats in priority order. Add new manufacturer formats here. */
export const LABEL_FORMATS: LabelFormat[] = [
  gs1Style,
  numericLotYyyyMmm,
  lotExpMmmYyyy,
  lotNumberExpirationDate,
  lotHashExpSlash,
  fallback,
];

function score(result: LabelFormatResult): number {
  let n = 0;
  if (result.batch_no?.trim()) n += 1;
  if (result.lot_no?.trim()) n += 1;
  if (result.expiry?.trim()) n += 1;
  return n;
}

/**
 * Run all registered formats and return the result with the most fields filled.
 * Normalizes to consistent shape { batch_no, lot_no, expiry } (empty string if missing).
 */
export function extractLabelFromOcr(ocrText: string): {
  batch_no: string;
  lot_no: string;
  expiry: string;
} {
  const t = ocrText.replace(/\s+/g, ' ').trim();
  const lines = ocrText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  let best: LabelFormatResult = {};
  let bestScore = 0;

  for (const format of LABEL_FORMATS) {
    const result = format.extract(t);
    const s = score(result);
    if (s > bestScore) {
      bestScore = s;
      best = result;
    }
  }

  const firstLine = lines[0]?.match(/^[A-Z0-9]{2,10}$/i)?.[0];
  if (!best.batch_no && firstLine && best.lot_no !== firstLine && best.expiry !== firstLine)
    best = { ...best, batch_no: firstLine };

  return {
    batch_no: (best.batch_no ?? '').trim(),
    lot_no: (best.lot_no ?? '').trim(),
    expiry: (best.expiry ?? '').trim(),
  };
}
