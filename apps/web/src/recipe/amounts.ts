import {
  formatAmount,
  LANGS,
  scaleAmount,
  type IngredientAmount,
  type Lang,
} from '@cookbook/recipe-core';
import type { Ingredient, Photo, Recipe } from '../api/types';

/** Numbers and units follow the recipe's language (PRD 1.5 #5); unknown -> the interface language. */
export function recipeLangOf(recipe: Pick<Recipe, 'language'>, uiLang: Lang): Lang {
  return (LANGS as readonly string[]).includes(recipe.language ?? '')
    ? (recipe.language as Lang)
    : uiLang;
}

export const toAmountInput = (i: Ingredient): IngredientAmount => ({
  qtyKind: i.qty_kind,
  amountMin: i.amount_min,
  amountMax: i.amount_max,
  unitCode: i.unit_code,
  unitRaw: i.unit_raw,
  roundClass: i.round_class,
  minPiece: i.min_piece,
  rawLine: i.raw_line ?? i.name,
  name: i.name,
});

/**
 * The amount to show for an ingredient, through recipe-core (engine + formatter). `share` is the
 * part used in one step (PRD 3.2 step_ingredients.portion_fraction) and `k` the recalculation
 * factor (FE-07); both 1 = the amount exactly as written. Unparsed lines have no separate amount:
 * the line itself is shown.
 */
export function amountText(
  i: Ingredient,
  langs: { recipeLang: Lang; uiLang: Lang },
  share = 1,
  k = 1,
): string | null {
  if (i.qty_kind === 'unparsed') return null;
  return formatAmount(scaleAmount(toAmountInput(i), share * k), langs);
}

/** Ingredients grouped by section ("Для теста" ...), in order; lines before the first heading have none. */
export function groupIngredients(
  list: Ingredient[],
): Array<{ label: string | null; items: Ingredient[] }> {
  const groups: Array<{ label: string | null; items: Ingredient[] }> = [];
  for (const ing of [...list].sort((a, b) => a.position - b.position)) {
    const last = groups[groups.length - 1];
    if (last && last.label === ing.group_label) last.items.push(ing);
    else groups.push({ label: ing.group_label, items: [ing] });
  }
  return groups;
}

export type BodyPart =
  { kind: 'text'; text: string } | { kind: 'ingredient'; ingredient: Ingredient };

/**
 * Splits a step's text at `{ing:<id>}` placeholders (D-022, D-029). The result is rendered as plain
 * text nodes, never as HTML (PRD 7.1). A placeholder for an unknown id is dropped.
 */
export function stepBodyParts(body: string, byId: Map<string, Ingredient>): BodyPart[] {
  const parts: BodyPart[] = [];
  const re = /\{ing:([0-9a-f-]{36})\}/g;
  let at = 0;
  for (const m of body.matchAll(re)) {
    if (m.index > at) parts.push({ kind: 'text', text: body.slice(at, m.index) });
    const ing = byId.get(m[1]!);
    if (ing) parts.push({ kind: 'ingredient', ingredient: ing });
    at = m.index + m[0].length;
  }
  if (at < body.length) parts.push({ kind: 'text', text: body.slice(at) });
  return parts;
}

/** Seconds -> hours, minutes and seconds for a timer label. */
export function splitDuration(sec: number): { h: number; m: number; s: number } {
  return { h: Math.floor(sec / 3600), m: Math.floor((sec % 3600) / 60), s: sec % 60 };
}

/**
 * `srcset` with the true pixel widths: the full photo is stored at most 2048 px and the thumbnail
 * at most 512 px on the long side (D-026), never enlarged, so a small photo has small versions.
 */
export function photoSrcSet(p: Photo): string {
  const thumbWidth = Math.round(p.width * Math.min(1, 512 / Math.max(p.width, p.height)));
  return `${p.thumb_url} ${thumbWidth}w, ${p.url} ${p.width}w`;
}
