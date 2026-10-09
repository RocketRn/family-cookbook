/**
 * Golden tests (kickoff prompt section 5 + PRD 5.3 / 5.4). Written BEFORE the engine.
 * Engine level: structured quantities. Formatter level: exact Russian strings.
 */
import { describe, expect, it } from 'vitest';
import {
  factorFromIngredient,
  factorFromServings,
  formatAmount,
  scaleAmount,
  type IngredientAmount,
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

const eggs = (n: number) => exact(n, 'pcs', 'whole_item', { rawLine: `${n} яйца` });
const bay = (n: number) => exact(n, 'pcs', 'spice_item', { rawLine: 'лавровый лист' });
const salt: IngredientAmount = {
  qtyKind: 'to_taste',
  amountMin: null,
  amountMax: null,
  unitCode: null,
  roundClass: 'continuous',
  rawLine: 'соль по вкусу',
};
const nutmeg: IngredientAmount = {
  qtyKind: 'pinch',
  amountMin: null,
  amountMax: null,
  unitCode: null,
  roundClass: 'continuous',
  rawLine: 'щепотка мускатного ореха',
};

const ru = (s: ScaledAmount) => formatAmount(s, { recipeLang: 'ru', uiLang: 'ru' });

function scalable(s: ScaledAmount) {
  if (!s.scalable) throw new Error('expected a scalable amount');
  return s;
}

describe('golden: engine level (structured quantities)', () => {
  it('1.3 eggs (whole_item) -> 1, hint "whisk 2, take 2/3"', () => {
    const s = scalable(scaleAmount(eggs(1), 1.3));
    expect(s.max).toBeNull();
    expect(s.min).toMatchObject({
      value: 1,
      whole: 1,
      fraction: null,
      unit: 'pcs',
      rounding: 'whole_item',
      scalable: true,
      hint: { kind: 'take_fraction_of', pieces: 2, fraction: { num: 2, den: 3 } },
    });
    expect(s.min.rawFloat).toBeCloseTo(1.3, 9);
  });

  it('2.5 eggs (whole_item) -> 3, hint "2 and 1/2 of one more"', () => {
    const s = scalable(scaleAmount(eggs(4), 0.625));
    expect(s.min).toMatchObject({
      value: 3,
      whole: 3,
      fraction: null,
      rounding: 'whole_item',
      hint: { kind: 'whole_plus_fraction', whole: 2, fraction: { num: 1, den: 2 } },
    });
    expect(s.min.rawFloat).toBeCloseTo(2.5, 9);
  });

  it('0.7 bay leaf (spice_item) -> 1, no hint', () => {
    const s = scalable(scaleAmount(bay(1), 0.7));
    expect(s.min).toMatchObject({ value: 1, whole: 1, fraction: null, rounding: 'spice_item' });
    expect(s.min.hint).toBeUndefined();
  });

  it('1.875 tbsp -> 2 (spoon_cup)', () => {
    const s = scalable(scaleAmount(exact(3, 'tbsp'), 0.625));
    expect(s.min).toMatchObject({
      value: 2,
      whole: 2,
      fraction: null,
      unit: 'tbsp',
      rounding: 'spoon_cup',
    });
    expect(s.min.rawFloat).toBeCloseTo(1.875, 9);
  });

  it('1.25 cup -> { whole: 1, fraction: 1/4, rawFloat: 1.25 }', () => {
    const s = scalable(scaleAmount(exact(2, 'cup'), 0.625));
    expect(s.min).toMatchObject({ whole: 1, fraction: { num: 1, den: 4 }, rounding: 'spoon_cup' });
    expect(s.min.value).toBeCloseTo(1.25, 12);
    expect(s.min.rawFloat).toBeCloseTo(1.25, 12);
  });

  it.each([0.05, 0.5, 1, 1.7, 20])(
    '"salt to taste" is unchanged for k = %s, scalable: false',
    (k) => {
      expect(scaleAmount(salt, k)).toEqual({
        scalable: false,
        qtyKind: 'to_taste',
        rawLine: 'соль по вкусу',
      });
    },
  );

  it.each([0.05, 0.5, 1, 1.7, 20])(
    '"a pinch of nutmeg" is unchanged for k = %s, scalable: false',
    (k) => {
      expect(scaleAmount(nutmeg, k)).toEqual({
        scalable: false,
        qtyKind: 'pinch',
        rawLine: 'щепотка мускатного ореха',
      });
    },
  );
});

describe('golden: formatter level (exact ru strings)', () => {
  it.each<[string, () => ScaledAmount, string]>([
    ['1.3 eggs', () => scaleAmount(eggs(1), 1.3), '1 шт. (или взбить 2 шт. и взять ⅔)'],
    ['2.5 eggs', () => scaleAmount(eggs(4), 0.625), '3 шт. (или 2 шт. и ½ ещё одного)'],
    ['0.7 bay leaf', () => scaleAmount(bay(1), 0.7), '1 шт.'],
    ['1.875 tbsp', () => scaleAmount(exact(3, 'tbsp'), 0.625), '2 ст. л.'],
    ['1.25 cup', () => scaleAmount(exact(2, 'cup'), 0.625), '1¼ стакана'],
    ['salt to taste', () => scaleAmount(salt, 3), 'по вкусу'],
    ['a pinch of nutmeg', () => scaleAmount(nutmeg, 3), 'щепотка'],
  ])('%s', (_name, make, expected) => {
    expect(ru(make())).toBe(expected);
  });
});

describe('PRD 5.4 verification table: 4 servings, minced meat 800 g -> 500 g', () => {
  const farsh = exact(800, 'g');
  const k = factorFromIngredient(farsh, 500, 'g');

  it('k = 0.625 and servings ≈ 2.5', () => {
    expect(k).toBeCloseTo(0.625, 12);
    expect(4 * k).toBeCloseTo(2.5, 12);
    expect(factorFromServings(4, 2.5)).toBeCloseTo(0.625, 12);
  });

  it.each<[string, IngredientAmount, string]>([
    ['Фарш 800 г', farsh, '500 г'],
    ['Яйца 4 шт.', eggs(4), '3 шт. (или 2 шт. и ½ ещё одного)'],
    ['Мука 2 стакана', exact(2, 'cup'), '1¼ стакана'],
    ['Сметана 3 ст. л.', exact(3, 'tbsp'), '2 ст. л.'],
    ['Лавровый лист 2 шт.', bay(2), '1 шт.'],
    ['Соль по вкусу', salt, 'по вкусу'],
  ])('%s', (_name, ing, expected) => {
    expect(ru(scaleAmount(ing, k))).toBe(expected);
  });

  it('brief examples: egg 1 pc x1.3, bay leaf 1 pc x0.7, a pinch of salt', () => {
    expect(ru(scaleAmount(eggs(1), 1.3))).toBe('1 шт. (или взбить 2 шт. и взять ⅔)');
    expect(ru(scaleAmount(bay(1), 0.7))).toBe('1 шт.');
    expect(ru(scaleAmount({ ...nutmeg, rawLine: 'щепотка соли' }, 2))).toBe('щепотка');
  });
});
