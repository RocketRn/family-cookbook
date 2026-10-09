import type { Fraction } from './types.js';

export const EPS = 1e-9;

export function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

/** A tie rounds up; the epsilon keeps 2.4999999999 (float noise for 2.5) from rounding down. */
export const floorHalfUp = (v: number): number => Math.floor(v + 0.5 + EPS);

/** Integer `n / d` split into whole part and reduced fraction (both exact integers). */
export function splitRational(n: number, d: number): { whole: number; fraction: Fraction | null } {
  const whole = Math.floor(n / d);
  const rest = n - whole * d;
  if (rest === 0) return { whole, fraction: null };
  const g = gcd(rest, d);
  return { whole, fraction: { num: rest / g, den: d / g } };
}

/** Exact representation of `x` as whole + fraction with a small denominator, if there is one. */
export function exactFraction(
  x: number,
  dens: readonly number[] = [2, 3, 4, 8],
): { whole: number; fraction: Fraction | null } | null {
  for (const d of dens) {
    const n = Math.round(x * d);
    if (Math.abs(n / d - x) < EPS) return splitRational(n, d);
  }
  return null;
}
