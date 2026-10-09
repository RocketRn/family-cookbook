/** Shared types of the recalculation engine (docs/DECISIONS.md D-020). */
export type Lang = 'ru' | 'uk' | 'en' | 'sv';
export const LANGS: readonly Lang[] = ['ru', 'uk', 'en', 'sv'];

export type QtyKind = 'exact' | 'range' | 'to_taste' | 'pinch' | 'unparsed';
/** Rounding class stored on an ingredient (PRD 3.2 recipe_ingredients.round_class). */
export type RoundClass = 'continuous' | 'whole_item' | 'spice_item';
/** The rule that produced a quantity. `none` = shown as written (k = 1). */
export type Rounding = 'continuous' | 'spoon_cup' | 'whole_item' | 'spice_item' | 'none';

/** Reduced fraction, e.g. 1/4, 2/3. */
export type Fraction = { num: number; den: number };

export type Hint =
  /** "whisk `pieces`, take `fraction`" */
  | { kind: 'take_fraction_of'; pieces: number; fraction: Fraction }
  /** "`whole` and `fraction` of one more" */
  | { kind: 'whole_plus_fraction'; whole: number; fraction: Fraction };

/** A number to show. Structured only: turning it into text is the formatter's job. */
export type Quantity = {
  /** The value to show, after rounding (equals whole + fraction when fraction is set). */
  value: number;
  /** Integer part of `value`. */
  whole: number;
  /** Fractional part when it is a measurable fraction (½, ¼, ⅛ ...); null for decimals or none. */
  fraction: Fraction | null;
  /** Exact scaled value before rounding. */
  rawFloat: number;
  /** Canonical unit code, or null (no unit or a unit we do not know). */
  unit: string | null;
  rounding: Rounding;
  /** Only for whole items (PRD 5.3). */
  hint?: Hint;
  scalable: true;
};

/** The amount part of an ingredient line, as stored (PRD 3.2). */
export type IngredientAmount = {
  qtyKind: QtyKind;
  amountMin: number | null;
  amountMax: number | null;
  unitCode: string | null;
  /** The unit as the author wrote it; shown for unknown units. */
  unitRaw?: string | null;
  roundClass: RoundClass;
  /** Divisibility step of a whole item (1 for an egg, 0.5 for an onion). */
  minPiece?: number | null;
  rawLine?: string;
};

export type ScaledAmount =
  | { scalable: false; qtyKind: QtyKind; rawLine: string }
  /** `max` is null for an exact amount or when both range bounds round to the same number. */
  | { scalable: true; min: Quantity; max: Quantity | null; unitRaw: string | null };

export type RoundSpec = {
  unitCode: string | null;
  roundClass: RoundClass;
  minPiece?: number | null;
};
