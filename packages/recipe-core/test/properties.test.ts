/** Property-based tests listed in PRD 5.4 (fast-check). */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { roundAmount, scaleAmount, type IngredientAmount, type RoundClass } from '../src/index.js';

// FC_RUNS lets a local run go deeper than CI's default 100 cases per property.
fc.configureGlobal({ numRuns: Number(process.env.FC_RUNS ?? 200) });

const EPS = 1e-9;
const UNITS = [
  'g',
  'kg',
  'ml',
  'l',
  'tsp',
  'tbsp',
  'cup',
  'dl',
  'msk',
  'tsk',
  'krm',
  'pcs',
  'clove',
  null,
];
const spec = fc.record({
  unitCode: fc.constantFrom(...UNITS),
  roundClass: fc.constantFrom<RoundClass>('continuous', 'whole_item', 'spice_item'),
  minPiece: fc.constantFrom(0.5, 1),
});
const amount = fc.double({ min: 0.01, max: 10_000, noNaN: true, noDefaultInfinity: true });
const k = fc.double({ min: 0.05, max: 20, noNaN: true, noDefaultInfinity: true });

const ing = (
  a: number,
  s: { unitCode: string | null; roundClass: RoundClass; minPiece: number },
): IngredientAmount => ({
  qtyKind: 'exact',
  amountMin: a,
  amountMax: a,
  unitCode: s.unitCode,
  roundClass: s.roundClass,
  minPiece: s.minPiece,
});

describe('PRD 5.4 properties', () => {
  it('(1) at k = 1 the output equals the original', () => {
    fc.assert(
      fc.property(amount, spec, (a, s) => {
        const r = scaleAmount(ing(a, s), 1);
        return r.scalable && Math.abs(r.min.value - a) < EPS && r.min.rounding === 'none';
      }),
    );
  });

  it('(2) rounding is monotonic: x1 <= x2 => round(x1) <= round(x2)', () => {
    fc.assert(
      fc.property(amount, amount, spec, (x1, x2, s) => {
        const [lo, hi] = x1 <= x2 ? [x1, x2] : [x2, x1];
        return roundAmount(lo, s).value <= roundAmount(hi, s).value + EPS;
      }),
    );
  });

  it('(3) rounding is idempotent: round(round(x)) = round(x)', () => {
    fc.assert(
      fc.property(amount, spec, (x, s) => {
        const once = roundAmount(x, s).value;
        return Math.abs(roundAmount(once, s).value - once) < EPS;
      }),
    );
  });

  it('(4) to_taste / pinch / unparsed never change for any k', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('to_taste', 'pinch', 'unparsed') as fc.Arbitrary<
          IngredientAmount['qtyKind']
        >,
        k,
        fc.string(),
        (qtyKind, kk, rawLine) => {
          const line: IngredientAmount = {
            qtyKind,
            amountMin: null,
            amountMax: null,
            unitCode: null,
            roundClass: 'continuous',
            rawLine,
          };
          expect(scaleAmount(line, kk)).toEqual({ scalable: false, qtyKind, rawLine });
        },
      ),
    );
  });

  it('(5) continuous relative error is at most 5% on x in [1; 5000]', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 5000, noNaN: true }),
        fc.constantFrom('g', 'ml', null),
        (x, unitCode) => {
          const r = roundAmount(x, { unitCode, roundClass: 'continuous', minPiece: null });
          return Math.abs(r.value - x) / x <= 0.05 + EPS;
        },
      ),
    );
  });

  it('(6) a whole_item result is always >= min_piece', () => {
    fc.assert(
      fc.property(amount, k, fc.constantFrom(0.5, 1), (a, kk, m) => {
        const r = scaleAmount(
          ing(a, { unitCode: 'pcs', roundClass: 'whole_item', minPiece: m }),
          kk,
        );
        return r.scalable && r.min.value >= m - EPS;
      }),
    );
  });

  it('extra: a positive amount never rounds to zero, and whole + fraction equals value', () => {
    fc.assert(
      fc.property(amount, k, spec, (a, kk, s) => {
        const r = scaleAmount(ing(a, s), kk);
        if (!r.scalable) return false;
        const f = r.min.fraction ? r.min.fraction.num / r.min.fraction.den : 0;
        return (
          r.min.value > 0 &&
          (r.min.fraction === null || Math.abs(r.min.whole + f - r.min.value) < EPS)
        );
      }),
    );
  });
});
