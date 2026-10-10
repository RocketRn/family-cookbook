/** Shapes of the recipe API (apps/api/src/recipes/view.ts), snake_case as on the wire. */
export type Difficulty = 'easy' | 'medium' | 'hard';
export type Visibility = 'private' | 'book' | 'link';
export type RecipeStatus = 'draft' | 'published' | 'archived';
export type QtyKind = 'exact' | 'range' | 'to_taste' | 'pinch' | 'unparsed';
export type RoundClass = 'continuous' | 'whole_item' | 'spice_item';

export type Photo = { id: string; width: number; height: number; url: string; thumb_url: string };
/** A system tag has a slug (translated in the UI); a free-form tag also has the name its author typed. */
export type RecipeTag = { slug: string; custom_name: string | null };
export type Author = { id: string; name: string | null };

export type RecipeListItem = {
  id: string;
  title: string;
  author: Author;
  is_mine: boolean;
  /** D-051: on the viewer's "Saved" shelf (older answers may leave it out). */
  is_saved?: boolean;
  difficulty: Difficulty | null;
  prep_min: number | null;
  cook_min: number | null;
  total_min: number | null;
  servings: number;
  visibility: Visibility;
  status: RecipeStatus;
  language: string | null;
  cover: Photo | null;
  tags: RecipeTag[];
  ingredient_names: string[];
  published_at: string | null;
  updated_at: string;
};

export type RecipePage = { items: RecipeListItem[]; next_cursor: string | null };

export type Ingredient = {
  id: string;
  position: number;
  group_label: string | null;
  name: string;
  qty_kind: QtyKind;
  amount_min: number | null;
  amount_max: number | null;
  unit_code: string | null;
  unit_raw: string | null;
  round_class: RoundClass;
  min_piece: number | null;
  optional: boolean;
  note: string | null;
  raw_line: string | null;
  /** The text parser's confidence for an imported line (0-1); null for lines typed by hand. */
  parse_confidence: number | null;
};

export type Video = { id: string; position: number; youtube_id: string; title: string | null };

export type Step = {
  id: string;
  position: number;
  title: string | null;
  body: string;
  photo: Photo | null;
  video_id: string | null;
  video_start_sec: number | null;
  ingredients: Array<{ ingredient_id: string; portion_fraction: number }>;
  timers: Array<{ id: string; position: number; label: string; duration_sec: number }>;
};

export type Recipe = {
  id: string;
  title: string;
  author: Author;
  is_mine: boolean;
  /** D-051: on the viewer's "Saved" shelf (older answers may leave it out). */
  is_saved?: boolean;
  book_id: string | null;
  status: RecipeStatus;
  visibility: Visibility;
  share_token?: string | null;
  servings: number;
  difficulty: Difficulty | null;
  prep_min: number | null;
  cook_min: number | null;
  language: string | null;
  author_notes: string | null;
  cover: Photo | null;
  version: number;
  can_edit: boolean;
  can_unpublish: boolean;
  tags: RecipeTag[];
  ingredients: Ingredient[];
  videos: Video[];
  steps: Step[];
};

/** POST /recipes/import (BE-06, D-033): the new private draft and what the review needs. */
export type ImportReason = 'p4' | 'no_unit' | 'bracket' | 'unparsed';
export type ImportWarning = 'no_headings' | 'no_ingredients' | 'no_steps' | 'truncated';
/** POST /recipes/:id/share (S6-3b, D-056). */
export type ShareAnswer = {
  link: string;
  prepared_message_id: string | null;
  /** Who the link opens it for. */
  for: 'book' | 'anyone';
};

/** GET /recipes/:id/import: what "Check the recipe" needs for a draft made by an import (D-054). */
export type ImportNotes = {
  original: string;
  warnings: ImportWarning[];
  reasons: Record<string, ImportReason[]>;
};
export type ImportResult = {
  recipe: Recipe;
  import: {
    lines: Array<{ ingredient_id: string; confidence: number | null; reasons: ImportReason[] }>;
    warnings: ImportWarning[];
  };
};
