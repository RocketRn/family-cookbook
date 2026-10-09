import { classifyProduct, unitByCode } from '@cookbook/recipe-core';
import { AppError } from '../errors.js';
import type { IngredientInput, StepInput, VideoInput } from './schema.js';

/** Validated, normalised recipe content, ready to write. Ingredient and video refs are still refs. */
export type IngredientPlan = {
  ref: string;
  id: string | null;
  group_label: string | null;
  name: string;
  name_norm: string;
  qty_kind: IngredientInput['qty_kind'];
  amount_min: number | null;
  amount_max: number | null;
  unit_code: string | null;
  unit_raw: string | null;
  round_class: NonNullable<IngredientInput['round_class']>;
  min_piece: number | null;
  optional: boolean;
  note: string | null;
  raw_line: string | null;
  parse_confidence: number | null;
};
export type VideoPlan = {
  ref: string;
  id: string | null;
  youtube_id: string;
  title: string | null;
};
export type StepPlan = {
  id: string | null;
  title: string | null;
  body: string;
  video_ref: string | null;
  video_start_sec: number | null;
  links: Array<{ ref: string; portion_fraction: number }>;
  timers: Array<{ label: string; duration_sec: number }>;
};
export type ContentPlan = { ingredients: IngredientPlan[]; videos: VideoPlan[]; steps: StepPlan[] };

/** Existing child ids of the recipe being edited (empty when creating). */
export type ExistingIds = { ingredients: Set<string>; steps: Set<string>; videos: Set<string> };
export const noExistingIds = (): ExistingIds => ({
  ingredients: new Set(),
  steps: new Set(),
  videos: new Set(),
});

export const PLACEHOLDER = /\{ing:([A-Za-z0-9_-]{1,64})\}/g;

type Problem = { path: string; message: string };

class Problems {
  readonly list: Problem[] = [];
  add(path: string, message: string) {
    this.list.push({ path, message });
  }
  throwIfAny() {
    if (this.list.length)
      throw new AppError(400, 'VALIDATION_ERROR', 'Recipe content is not valid', this.list);
  }
}

const EPS = 1e-9;

function planIngredient(
  i: IngredientInput,
  at: string,
  existing: ExistingIds,
  p: Problems,
): IngredientPlan {
  if (i.id && !existing.ingredients.has(i.id))
    p.add(`${at}.id`, 'unknown ingredient id for this recipe');
  let { amount_min: min = null, amount_max: max = null } = i;
  let kind = i.qty_kind;
  let unit = i.unit_code ?? null;
  if (unit !== null && !unitByCode(unit)) p.add(`${at}.unit_code`, `unknown unit "${unit}"`);

  if (kind === 'exact') {
    if (min === null) p.add(`${at}.amount_min`, 'an exact amount needs amount_min');
    if (max !== null && min !== null && Math.abs(max - min) > EPS)
      p.add(`${at}.amount_max`, 'must equal amount_min for an exact amount');
    max = min;
  } else if (kind === 'range') {
    if (min === null || max === null) p.add(`${at}`, 'a range needs amount_min and amount_max');
    else if (max < min - EPS) p.add(`${at}.amount_max`, 'must be greater than amount_min');
    else if (Math.abs(max - min) <= EPS) kind = 'exact'; // "2-2" is just 2
  } else {
    if (min !== null || max !== null) p.add(`${at}`, `${kind} has no amount`);
    min = null;
    max = null;
    if (kind !== 'unparsed' && unit !== null) p.add(`${at}.unit_code`, `${kind} has no unit`);
    if (kind !== 'unparsed') unit = null;
  }

  const guess = classifyProduct(i.name);
  const roundClass = i.round_class ?? guess.roundClass;
  const minPiece =
    roundClass === 'whole_item' ? (i.min_piece ?? guess.minPiece ?? 1) : (i.min_piece ?? null);
  return {
    ref: i.ref,
    id: i.id ?? null,
    group_label: i.group_label || null,
    name: i.name,
    name_norm: i.name.normalize('NFC').toLocaleLowerCase().trim(),
    qty_kind: kind,
    amount_min: min,
    amount_max: max,
    unit_code: unit,
    unit_raw: i.unit_raw || null,
    round_class: roundClass,
    min_piece: minPiece,
    optional: i.optional ?? false,
    note: i.note || null,
    raw_line: i.raw_line || null,
    parse_confidence: i.parse_confidence ?? null,
  };
}

function unique<T extends { ref: string; id?: string | undefined }>(
  items: T[],
  at: string,
  p: Problems,
) {
  const refs = new Set<string>();
  const ids = new Set<string>();
  items.forEach((it, n) => {
    if (refs.has(it.ref)) p.add(`${at}[${n}].ref`, 'duplicate ref');
    refs.add(it.ref);
    if (it.id) {
      if (ids.has(it.id)) p.add(`${at}[${n}].id`, 'duplicate id');
      ids.add(it.id);
    }
  });
  return refs;
}

/**
 * Validates recipe content as a whole: references between steps, ingredients and videos,
 * quantities (PRD 3.2 CHECKs), units (from recipe-core), portions per ingredient (sum <= 1) and
 * {ing:<ref>} placeholders in step text. Throws VALIDATION_ERROR listing every problem.
 */
export function planContent(
  input: { ingredients: IngredientInput[]; steps: StepInput[]; videos: VideoInput[] },
  existing: ExistingIds,
): ContentPlan {
  const p = new Problems();
  const ingredientRefs = unique(input.ingredients, 'ingredients', p);
  const videoRefs = unique(input.videos, 'videos', p);
  const ingredients = input.ingredients.map((i, n) =>
    planIngredient(i, `ingredients[${n}]`, existing, p),
  );
  const videos = input.videos.map((v, n) => {
    if (v.id && !existing.videos.has(v.id))
      p.add(`videos[${n}].id`, 'unknown video id for this recipe');
    return { ref: v.ref, id: v.id ?? null, youtube_id: v.youtube_id, title: v.title || null };
  });

  const stepIds = new Set<string>();
  const portions = new Map<string, number>();
  const steps = input.steps.map((s, n): StepPlan => {
    const at = `steps[${n}]`;
    if (s.id) {
      if (!existing.steps.has(s.id)) p.add(`${at}.id`, 'unknown step id for this recipe');
      if (stepIds.has(s.id)) p.add(`${at}.id`, 'duplicate id');
      stepIds.add(s.id);
    }
    if (s.video_ref && !videoRefs.has(s.video_ref))
      p.add(`${at}.video_ref`, 'no such video in this recipe');
    if (s.video_start_sec != null && !s.video_ref)
      p.add(`${at}.video_start_sec`, 'needs video_ref');
    const seen = new Set<string>();
    for (const [k, link] of s.ingredients.entries()) {
      if (!ingredientRefs.has(link.ref))
        p.add(`${at}.ingredients[${k}].ref`, 'no such ingredient in this recipe');
      if (seen.has(link.ref)) p.add(`${at}.ingredients[${k}].ref`, 'linked twice in one step');
      seen.add(link.ref);
      portions.set(link.ref, (portions.get(link.ref) ?? 0) + link.portion_fraction);
    }
    for (const m of s.body.matchAll(PLACEHOLDER)) {
      if (!ingredientRefs.has(m[1]!))
        p.add(`${at}.body`, `{ing:${m[1]}} refers to no ingredient in this recipe`);
    }
    return {
      id: s.id ?? null,
      title: s.title || null,
      body: s.body,
      video_ref: s.video_ref ?? null,
      video_start_sec: s.video_start_sec ?? null,
      links: s.ingredients.map((l) => ({ ref: l.ref, portion_fraction: l.portion_fraction })),
      timers: s.timers,
    };
  });
  for (const [ref, sum] of portions) {
    if (sum > 1 + 1e-6)
      p.add('steps', `ingredient "${ref}" is split into portions that add up to more than 1`);
  }
  p.throwIfAny();
  return { ingredients, videos, steps };
}

/** PRD 2.2 step 10: what publishing needs. Returns the missing parts (empty = publishable). */
export function publishProblems(r: {
  title: string;
  servings: number;
  ingredientCount: number;
  stepCount: number;
}): string[] {
  const missing: string[] = [];
  if (!r.title.trim()) missing.push('title');
  if (!(r.servings > 0)) missing.push('servings');
  if (r.ingredientCount < 1) missing.push('ingredients');
  if (r.stepCount < 1) missing.push('steps');
  return missing;
}
