import { classifyProduct } from '../products.js';
import type { Lang, QtyKind } from '../types.js';
import { normalizeUnitText, resolveUnit } from '../units.js';
import { PINCH, SPICES, SPICE_SEPARATOR, TASTE } from './dictionaries.js';
import { collapse, fold, readLine, trimEndChars } from './normalize.js';
import type { ParsedIngredient, ParseReason } from './types.js';

/** NUM or RANGE at the start of a string (after normalization numbers are plain decimals). */
const AMOUNT = /^(\d{1,6}(?:\.\d{1,8})?)(?: ?- ?(\d{1,6}(?:\.\d{1,8})?))?(?=[\s\p{L}]|$)/u;
const BRACKETS = /\(([^()]{0,200})\)/g;
/** P4 looks for "NAME - AMOUNT UNIT" only in the last characters of a line (linear time). */
const P4_TAIL = 40;

export type IngredientCore = Omit<ParsedIngredient, 'groupLabel'>;

/** The longest unit alias (up to 3 words) at the start of `words`; the number of words it used. */
export function unitAt(
  words: readonly string[],
  lang: Lang,
): { code: string; used: number } | null {
  for (let k = Math.min(3, words.length); k >= 1; k--) {
    const candidate = words.slice(0, k).join(' ');
    if (normalizeUnitText(candidate).length === 0) continue;
    const code = resolveUnit(candidate, lang);
    if (code) return { code, used: k };
  }
  return null;
}

type Amount = { min: number; max: number; rest: string };
function amountAt(s: string): Amount | null {
  const m = AMOUNT.exec(s);
  if (!m) return null;
  const min = Number(m[1]);
  const max = m[2] !== undefined ? Number(m[2]) : min;
  if (!(min > 0) || max < min) return null;
  return { min, max, rest: s.slice(m[0].length).trim() };
}

function result(
  raw: string,
  fields: Pick<IngredientCore, 'name' | 'qtyKind'> & Partial<IngredientCore>,
  penalties: ParseReason[],
  note: string | null,
): IngredientCore {
  const points: Record<ParseReason, number> = { p4: 1, no_unit: 2, bracket: 2, unparsed: 5 };
  const lost = penalties.reduce((sum, r) => sum + points[r], 0);
  const product = classifyProduct(fields.name);
  return {
    raw,
    name: fields.name,
    qtyKind: fields.qtyKind,
    amountMin: fields.amountMin ?? null,
    amountMax: fields.amountMax ?? null,
    unitCode: fields.unitCode ?? null,
    unitRaw: fields.unitRaw ?? null,
    roundClass: product.roundClass,
    minPiece: product.minPiece,
    note,
    confidence: Math.max(0, 10 - lost) / 10,
    reasons: penalties,
  };
}

const kindOf = (a: Amount): QtyKind => (a.max > a.min ? 'range' : 'exact');
const cleanName = (s: string) => trimEndChars(s.replace(/^(?:of|de)\s+/i, ''), ' ,:;-').trim();

/** One ingredient line, PRD 5.1.3 patterns P1-P5 in order, with confidence. */
export function parseIngredientLine(input: string, lang: Lang): IngredientCore {
  const line = readLine(input, lang);
  // Notes keep the text as written ("(1/2 стакана)"), so they come from the raw line.
  const notes: string[] = [];
  let bracketNumber = false;
  for (const m of line.raw.matchAll(BRACKETS)) {
    const inner = collapse(m[1]!);
    if (inner) notes.push(inner);
    if (/\d/.test(inner)) bracketNumber = true;
  }
  const text = trimEndChars(collapse(line.text.replace(BRACKETS, ' ')), '.,;').trim();
  const note = notes.length ? notes.join('; ') : null;
  const bracket: ParseReason[] = bracketNumber ? ['bracket'] : [];
  const lower = fold(text);

  // P1: PINCH NAME (an optional "1" before it)
  const pinchText = lower.replace(/^1 /, '');
  const offset = lower.length - pinchText.length;
  for (const p of PINCH) {
    if (pinchText.startsWith(`${p} `)) {
      const name = cleanName(text.slice(offset + p.length + 1));
      if (name) return result(line.raw, { name, qtyKind: 'pinch' }, bracket, note);
    }
  }
  // P2: NAME TASTE, and NAME - PINCH ("Сіль — щіпка")
  for (const [phrases, kind] of [
    [TASTE, 'to_taste'],
    [PINCH, 'pinch'],
  ] as const) {
    for (const p of phrases) {
      if (
        lower.endsWith(p) &&
        (lower.length === p.length || /[\s,:-]/.test(lower[lower.length - p.length - 1]!))
      ) {
        const name = cleanName(text.slice(0, text.length - p.length));
        if (name) return result(line.raw, { name, qtyKind: kind }, bracket, note);
      }
    }
  }
  // P3: (RANGE|NUM) UNIT? NAME
  const lead = amountAt(text);
  if (lead) {
    const words = lead.rest ? lead.rest.split(' ') : [];
    const unit = unitAt(words, lang);
    const name = cleanName(words.slice(unit?.used ?? 0).join(' '));
    if (name) {
      return result(
        line.raw,
        {
          name,
          qtyKind: kindOf(lead),
          amountMin: lead.min,
          amountMax: lead.max,
          unitCode: unit?.code ?? null,
        },
        [...(unit ? [] : (['no_unit'] as const)), ...bracket],
        note,
      );
    }
  }
  // P4: NAME - (RANGE|NUM) UNIT?  (also "NAME: AMOUNT UNIT")
  const from = Math.max(0, text.length - P4_TAIL);
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c !== '-' && c !== ':') continue;
    const name = cleanName(text.slice(0, i));
    const tail = amountAt(text.slice(i + 1).trim());
    if (!name || !tail) continue;
    const words = tail.rest ? tail.rest.split(' ') : [];
    const unit = unitAt(words, lang);
    let unitRaw: string | null = null;
    if (unit && unit.used !== words.length) continue;
    if (!unit && words.length > 0) {
      if (words.length !== 1 || !/^\p{L}{1,20}$/u.test(words[0]!)) continue;
      unitRaw = words[0]!;
    }
    return result(
      line.raw,
      {
        name,
        qtyKind: kindOf(tail),
        amountMin: tail.min,
        amountMax: tail.max,
        unitCode: unit?.code ?? null,
        unitRaw,
      },
      ['p4', ...(unit ? [] : (['no_unit'] as const)), ...bracket],
      note,
    );
  }
  // P5: NAME — "to taste" for salt and pepper, otherwise unparsed (kept as written).
  const parts = lower.split(SPICE_SEPARATOR).filter(Boolean);
  if (parts.length > 0 && parts.every((p) => SPICES.has(p))) {
    return result(line.raw, { name: text, qtyKind: 'to_taste' }, bracket, note);
  }
  return result(line.raw, { name: line.raw, qtyKind: 'unparsed' }, ['unparsed'], null);
}
