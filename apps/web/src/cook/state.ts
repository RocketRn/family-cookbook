import type { Recipe } from '../api/types';
import type { RecalcState } from '../recipe/recalc';

/**
 * PRD 4.8 `cook:<recipe_id>`: cooking progress, kept on this device. Written on every step and
 * every tick, so a reload, a closed app or a lost connection loses nothing; dropped after 24 hours
 * without activity, and when cooking is finished.
 */
export const COOK_TTL_MS = 24 * 3600_000;
export const cookKey = (recipeId: string) => `cook:${recipeId}`;

/** The recalculation the cooking started with (PRD 4.8 `scale`); null = as written. */
export type CookScale =
  | { mode: 'servings'; servings: number; k: number }
  | { mode: 'ingredient'; ingredient_id: string; amount: number; unit: string | null; k: number };

/** A running timer as the device knows it (FE-09). */
export type CookTimer = {
  client_timer_id: string;
  server_id: string | null;
  step_id: string | null;
  label: string;
  duration_sec: number;
  started_at: string;
  ends_at: string;
  synced: boolean;
};

export type CookState = {
  v: 1;
  recipe_id: string;
  recipe_version: number;
  scale: CookScale | null;
  step_index: number;
  checked_ingredients: string[];
  timers: CookTimer[];
  /** false while on the Preparation screen. */
  started: boolean;
  /** POST /cook-sessions (analytics, best effort); null until the server answered. */
  session_id: string | null;
  /** The recipe as cooking started: finished on it even if the author edits it (PRD 2.4). */
  recipe: Recipe;
  updated_at: string;
};

export function scaleFromRecalc(r: RecalcState | null): CookScale | null {
  if (!r) return null;
  return r.mode === 'servings'
    ? { mode: 'servings', servings: r.servings, k: r.k }
    : { mode: 'ingredient', ingredient_id: r.ingredientId, amount: r.amount, unit: r.unit, k: r.k };
}

export function newCookState(recipe: Recipe, recalc: RecalcState | null): CookState {
  return {
    v: 1,
    recipe_id: recipe.id,
    recipe_version: recipe.version,
    scale: scaleFromRecalc(recalc),
    step_index: 0,
    checked_ingredients: [],
    timers: [],
    started: false,
    session_id: null,
    recipe,
    updated_at: new Date().toISOString(),
  };
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
const isStr = (x: unknown): x is string => typeof x === 'string';

function validScale(s: unknown): boolean {
  if (s === null) return true;
  if (!isObj(s) || typeof s.k !== 'number' || !(s.k > 0)) return false;
  if (s.mode === 'servings') return typeof s.servings === 'number';
  return (
    s.mode === 'ingredient' &&
    isStr(s.ingredient_id) &&
    typeof s.amount === 'number' &&
    (isStr(s.unit) || s.unit === null)
  );
}

function validTimer(t: unknown): boolean {
  return (
    isObj(t) &&
    isStr(t.client_timer_id) &&
    (isStr(t.server_id) || t.server_id === null) &&
    (isStr(t.step_id) || t.step_id === null) &&
    isStr(t.label) &&
    typeof t.duration_sec === 'number' &&
    isStr(t.started_at) &&
    isStr(t.ends_at) &&
    typeof t.synced === 'boolean'
  );
}

/** What this device saved, if it is still whole and recent; anything else is dropped. */
export function readCook(recipeId: string, now = Date.now()): CookState | null {
  let raw: unknown;
  try {
    raw = JSON.parse(localStorage.getItem(cookKey(recipeId)) ?? 'null');
  } catch {
    clearCook(recipeId);
    return null;
  }
  if (raw === null) return null;
  const s = raw as Partial<CookState>;
  const recipe = s.recipe as Partial<Recipe> | undefined;
  const ok =
    isObj(raw) &&
    s.v === 1 &&
    s.recipe_id === recipeId &&
    Number.isInteger(s.recipe_version) &&
    Number.isInteger(s.step_index) &&
    s.step_index! >= 0 &&
    Array.isArray(s.checked_ingredients) &&
    s.checked_ingredients.every(isStr) &&
    Array.isArray(s.timers) &&
    s.timers.every(validTimer) &&
    typeof s.started === 'boolean' &&
    (isStr(s.session_id) || s.session_id === null) &&
    validScale(s.scale) &&
    isObj(recipe) &&
    recipe.id === recipeId &&
    Array.isArray(recipe.steps) &&
    Array.isArray(recipe.ingredients) &&
    isStr(s.updated_at) &&
    now - Date.parse(s.updated_at) < COOK_TTL_MS;
  if (!ok) {
    clearCook(recipeId);
    return null;
  }
  return { ...(s as CookState), step_index: Math.min(s.step_index!, recipe.steps!.length - 1) };
}

export function writeCook(state: CookState): CookState {
  const next = { ...state, updated_at: new Date().toISOString() };
  try {
    localStorage.setItem(cookKey(state.recipe_id), JSON.stringify(next));
  } catch {
    /* storage full or unavailable: cooking goes on, it is just not remembered */
  }
  return next;
}

export function clearCook(recipeId: string): void {
  try {
    localStorage.removeItem(cookKey(recipeId));
  } catch {
    /* unavailable */
  }
}
