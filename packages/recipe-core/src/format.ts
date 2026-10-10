import { EPS } from './fraction.js';
import { fractionFriendly } from './round.js';
import type { Fraction, Hint, Lang, Quantity, ScaledAmount } from './types.js';
import { unitByCode } from './units.js';

/**
 * Turns structured quantities into text. Numbers and units follow the RECIPE language (PRD 1.5 #5:
 * the recipe language chooses unit declensions); hints follow the UI language (PRD 5.3), except
 * the unit word inside a hint, which stays in the recipe language so that a line never mixes
 * "2 pcs" and "1 шт." (owner's Sprint 6 answer 4).
 * Texts for uk and sv need native review (docs/ASSUMPTIONS.md).
 */
export type FormatOptions = { recipeLang: Lang; uiLang: Lang };

const GLYPHS: Record<string, string> = {
  '1/2': '½',
  '1/3': '⅓',
  '2/3': '⅔',
  '1/4': '¼',
  '3/4': '¾',
  '1/8': '⅛',
  '3/8': '⅜',
  '5/8': '⅝',
  '7/8': '⅞',
};
const DISPLAY_FRACTIONS: readonly Fraction[] = [2, 3, 4, 8].flatMap((den) =>
  Array.from({ length: den - 1 }, (_, i) => ({ num: i + 1, den })),
);

const NON_SCALABLE: Record<'to_taste' | 'pinch', Record<Lang, string>> = {
  to_taste: { ru: 'по вкусу', uk: 'до смаку', en: 'to taste', sv: 'efter smak' },
  pinch: { ru: 'щепотка', uk: 'щіпка', en: 'a pinch', sv: 'en nypa' },
};

/**
 * Hints for whole items (PRD 5.3). Owner decision (D-037): eggs keep "whisk N and take ⅔"; other
 * whole items say "take N and use ⅔".
 */
const HINTS: Record<Lang, Record<'whisk' | 'take' | 'whole_plus_fraction', string>> = {
  ru: {
    whisk: 'или взбить {n}{unit} и взять {f}',
    take: 'или взять {n}{unit} и использовать {f}',
    whole_plus_fraction: 'или {n}{unit} и {f} ещё одного',
  },
  uk: {
    whisk: 'або збити {n}{unit} і взяти {f}',
    take: 'або взяти {n}{unit} і використати {f}',
    whole_plus_fraction: 'або {n}{unit} і {f} ще одного',
  },
  en: {
    whisk: 'or whisk {n}{unit} and take {f}',
    take: 'or take {n}{unit} and use {f}',
    whole_plus_fraction: 'or {n}{unit} and {f} of one more',
  },
  sv: {
    whisk: 'eller vispa {n}{unit} och ta {f}',
    take: 'eller ta {n}{unit} och använd {f}',
    whole_plus_fraction: 'eller {n}{unit} och {f} av en till',
  },
};

const decimalFormats = new Map<Lang, Intl.NumberFormat>();
function decimal(value: number, lang: Lang): string {
  let f = decimalFormats.get(lang);
  if (!f) {
    f = new Intl.NumberFormat(lang, { maximumFractionDigits: 3, useGrouping: false });
    decimalFormats.set(lang, f);
  }
  return f.format(value);
}

export const fractionGlyph = (f: Fraction): string =>
  GLYPHS[`${f.num}/${f.den}`] ?? `${f.num}/${f.den}`;

function mixed(whole: number, f: Fraction): string {
  const g = fractionGlyph(f);
  if (whole <= 0) return g;
  return g.includes('/') ? `${whole} ${g}` : `${whole}${g}`;
}

/** Display tolerance for amounts stored with 4 decimals (1/3 is stored as 0.3333). */
const STORED_PRECISION = 6e-5;

function numberText(q: Quantity, lang: Lang): string {
  if (q.fraction) return mixed(q.whole, q.fraction);
  if (q.rounding === 'none' && fractionFriendly({ unitCode: q.unit, roundClass: 'continuous' })) {
    const whole = Math.floor(q.value + EPS);
    const rest = q.value - whole;
    const f = DISPLAY_FRACTIONS.find((d) => Math.abs(rest - d.num / d.den) < STORED_PRECISION);
    if (f) return mixed(whole, f);
  }
  return decimal(q.value, lang);
}

type Category = 'one' | 'few' | 'many' | 'other';
const pluralRules = new Map<Lang, Intl.PluralRules>();
function category(value: number, lang: Lang): Category {
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) < EPS) {
    let r = pluralRules.get(lang);
    if (!r) {
      r = new Intl.PluralRules(lang);
      pluralRules.set(lang, r);
    }
    return r.select(rounded) as Category;
  }
  // Fractional amounts: ru/uk use the genitive singular ("1¼ стакана"); en/sv are singular below 1.
  if (lang === 'ru' || lang === 'uk') return 'other';
  return value < 1 ? 'one' : 'other';
}

export function unitLabel(code: string | null, lang: Lang, value: number): string | null {
  const label = unitByCode(code)?.labels[lang];
  if (label === undefined) return null;
  if (typeof label === 'string') return label;
  return label[category(value, lang)] ?? label.other;
}

function withUnit(numbers: string, unit: string | null): string {
  return unit ? `${numbers} ${unit}` : numbers;
}

function hintText(
  hint: Hint,
  q: Quantity,
  unitRaw: string | null,
  lang: Lang,
  unitLang: Lang,
): string {
  const n = hint.kind === 'take_fraction_of' ? hint.pieces : hint.whole;
  const unit = unitLabel(q.unit, unitLang, n) ?? (unitRaw?.trim() || null);
  const pattern =
    hint.kind === 'whole_plus_fraction'
      ? HINTS[lang].whole_plus_fraction
      : hint.whisk
        ? HINTS[lang].whisk
        : HINTS[lang].take;
  return pattern
    .replace('{n}', String(n))
    .replace('{unit}', unit ? ` ${unit}` : '')
    .replace('{f}', fractionGlyph(hint.fraction));
}

/** The amount part of an ingredient line, e.g. "1¼ стакана", "3 шт. (или 2 шт. и ½ ещё одного)". */
export function formatAmount(s: ScaledAmount, { recipeLang, uiLang }: FormatOptions): string {
  if (!s.scalable) {
    return s.qtyKind === 'to_taste' || s.qtyKind === 'pinch'
      ? NON_SCALABLE[s.qtyKind][recipeLang]
      : '';
  }
  const last = s.max ?? s.min;
  const unit = unitLabel(last.unit, recipeLang, last.value) ?? (s.unitRaw?.trim() || null);
  const numbers = s.max
    ? `${numberText(s.min, recipeLang)}–${numberText(s.max, recipeLang)}`
    : numberText(s.min, recipeLang);
  const text = withUnit(numbers, unit);
  return s.min.hint
    ? `${text} (${hintText(s.min.hint, s.min, s.unitRaw, uiLang, recipeLang)})`
    : text;
}
