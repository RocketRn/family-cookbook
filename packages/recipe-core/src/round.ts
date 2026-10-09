import { EPS, exactFraction, floorHalfUp, splitRational } from './fraction.js';
import type { Fraction, Hint, Quantity, RoundSpec } from './types.js';
import { unitByCode, type UnitFamily } from './units.js';

/** A rounding step as an exact fraction num/den, so results are built from integers (no float drift). */
type Step = { num: number; den: number };
type Bands = ReadonlyArray<readonly [upper: number, step: Step]>;
const s = (num: number, den = 1): Step => ({ num, den });

/** PRD 5.3, class `continuous`, by magnitude of the value in g / ml (relative error <= 5%). */
const METRIC: Bands = [
  [1, s(1, 20)],
  [5, s(1, 10)],
  [20, s(1, 2)],
  [100, s(1)],
  [500, s(5)],
  [2000, s(10)],
  [Infinity, s(50)],
];
/** PRD 5.3, spoons and cups: fractions a person can actually measure. */
const SPOONS: Record<'tsp' | 'tbsp' | 'cup', Bands> = {
  tsp: [
    [1, s(1, 8)],
    [4, s(1, 4)],
    [10, s(1, 2)],
    [Infinity, s(1)],
  ], // tsp, tsk, krm
  tbsp: [
    [1, s(1, 4)],
    [4, s(1, 2)],
    [Infinity, s(1)],
  ], // tbsp, msk
  cup: [
    [1, s(1, 4)],
    [4, s(1, 4)],
    [Infinity, s(1, 2)],
  ], // cup, dl
};
/** Fractions a hint may use (PRD 5.3 roundWhole). */
const HINT_FRACTIONS: readonly Fraction[] = [
  { num: 1, den: 4 },
  { num: 1, den: 3 },
  { num: 1, den: 2 },
  { num: 2, den: 3 },
  { num: 3, den: 4 },
];

const stepFor = (bands: Bands, x: number): Step => bands.find(([upper]) => x < upper - EPS)![1];

/** Number of steps nearest to x; a positive amount never rounds down to zero. */
const stepsFor = (x: number, step: Step): number =>
  Math.max(1, floorHalfUp((x * step.den) / step.num));

function quantity(
  num: number,
  den: number,
  rawFloat: number,
  spec: RoundSpec,
  rounding: Quantity['rounding'],
  asFraction: boolean,
  hint?: Hint,
): Quantity {
  const value = num / den;
  const parts = asFraction ? splitRational(num, den) : { whole: Math.trunc(value), fraction: null };
  return {
    value,
    whole: parts.whole,
    fraction: parts.fraction,
    rawFloat,
    unit: unitByCode(spec.unitCode)?.code ?? null,
    rounding,
    ...(hint ? { hint } : {}),
    scalable: true,
  };
}

const snapHint = (v: number): Fraction | undefined =>
  HINT_FRACTIONS.find((f) => Math.abs(v - f.num / f.den) <= 0.04 + EPS);

function roundWhole(x: number, spec: RoundSpec): Quantity {
  const m = spec.minPiece && spec.minPiece > 0 ? spec.minPiece : 1;
  const mf = exactFraction(m, [1, 2, 3, 4, 8]);
  // min_piece is numeric(4,2): an exact small fraction (½, ¼) when possible, else hundredths (0.33).
  const step = mf
    ? s(mf.whole * (mf.fraction?.den ?? 1) + (mf.fraction?.num ?? 0), mf.fraction?.den ?? 1)
    : s(Math.round(m * 100), 100);
  const count = stepsFor(x, step);
  const n = (count * step.num) / step.den;
  let hint: Hint | undefined;
  // PRD 5.3: no hint within 10%, or for divisible items (m < 1).
  if (Math.abs(x - n) / x > 0.1 + EPS && m >= 1) {
    const c = Math.ceil(x - EPS);
    const f1 = snapHint(x / c);
    if (f1 && c > 1) hint = { kind: 'take_fraction_of', pieces: c, fraction: f1 };
    else {
      const lo = Math.floor(x + EPS);
      const f2 = snapHint(x - lo);
      if (f2 && lo >= 1) hint = { kind: 'whole_plus_fraction', whole: lo, fraction: f2 };
    }
  }
  return quantity(count * step.num, step.den, x, spec, 'whole_item', true, hint);
}

function roundSpice(x: number, spec: RoundSpec): Quantity {
  return quantity(Math.max(1, floorHalfUp(x)), 1, x, spec, 'spice_item', true);
}

function roundSpoon(x: number, spec: RoundSpec, family: 'tsp' | 'tbsp' | 'cup'): Quantity {
  const step = stepFor(SPOONS[family], x);
  return quantity(stepsFor(x, step) * step.num, step.den, x, spec, 'spoon_cup', true);
}

function roundContinuous(x: number, spec: RoundSpec): Quantity {
  const unit = unitByCode(spec.unitCode);
  // kg and l: the step is chosen and applied in g / ml; the author's unit is kept.
  const toBase = unit?.family === 'metric' && unit.toBase ? unit.toBase : 1;
  const step = stepFor(METRIC, x * toBase);
  return quantity(
    stepsFor(x * toBase, step) * step.num,
    step.den * toBase,
    x,
    spec,
    'continuous',
    false,
  );
}

const SPOON_FAMILIES = new Set<UnitFamily>(['tsp', 'tbsp', 'cup']);

/** Rounds a scaled amount by the ingredient's class and unit (PRD 5.3). x must be >= 0. */
export function roundAmount(x: number, spec: RoundSpec): Quantity {
  if (!(x > 0)) return zero(spec);
  if (spec.roundClass === 'whole_item') return roundWhole(x, spec);
  if (spec.roundClass === 'spice_item') return roundSpice(x, spec);
  const family = unitByCode(spec.unitCode)?.family;
  if (family && SPOON_FAMILIES.has(family))
    return roundSpoon(x, spec, family as 'tsp' | 'tbsp' | 'cup');
  return roundContinuous(x, spec);
}

function zero(spec: RoundSpec): Quantity {
  return quantity(
    0,
    1,
    0,
    spec,
    spec.roundClass === 'continuous' ? 'continuous' : spec.roundClass,
    false,
  );
}

/** Units whose amounts read naturally as fractions (½ cup, 1½ pcs) rather than decimals (0,5 kg). */
export function fractionFriendly(spec: RoundSpec): boolean {
  if (spec.roundClass !== 'continuous') return true;
  const family = unitByCode(spec.unitCode)?.family;
  return family !== undefined && family !== 'metric';
}

/** k = 1: the amount exactly as written, no rounding (PRD 5.2). */
export function asWritten(a: number, spec: RoundSpec): Quantity {
  const exact = fractionFriendly(spec) ? exactFraction(a) : null;
  return {
    value: a,
    whole: exact ? exact.whole : Math.trunc(a),
    fraction: exact ? exact.fraction : null,
    rawFloat: a,
    unit: unitByCode(spec.unitCode)?.code ?? null,
    rounding: 'none',
    scalable: true,
  };
}
