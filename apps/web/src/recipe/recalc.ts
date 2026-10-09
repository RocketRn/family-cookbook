import {
  assessFactor,
  factorFromIngredient,
  factorFromServings,
  isScalable,
  RecalcError,
  UNITS,
  unitByCode,
  type RecalcErrorCode,
} from '@cookbook/recipe-core';
import type { Ingredient, Recipe } from '../api/types';
import { toAmountInput } from './amounts';

/**
 * FE-07 recalculation (PRD 5.2, 4.8; D-037). The engine and the rounding are recipe-core's; this
 * file only keeps what the user chose and checks it.
 */
export type RecalcInput =
  | { mode: 'servings'; servings: number }
  | { mode: 'product'; ingredientId: string; amount: number; unit: string | null };

/** PRD 4.8 `recalc:<recipe_id>`: the mode, the product and amount, and k (6 decimals). */
export type RecalcState = RecalcInput & { v: 1; k: number };

export type RecalcResult =
  | { ok: true; k: number; servings: number; warning: 'big_change' | null }
  | { ok: false; error: RecalcErrorCode };

export const recalcKey = (recipeId: string) => `recalc:${recipeId}`;

/** Ingredients the "from one product" mode can start from: those with a number. */
export const scalableIngredients = (r: Pick<Recipe, 'ingredients'>): Ingredient[] =>
  r.ingredients.filter((i) => isScalable(toAmountInput(i)));

/**
 * Units the user may enter for an ingredient: its own, and those it converts to exactly (g / kg,
 * ml / l). Anything else would need densities (stage 2), so it is not offered.
 */
export function unitOptions(ing: Ingredient): Array<string | null> {
  const own = unitByCode(ing.unit_code);
  if (!own || own.toBase === null) return [ing.unit_code];
  return [
    own.code,
    ...UNITS.filter(
      (u) => u.code !== own.code && u.toBase !== null && u.dimension === own.dimension,
    ).map((u) => u.code),
  ];
}

/** k for what the user entered, with the PRD 5.2 limits: warn below ¼ or above 4, refuse past 1/20 or 20. */
export function computeRecalc(r: Recipe, input: RecalcInput): RecalcResult {
  try {
    let k: number;
    if (input.mode === 'servings') k = factorFromServings(r.servings, input.servings);
    else {
      const ing = r.ingredients.find((i) => i.id === input.ingredientId);
      if (!ing) return { ok: false, error: 'BAD_INPUT' };
      k = factorFromIngredient(toAmountInput(ing), input.amount, input.unit);
    }
    const a = assessFactor(k);
    return { ok: true, k: a.k6, servings: r.servings * a.k6, warning: a.warning };
  } catch (err) {
    if (err instanceof RecalcError) return { ok: false, error: err.code };
    throw err;
  }
}

/** The saved choice for a recipe, checked again against the recipe as it is now. */
export function readRecalc(r: Recipe): RecalcState | null {
  let raw: unknown;
  try {
    raw = JSON.parse(localStorage.getItem(recalcKey(r.id)) ?? 'null');
  } catch {
    return null;
  }
  const s = raw as Partial<RecalcState> | null;
  if (!s || s.v !== 1) return null;
  let input: RecalcInput;
  if (s.mode === 'servings' && typeof s.servings === 'number')
    input = { mode: 'servings', servings: s.servings };
  else if (
    s.mode === 'product' &&
    typeof s.ingredientId === 'string' &&
    typeof s.amount === 'number' &&
    (typeof s.unit === 'string' || s.unit === null)
  )
    input = { mode: 'product', ingredientId: s.ingredientId, amount: s.amount, unit: s.unit };
  else return null;
  // The recipe may have changed since (servings, the product): recompute rather than trust k.
  const res = computeRecalc(r, input);
  return res.ok ? { ...input, v: 1, k: res.k } : null;
}

export function writeRecalc(recipeId: string, state: RecalcState | null): void {
  try {
    if (state) localStorage.setItem(recalcKey(recipeId), JSON.stringify(state));
    else localStorage.removeItem(recalcKey(recipeId));
  } catch {
    /* storage unavailable: the recalculation simply is not remembered */
  }
}
