/**
 * Modular registry of label patterns for Scandit Smart Label Capture.
 * Add new patterns by appending field definitions to SCANDIT_FIELD_DEFINITIONS.
 * Each field maps to one or more output keys (batch_no, lot_no, expiry, serial) used
 * by scanditLabelToOcrFormat.
 */

export type OutputKey = 'batch_no' | 'lot_no' | 'expiry' | 'serial' | 'ref';

export type ScanditFieldDefinition = {
  /** Unique field name used by Scandit and in mapping */
  scanditFieldName: string;
  /** Anchor regex(es); empty array = no anchor (standalone value). Use string form for regex. */
  anchorRegexes: string[];
  /** Value regex(es) that the field value must match (one of). */
  valueRegexes: string[];
  optional: boolean;
  /** Which output keys this field fills (e.g. Batch/Lot fills both batch_no and lot_no). */
  outputKeys: OutputKey[];
};

/**
 * All custom-text field definitions used to build the single Scandit label.
 * Order matters: anchored fields (Lot no, Expiry) before unanchored (Product code, Batch/Lot)
 * so Scandit matches labeled lines first.
 *
 * To add a new pattern:
 * 1. Add one or more ScanditFieldDefinition entries with unique scanditFieldName.
 * 2. Set outputKeys to the target(s): batch_no, lot_no, expiry, serial, ref.
 * 3. In scanditLabelToOcrFormat, add mapping for the new field name and any value normalizer (e.g. YYYY-MMM).
 */
export const SCANDIT_FIELD_DEFINITIONS: ScanditFieldDefinition[] = [
  // --- Pattern: GS1-style (Lot No.: 20054138, Exp.: 2027-02, Product code B0Z7) ---
  {
    scanditFieldName: 'Lot no',
    anchorRegexes: ['Lot\\s*(No\\.?|Number|#)?\\s*:?\\s*'],
    valueRegexes: ['[0-9]{4,14}', '[0-9A-Za-z]{4,14}'],
    optional: true,
    outputKeys: ['lot_no'],
  },
  {
    scanditFieldName: 'Expiry',
    anchorRegexes: ['(Exp\\.?|Expiry|Expiration|Use\\s*[- ]?By)\\s*:?\\s*'],
    valueRegexes: [
      '[0-9]{4}-[0-9]{2}(-[0-9]{2})?',
      '[0-9]{2}/[0-9]{2}/[0-9]{4}',
      '[0-9]{2}-[0-9]{2}-[0-9]{4}',
    ],
    optional: true,
    outputKeys: ['expiry'],
  },
  {
    scanditFieldName: 'Product code',
    anchorRegexes: [],
    valueRegexes: ['[A-Za-z]+[0-9][A-Za-z0-9]{2,}'],
    optional: true,
    outputKeys: ['batch_no', 'lot_no'],
  },
  {
    scanditFieldName: 'Batch no',
    anchorRegexes: ['Batch\\s*no\\s*:?'],
    valueRegexes: ['[0-9A-Za-z]{3,15}'],
    optional: true,
    outputKeys: ['batch_no'],
  },
  // --- Pattern: REF / Reference number (e.g. REF 456085, Reference: 456085) ---
  {
    scanditFieldName: 'Ref no',
    anchorRegexes: ['REF\\s*(No\\.?|Number|#)?\\s*:?\\s*', 'Reference\\s*:?\\s*'],
    valueRegexes: ['[0-9]{4,12}', '[A-Za-z0-9]{4,15}'],
    optional: true,
    outputKeys: ['ref'],
  },
  // --- Pattern: Standalone 6-digit batch/lot + YYYY-MMM expiry (e.g. 402655, 2027-MAR) ---
  // Note: 6-digit YYMMDD (e.g. 261201) is treated as expiry in scanditLabelToOcrFormat, not batch/lot.
  {
    scanditFieldName: 'Batch/Lot (numeric)',
    anchorRegexes: [],
    valueRegexes: ['[0-9]{6}'],
    optional: true,
    outputKeys: ['batch_no', 'lot_no'],
  },
  {
    scanditFieldName: 'Expiry (YYYY-MMM)',
    anchorRegexes: [],
    valueRegexes: [
      '[0-9]{4}-(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)',
    ],
    optional: true,
    outputKeys: ['expiry'],
  },
  // --- Pattern: LOT + digits (e.g. LOT 693453, LOT 84325040027) ---
  {
    scanditFieldName: 'Lot no (LOT prefix)',
    anchorRegexes: ['LOT\\s+'],
    valueRegexes: ['[0-9]{6,15}'],
    optional: true,
    outputKeys: ['lot_no'],
  },
  {
    scanditFieldName: 'Expiry (EXP MMM YYYY)',
    anchorRegexes: ['EXP\\s+'],
    valueRegexes: [
      '(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\\s+[0-9]{4}',
      '(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[0-9]{4}', // MAR2027 (no space)
    ],
    optional: true,
    outputKeys: ['expiry'],
  },
  // --- Pattern: 6-digit lot + EXP MM/YY (e.g. 230572, EXP 06/27); lot covered by Batch/Lot (numeric) above ---
  {
    scanditFieldName: 'Expiry (EXP MM/YY)',
    anchorRegexes: ['EXP\\s+'],
    valueRegexes: ['[0-9]{1,2}/[0-9]{2}'],
    optional: true,
    outputKeys: ['expiry'],
  },
  // --- Pattern: LOT NUMBER: F809XA01X / EXPIRATION DATE: 2028/05 (e.g. Merck-style) ---
  {
    scanditFieldName: 'Lot no (LOT NUMBER)',
    anchorRegexes: ['LOT\\s*NUMBER\\s*:?\\s*'],
    valueRegexes: ['[A-Z0-9]{6,15}'],
    optional: true,
    outputKeys: ['lot_no'],
  },
  // --- Pattern: Serial number (e.g. Serial: 10104541514812, SN: 10104541514812) ---
  {
    scanditFieldName: 'Serial no',
    anchorRegexes: ['Serial\\s*(No\\.?|Number|#)?\\s*:?\\s*', 'SN\\s*:?\\s*', 'S/N\\s*:?\\s*'],
    valueRegexes: ['[0-9]{10,20}', '[A-Za-z0-9]{8,20}'],
    optional: true,
    outputKeys: ['serial'],
  },
  {
    scanditFieldName: 'Expiry (EXPIRATION DATE)',
    anchorRegexes: ['EXPIRATION\\s*DATE\\s*:?\\s*'],
    valueRegexes: ['[0-9]{4}/[0-9]{2}', '[0-9]{4}-[0-9]{2}'],
    optional: true,
    outputKeys: ['expiry'],
  },
];

/** Month name to 2-digit number for YYYY-MMM normalization */
const MONTH_NAME_TO_NUM: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
};

/**
 * Normalize expiry string to YYYY-MM. Handles YYYY-MMM (2027-MAR), MMM YYYY (MAR 2027), and numeric formats.
 */
export function normalizeExpiryForMapping(value: string): string {
  const v = value.trim().toUpperCase();
  const yyyyMmm = /^(\d{4})-(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)$/.exec(v);
  if (yyyyMmm) {
    const num = MONTH_NAME_TO_NUM[yyyyMmm[2]];
    return num ? `${yyyyMmm[1]}-${num}` : value;
  }
  const mmmYyyy = /^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{4})$/.exec(v);
  if (mmmYyyy) {
    const num = MONTH_NAME_TO_NUM[mmmYyyy[1]];
    return num ? `${mmmYyyy[2]}-${num}` : value;
  }
  const mmmYyyyNoSpace = /^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{4})$/.exec(v);
  if (mmmYyyyNoSpace) {
    const num = MONTH_NAME_TO_NUM[mmmYyyyNoSpace[1]];
    return num ? `${mmmYyyyNoSpace[2]}-${num}` : value;
  }
  const yyyyMmSlash = /^(\d{4})\/(\d{1,2})$/.exec(v);
  if (yyyyMmSlash) return `${yyyyMmSlash[1]}-${yyyyMmSlash[2].padStart(2, '0')}`;
  // EXP MM/YY (e.g. 06/27 → June 2027)
  const mmYySlash = /^(\d{1,2})\/(\d{2})$/.exec(v);
  if (mmYySlash) {
    const mm = mmYySlash[1].padStart(2, '0');
    const yy = parseInt(mmYySlash[2], 10);
    const yyyy = yy >= 0 && yy <= 99 ? (yy >= 50 ? 1900 + yy : 2000 + yy) : yy;
    const monthNum = parseInt(mm, 10);
    if (monthNum >= 1 && monthNum <= 12) return `${yyyy}-${mm}`;
  }
  return value;
}
