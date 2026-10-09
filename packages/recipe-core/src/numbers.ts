/**
 * Amounts as people write them: "2", "0,5", "1.25", "1 1/2", "1½", "½", "2–3" (PRD 5.1.1 stage 1).
 * Only the number part; units are resolved separately (units.ts).
 */
const UNICODE_FRACTIONS: Record<string, number> = {
  '½': 1 / 2,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '¼': 1 / 4,
  '¾': 3 / 4,
  '⅕': 1 / 5,
  '⅖': 2 / 5,
  '⅗': 3 / 5,
  '⅘': 4 / 5,
  '⅙': 1 / 6,
  '⅚': 5 / 6,
  '⅛': 1 / 8,
  '⅜': 3 / 8,
  '⅝': 5 / 8,
  '⅞': 7 / 8,
};
const UF = Object.keys(UNICODE_FRACTIONS).join('');

const NUMBER_PATTERNS: ReadonlyArray<[RegExp, (m: RegExpExecArray) => number | null]> = [
  [
    /^(\d+)\s+(\d+)\/(\d+)$/,
    (m) => (Number(m[3]) > 0 ? Number(m[1]) + Number(m[2]) / Number(m[3]) : null),
  ],
  [new RegExp(`^(\\d+)\\s*([${UF}])$`), (m) => Number(m[1]) + UNICODE_FRACTIONS[m[2]!]!],
  [new RegExp(`^([${UF}])$`), (m) => UNICODE_FRACTIONS[m[1]!]!],
  [/^(\d+)\/(\d+)$/, (m) => (Number(m[2]) > 0 ? Number(m[1]) / Number(m[2]) : null)],
  [/^(\d+(?:[.,]\d+)?)$/, (m) => Number(m[1]!.replace(',', '.'))],
];

export function parseNumber(text: string): number | null {
  const t = text.normalize('NFC').trim();
  for (const [re, toValue] of NUMBER_PATTERNS) {
    const m = re.exec(t);
    if (m) {
      const v = toValue(m);
      return v !== null && Number.isFinite(v) ? v : null;
    }
  }
  return null;
}

/** All dashes count as a range separator ("2–3", "2-3", "2 — 3"). A reversed range is rejected. */
export function parseAmount(text: string): { min: number; max: number } | null {
  const t = text.normalize('NFC').trim();
  if (!t) return null;
  const range = /^(.+?)\s*[-‐‑‒–—―]\s*(.+)$/.exec(t);
  if (range) {
    const min = parseNumber(range[1]!);
    const max = parseNumber(range[2]!);
    if (min === null || max === null || max < min) return null;
    return { min, max };
  }
  const v = parseNumber(t);
  return v === null ? null : { min: v, max: v };
}
