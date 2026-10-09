import type { Lang } from '../types.js';
import type { ParsedIngredient, ParsedRecipe, ParsedTimer, ParseOptions } from './types.js';

export * from './types.js';

/** BE-06 recipe text parser (PRD 5.1). Not implemented yet: the tests are written first. */
export function parseRecipeText(_text: string, _opts: ParseOptions): ParsedRecipe {
  throw new Error('parseRecipeText: not implemented');
}

export function parseIngredientLine(
  _line: string,
  _lang: Lang,
): Omit<ParsedIngredient, 'groupLabel'> {
  throw new Error('parseIngredientLine: not implemented');
}

export function findDurations(_text: string): ParsedTimer[] {
  throw new Error('findDurations: not implemented');
}

export function detectLanguage(_text: string, fallback: Lang): Lang {
  return fallback;
}
