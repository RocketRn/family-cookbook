import type { Lang, QtyKind, RoundClass } from '../types.js';

/** Why a parsed ingredient line got a lower confidence (PRD 5.1.3). */
export type ParseReason =
  /** "яйца — 4 шт.": the amount comes after the name (pattern P4), -0.1 */
  | 'p4'
  /** an amount without a unit, -0.2 */
  | 'no_unit'
  /** a parenthetical with a number moved to the note, -0.2 */
  | 'bracket'
  /** not recognised: kept as written, never recalculated (P5 outside the spice list), -0.5 */
  | 'unparsed';

export type ParsedIngredient = {
  /** The line as it was in the text (list marker removed). */
  raw: string;
  /** Section heading the line belongs to ("Для теста"), null before the first one. */
  groupLabel: string | null;
  name: string;
  qtyKind: QtyKind;
  amountMin: number | null;
  amountMax: number | null;
  unitCode: string | null;
  /** The unit as written when it is not a known unit. */
  unitRaw: string | null;
  roundClass: RoundClass;
  minPiece: number | null;
  note: string | null;
  /** 0..1 in steps of 0.1; below 0.7 the line is highlighted for review. */
  confidence: number;
  reasons: ParseReason[];
};

export type ParsedTimer = {
  /** Lower bound for a range ("10–15 мин" -> 600). */
  durationSec: number;
  /** Upper bound of a range, if any. */
  maxSec: number | null;
  /** The text around the duration ("Выпекайте 40 минут"). */
  label: string;
};

export type ParsedStep = {
  text: string;
  timers: ParsedTimer[];
  /** Indexes into `ingredients` mentioned in this step (link suggestions, PRD 5.1.4). */
  links: number[];
  /** Index into `videos` when a YouTube link was in this step. */
  video: number | null;
};

export type ParseWarning =
  /** no section headings: lines were classified by the PRD 5.1.2 score */
  | 'no_headings'
  /** nothing looked like an ingredient list */
  | 'no_ingredients'
  /** nothing looked like steps: the whole text became one step */
  | 'no_steps'
  /** more than 100 ingredient lines or 60 steps: the rest is only in the original text */
  | 'truncated';

export type ParsedRecipe = {
  title: string | null;
  /** Detected from the text; the caller's language when the text gives no hint. */
  language: Lang;
  servings: number | null;
  prepMin: number | null;
  cookMin: number | null;
  ingredients: ParsedIngredient[];
  steps: ParsedStep[];
  /** Notes section, plus any text before the first section that is neither title nor metadata. */
  notes: string | null;
  videos: Array<{ youtubeId: string; startSec: number | null }>;
  warnings: ParseWarning[];
  /** Lines read as section headings or metadata ("На 6 порций"): used, not content. */
  consumedLines: string[];
};

export type ParseOptions = {
  /** The user's interface language, used when the text gives no language hint. */
  fallbackLang: Lang;
};
