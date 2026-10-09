import { EPS } from './fraction.js';
import { asWritten, roundAmount } from './round.js';
import type { IngredientAmount, ScaledAmount } from './types.js';
import { unitByCode } from './units.js';

export type RecalcErrorCode = 'NOT_SCALABLE' | 'UNIT_MISMATCH' | 'BAD_INPUT' | 'K_OUT_OF_RANGE';

export class RecalcError extends Error {
  constructor(readonly code: RecalcErrorCode) {
    super(`Recalculation error: ${code}`);
  }
}

/** PRD 5.2: warn outside [0.25; 4], refuse outside [0.05; 20]. */
export const K_LIMITS = { min: 0.05, warnLow: 0.25, warnHigh: 4, max: 20 } as const;

export function assessFactor(k: number): { k: number; k6: number; warning: 'big_change' | null } {
  if (!Number.isFinite(k) || k < K_LIMITS.min - EPS || k > K_LIMITS.max + EPS) {
    throw new RecalcError('K_OUT_OF_RANGE');
  }
  const warning = k < K_LIMITS.warnLow - EPS || k > K_LIMITS.warnHigh + EPS ? 'big_change' : null;
  // The exact k is stored with 6 decimals; only what the user sees is rounded (PRD 5.2).
  return { k, k6: Math.round(k * 1e6) / 1e6, warning };
}

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

export function factorFromServings(baseServings: number, targetServings: number): number {
  if (!positive(baseServings) || !positive(targetServings)) throw new RecalcError('BAD_INPUT');
  return targetServings / baseServings;
}

/** True when the line has a numeric amount that recalculation may change. */
export function isScalable(ing: IngredientAmount): boolean {
  if (ing.qtyKind !== 'exact' && ing.qtyKind !== 'range') return false;
  const max = ing.qtyKind === 'range' ? ing.amountMax : ing.amountMin;
  return Number.isFinite(ing.amountMin) && Number.isFinite(max);
}

/** Converts between units of one dimension that both have an exact factor (g/kg, ml/l). */
export function convert(value: number, from: string | null, to: string | null): number {
  if (from === to) return value;
  const a = unitByCode(from);
  const b = unitByCode(to);
  if (!a || !b || a.toBase === null || b.toBase === null || a.dimension !== b.dimension) {
    throw new RecalcError('UNIT_MISMATCH');
  }
  return (value * a.toBase) / b.toBase;
}

/** k from "I have `available` `unitIn` of this ingredient" (PRD 5.2; a range uses its midpoint). */
export function factorFromIngredient(
  ing: IngredientAmount,
  available: number,
  unitIn: string | null,
): number {
  if (!isScalable(ing)) {
    if (ing.qtyKind === 'exact' || ing.qtyKind === 'range') throw new RecalcError('BAD_INPUT');
    throw new RecalcError('NOT_SCALABLE');
  }
  const max = ing.qtyKind === 'range' ? ing.amountMax! : ing.amountMin!;
  const base = (ing.amountMin! + max) / 2;
  if (!positive(base) || !positive(available)) throw new RecalcError('BAD_INPUT');
  return convert(available, unitIn, ing.unitCode) / base;
}

/** Applies k to one line and rounds it for display (PRD 5.2 scaleRecipe, 5.3 rounding). */
export function scaleAmount(ing: IngredientAmount, k: number): ScaledAmount {
  if (!isScalable(ing))
    return { scalable: false, qtyKind: ing.qtyKind, rawLine: ing.rawLine ?? '' };
  if (!positive(k)) throw new RecalcError('BAD_INPUT');
  const spec = {
    unitCode: ing.unitCode,
    roundClass: ing.roundClass,
    minPiece: ing.minPiece ?? null,
  };
  const lo = ing.amountMin!;
  const hi = ing.qtyKind === 'range' ? ing.amountMax! : lo;
  const isRange = Math.abs(hi - lo) > EPS;
  const unitRaw = ing.unitRaw ?? null;

  // At k = 1 the numbers are shown exactly as the author wrote them.
  if (Math.abs(k - 1) < EPS) {
    return {
      scalable: true,
      min: asWritten(lo, spec),
      max: isRange ? asWritten(hi, spec) : null,
      unitRaw,
    };
  }
  const min = roundAmount(lo * k, spec);
  if (!isRange) return { scalable: true, min, max: null, unitRaw };
  const { hint, ...max } = roundAmount(hi * k, spec); // only the lower bound carries a hint
  return { scalable: true, min, max: Math.abs(max.value - min.value) < EPS ? null : max, unitRaw };
}

export const scaleRecipe = (lines: readonly IngredientAmount[], k: number): ScaledAmount[] =>
  lines.map((l) => scaleAmount(l, k));
