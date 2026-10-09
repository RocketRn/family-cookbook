import { describe, expect, it } from 'vitest';
import {
  assessFactor,
  factorFromIngredient,
  factorFromServings,
  formatAmount,
  RecalcError,
  roundAmount,
  scaleAmount,
  scaleRecipe,
  type IngredientAmount,
  type Lang,
  type ScaledAmount,
} from '../src/index.js';

const exact = (
  amount: number,
  unitCode: string | null,
  roundClass: IngredientAmount['roundClass'] = 'continuous',
  extra: Partial<IngredientAmount> = {},
): IngredientAmount => ({
  qtyKind: 'exact',
  amountMin: amount,
  amountMax: amount,
  unitCode,
  roundClass,
  minPiece: roundClass === 'whole_item' ? 1 : null,
  ...extra,
});
const range = (
  min: number,
  max: number,
  unitCode: string | null,
  extra: Partial<IngredientAmount> = {},
) => exact(min, unitCode, 'continuous', { qtyKind: 'range', amountMax: max, ...extra });

const fmt = (s: ScaledAmount, recipeLang: Lang = 'ru', uiLang: Lang = recipeLang) =>
  formatAmount(s, { recipeLang, uiLang });
const show = (ing: IngredientAmount, k: number, lang: Lang = 'ru') =>
  fmt(scaleAmount(ing, k), lang);
const value = (ing: IngredientAmount, k: number) => {
  const s = scaleAmount(ing, k);
  if (!s.scalable) throw new Error('not scalable');
  return s.min.value;
};

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof RecalcError) return e.code;
    throw e;
  }
  return undefined;
}

describe('factor limits (PRD 2.3, 5.2)', () => {
  it('warns for k < 0.25 or k > 4, refuses k < 0.05 or k > 20', () => {
    expect(assessFactor(1).warning).toBeNull();
    expect(assessFactor(0.25).warning).toBeNull();
    expect(assessFactor(4).warning).toBeNull();
    expect(assessFactor(0.2).warning).toBe('big_change');
    expect(assessFactor(4.5).warning).toBe('big_change');
    expect(assessFactor(0.05).warning).toBe('big_change');
    expect(assessFactor(20).warning).toBe('big_change');
    for (const k of [0.049, 20.01, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        codeOf(() => assessFactor(k)),
        String(k),
      ).toBe('K_OUT_OF_RANGE');
    }
  });

  it('stores k with 6 decimals; the exact k is used for maths', () => {
    expect(assessFactor(500 / 800).k6).toBe(0.625);
    expect(assessFactor(1 / 3).k6).toBe(0.333333);
  });

  it('very small and very large k still give sane, never-zero amounts', () => {
    expect(show(exact(800, 'g'), 0.05)).toBe('40 г');
    expect(show(exact(1, 'tsp'), 0.05)).toBe('⅛ ч. л.'); // never rounds a positive amount to 0
    expect(show(exact(3, 'pcs', 'whole_item'), 20)).toBe('60 шт.');
    expect(show(exact(2, 'cup'), 20)).toBe('40 стаканов');
  });
});

describe('factorFromServings / factorFromIngredient', () => {
  it('servings', () => {
    expect(factorFromServings(4, 6)).toBeCloseTo(1.5, 12);
    expect(codeOf(() => factorFromServings(4, 0))).toBe('BAD_INPUT');
    expect(codeOf(() => factorFromServings(0, 4))).toBe('BAD_INPUT');
    expect(codeOf(() => factorFromServings(4, -2))).toBe('BAD_INPUT');
  });

  it('converts compatible units through to_base (g/kg, ml/l)', () => {
    expect(factorFromIngredient(exact(0.8, 'kg'), 500, 'g')).toBeCloseTo(0.625, 12);
    expect(factorFromIngredient(exact(800, 'g'), 0.5, 'kg')).toBeCloseTo(0.625, 12);
    expect(factorFromIngredient(exact(1, 'l'), 250, 'ml')).toBeCloseTo(0.25, 12);
    expect(factorFromIngredient(exact(3, 'tbsp'), 2, 'tbsp')).toBeCloseTo(2 / 3, 12);
  });

  it('refuses different dimensions or inexact measures (stage 2 needs densities)', () => {
    expect(codeOf(() => factorFromIngredient(exact(2, 'cup'), 300, 'g'))).toBe('UNIT_MISMATCH');
    expect(codeOf(() => factorFromIngredient(exact(500, 'ml'), 2, 'cup'))).toBe('UNIT_MISMATCH');
    expect(codeOf(() => factorFromIngredient(exact(2, 'dl'), 200, 'ml'))).toBe('UNIT_MISMATCH');
    expect(codeOf(() => factorFromIngredient(exact(800, 'g'), 1, 'pcs'))).toBe('UNIT_MISMATCH');
  });

  it('a range uses its midpoint for k', () => {
    expect(factorFromIngredient(range(200, 300, 'g'), 125, 'g')).toBeCloseTo(0.5, 12);
  });

  it('rejects zero, negative or missing amounts and non-scalable lines', () => {
    expect(codeOf(() => factorFromIngredient(exact(800, 'g'), 0, 'g'))).toBe('BAD_INPUT');
    expect(codeOf(() => factorFromIngredient(exact(800, 'g'), -5, 'g'))).toBe('BAD_INPUT');
    expect(codeOf(() => factorFromIngredient(exact(0, 'g'), 5, 'g'))).toBe('BAD_INPUT');
    const toTaste: IngredientAmount = {
      qtyKind: 'to_taste',
      amountMin: null,
      amountMax: null,
      unitCode: null,
      roundClass: 'continuous',
    };
    expect(codeOf(() => factorFromIngredient(toTaste, 5, 'g'))).toBe('NOT_SCALABLE');
  });

  it('unknown units: same raw unit compares as-is', () => {
    const stopka = exact(2, null, 'continuous', { unitRaw: 'стопки' });
    expect(factorFromIngredient(stopka, 3, null)).toBeCloseTo(1.5, 12);
  });
});

describe('k = 1 shows amounts as written (no rounding)', () => {
  it.each<[IngredientAmount, string]>([
    [exact(1.5, 'cup'), '1½ стакана'],
    [exact(123.4, 'g'), '123,4 г'],
    [exact(4, 'pcs', 'whole_item'), '4 шт.'],
    [exact(1 / 3, 'cup'), '⅓ стакана'],
    [exact(0.3333, 'cup'), '⅓ стакана'], // numeric(12,4) storage of 1/3
    [exact(2.7, 'pcs', 'whole_item'), '2,7 шт.'],
  ])('%j', (ing, expected) => {
    const s = scaleAmount(ing, 1);
    expect(s.scalable && s.min.rounding).toBe('none');
    expect(fmt(s)).toBe(expected);
  });
});

describe('continuous rounding steps (PRD 5.3)', () => {
  it.each<[number, number]>([
    [0.123, 0.1],
    [0.125, 0.15], // a tie rounds up
    [3.14, 3.1],
    [12.3, 12.5],
    [57.4, 57],
    [57.5, 58],
    [333, 335],
    [1234, 1230],
    [2345, 2350],
  ])('%s g -> %s g', (x, expected) => {
    expect(value(exact(x, 'g'), 1.0000001)).toBeCloseTo(expected, 9);
  });

  it('kg and l use the step of the value in g / ml but keep the author unit', () => {
    expect(show(exact(0.8, 'kg'), 0.625)).toBe('0,5 кг');
    expect(show(exact(1.234, 'kg'), 1.0000001)).toBe('1,23 кг');
    expect(show(exact(1, 'l'), 0.333)).toBe('0,335 л');
  });

  it('floating point never leaks into the result', () => {
    const s = scaleAmount(exact(1, 'g'), 0.3);
    expect(fmt(s)).toBe('0,3 г');
    expect(s.scalable && s.min.value).toBeCloseTo(0.3, 15);
  });
});

describe('spoons and cups (PRD 5.3 table)', () => {
  it.each<[string, number, string]>([
    ['tsp', 0.3, '¼ ч. л.'],
    ['tsp', 0.06, '⅛ ч. л.'],
    ['tsp', 1.3, '1¼ ч. л.'],
    ['tsp', 5.3, '5½ ч. л.'],
    ['tsp', 12.3, '12 ч. л.'],
    ['tbsp', 0.4, '½ ст. л.'],
    ['tbsp', 2.2, '2 ст. л.'],
    ['tbsp', 4.6, '5 ст. л.'],
    ['cup', 0.6, '½ стакана'],
    ['cup', 4.3, '4½ стакана'],
    ['dl', 1.3, '1¼ дл'],
    ['msk', 1.3, '1½ ст. л.'],
  ])('%s %s -> %s', (unit, x, expected) => {
    expect(show(exact(x, unit), 1.0000001)).toBe(expected);
  });
});

describe('whole and spice items', () => {
  it('whole_item with min_piece 0.5 (onion): steps of ½, never below ½, no hint', () => {
    const onion = (n: number) => exact(n, 'pcs', 'whole_item', { minPiece: 0.5 });
    expect(show(onion(1), 1.3)).toBe('1½ шт.');
    expect(show(onion(1), 0.2)).toBe('½ шт.');
    const s = scaleAmount(onion(1), 1.3);
    expect(s.scalable && s.min.hint).toBeUndefined();
  });

  it('whole_item within 10% needs no hint', () => {
    expect(show(exact(10, 'pcs', 'whole_item'), 1.05)).toBe('11 шт.');
    const s = scaleAmount(exact(10, 'pcs', 'whole_item'), 0.96);
    expect(s.scalable && s.min.hint).toBeUndefined();
  });

  it('spice_item rounds to a whole number, at least 1', () => {
    expect(show(exact(1, 'pcs', 'spice_item'), 2.6)).toBe('3 шт.');
    expect(show(exact(1, 'pcs', 'spice_item'), 0.2)).toBe('1 шт.');
  });
});

describe('ranges', () => {
  it('each bound is rounded separately', () => {
    expect(show(range(200, 300, 'g'), 0.625)).toBe('125–190 г');
    expect(show(range(2, 3, 'pcs', { roundClass: 'whole_item', minPiece: 1 }), 1.5)).toBe(
      '3–5 шт.',
    );
  });

  it('bounds that coincide after rounding show one number', () => {
    const s = scaleAmount(range(1.9, 2.1, 'tbsp'), 0.5);
    expect(s.scalable && s.max).toBeNull();
    expect(fmt(s)).toBe('1 ст. л.');
  });

  it('k = 1 keeps the range as written', () => {
    expect(show(range(200, 300, 'ml'), 1)).toBe('200–300 мл');
  });
});

describe('zero, empty and unknown', () => {
  it('a zero amount stays zero (no "never zero" clamp for zero input)', () => {
    expect(show(exact(0, 'g'), 2)).toBe('0 г');
  });

  it('exact/range without an amount is treated as not scalable, never a crash', () => {
    const broken: IngredientAmount = {
      qtyKind: 'exact',
      amountMin: null,
      amountMax: null,
      unitCode: 'g',
      roundClass: 'continuous',
      rawLine: '?? г муки',
    };
    expect(scaleAmount(broken, 2)).toEqual({
      scalable: false,
      qtyKind: 'exact',
      rawLine: '?? г муки',
    });
  });

  it('unparsed lines are unchanged', () => {
    const line: IngredientAmount = {
      qtyKind: 'unparsed',
      amountMin: null,
      amountMax: null,
      unitCode: null,
      roundClass: 'continuous',
      rawLine: 'лавровый лист',
    };
    expect(scaleAmount(line, 3)).toEqual({
      scalable: false,
      qtyKind: 'unparsed',
      rawLine: 'лавровый лист',
    });
    expect(fmt(scaleAmount(line, 3))).toBe('');
  });

  it('unknown units are kept as written and scaled as plain numbers', () => {
    const stopka = exact(2, null, 'continuous', { unitRaw: 'стопки' });
    expect(show(stopka, 1.5)).toBe('3 стопки');
    expect(show(exact(2, null), 1.5)).toBe('3');
  });
});

describe('locales: numbers in the recipe language, hints in the UI language', () => {
  it('decimal separators and unit words', () => {
    expect(show(exact(0.8, 'kg'), 0.625, 'en')).toBe('0.5 kg');
    expect(show(exact(0.8, 'kg'), 0.625, 'sv')).toBe('0,5 kg');
    expect(show(exact(0.8, 'kg'), 0.625, 'uk')).toBe('0,5 кг');
    expect(show(exact(2, 'cup'), 0.625, 'en')).toBe('1¼ cups');
    expect(show(exact(1, 'cup'), 0.5, 'en')).toBe('½ cup');
    expect(show(exact(2, 'tbsp'), 1, 'sv')).toBe('2 msk');
  });

  it('ru and uk plural forms', () => {
    expect(show(exact(1, 'cup'), 1)).toBe('1 стакан');
    expect(show(exact(2, 'cup'), 1)).toBe('2 стакана');
    expect(show(exact(5, 'cup'), 1)).toBe('5 стаканов');
    expect(show(exact(21, 'cup'), 1)).toBe('21 стакан');
    expect(show(exact(5, 'cup'), 1, 'uk')).toBe('5 склянок');
    expect(show(exact(3, 'clove', 'whole_item'), 1)).toBe('3 зубчика');
  });

  it('hints in all four UI languages', () => {
    const s = scaleAmount(exact(1, 'pcs', 'whole_item'), 1.3);
    expect(fmt(s, 'en')).toBe('1 pc (or whisk 2 pcs and take ⅔)');
    expect(fmt(s, 'uk')).toBe('1 шт. (або збити 2 шт. і взяти ⅔)');
    expect(fmt(s, 'sv')).toBe('1 st (eller vispa 2 st och ta ⅔)');
    const s2 = scaleAmount(exact(4, 'pcs', 'whole_item'), 0.625);
    expect(fmt(s2, 'en')).toBe('3 pcs (or 2 pcs and ½ of one more)');
  });

  it('a Swedish recipe viewed in a Russian UI: amount in Swedish, hint in Russian', () => {
    const s = scaleAmount(exact(1, 'pcs', 'whole_item'), 1.3);
    expect(fmt(s, 'sv', 'ru')).toBe('1 st (или взбить 2 шт. и взять ⅔)');
  });

  it('non-scalable labels per recipe language', () => {
    const t: IngredientAmount = {
      qtyKind: 'to_taste',
      amountMin: null,
      amountMax: null,
      unitCode: null,
      roundClass: 'continuous',
    };
    const p: IngredientAmount = { ...t, qtyKind: 'pinch' };
    expect([
      fmt(scaleAmount(t, 2), 'en'),
      fmt(scaleAmount(t, 2), 'uk'),
      fmt(scaleAmount(t, 2), 'sv'),
    ]).toEqual(['to taste', 'до смаку', 'efter smak']);
    expect([
      fmt(scaleAmount(p, 2), 'en'),
      fmt(scaleAmount(p, 2), 'uk'),
      fmt(scaleAmount(p, 2), 'sv'),
    ]).toEqual(['a pinch', 'щіпка', 'en nypa']);
  });
});

describe('scaleRecipe and roundAmount', () => {
  it('scales every line with one k', () => {
    const out = scaleRecipe([exact(800, 'g'), exact(2, 'cup')], 0.625);
    expect(out.map((s) => fmt(s))).toEqual(['500 г', '1¼ стакана']);
  });

  it('roundAmount is the rounding used by scaling', () => {
    const q = roundAmount(1.875, { unitCode: 'tbsp', roundClass: 'continuous', minPiece: null });
    expect(q).toMatchObject({ value: 2, rounding: 'spoon_cup' });
  });
});
