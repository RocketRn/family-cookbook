// Pure TypeScript library: parsing and recalculation. No I/O, no Node-only APIs (runs in browser and Node).
export * from './types.js';
export { gcd } from './fraction.js';
export { UNITS, unitByCode, resolveUnit, normalizeUnitText } from './units.js';
export type { UnitDef, Dimension, UnitFamily, Label } from './units.js';
export { roundAmount } from './round.js';
export {
  assessFactor,
  convert,
  factorFromIngredient,
  factorFromServings,
  isScalable,
  K_LIMITS,
  RecalcError,
  scaleAmount,
  scaleRecipe,
} from './recalc.js';
export type { RecalcErrorCode } from './recalc.js';
export { formatAmount, fractionGlyph, unitLabel } from './format.js';
export type { FormatOptions } from './format.js';
export { parseAmount, parseNumber } from './numbers.js';
export { classifyProduct, isEgg } from './products.js';
export { parseYoutube } from './youtube.js';

export const RECIPE_CORE_VERSION = '0.2.0';
export {
  detectLanguage,
  findDurations,
  parseIngredientLine,
  parseRecipeText,
} from './parse/index.js';
export type {
  ParsedIngredient,
  ParsedRecipe,
  ParsedStep,
  ParsedTimer,
  ParseOptions,
  ParseReason,
  ParseWarning,
} from './parse/index.js';
