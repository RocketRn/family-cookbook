import type { ImportWarning } from '../api/types';
import type { EdRecipe } from './model';

/**
 * PRD 4.8 `import-draft`: what an import has not saved yet, on this device. Before "Parse" it is
 * the pasted text; after it, the review in progress (D-043): the recipe it made, the original
 * text, the parser's notes, and the author's edits and decisions so far. Cleared when the recipe
 * is saved.
 */
export const IMPORT_DRAFT_KEY = 'import-draft';

export type ReviewDraft = {
  recipe_id: string;
  recipe_version: number;
  title: string;
  original: string;
  warnings: ImportWarning[];
  /** Why the parser was unsure, by ingredient id. */
  reasons: Record<string, string[]>;
  /** The editor as the author left it; null until they changed something. */
  editor: EdRecipe | null;
};
export type ImportDraft = { v: 1; text?: string; review?: ReviewDraft };

export function readImportDraft(): ImportDraft {
  try {
    const raw = JSON.parse(
      localStorage.getItem(IMPORT_DRAFT_KEY) ?? 'null',
    ) as Partial<ImportDraft>;
    if (!raw || raw.v !== 1) return { v: 1 };
    const r = raw.review;
    const review =
      r &&
      typeof r.recipe_id === 'string' &&
      typeof r.recipe_version === 'number' &&
      typeof r.original === 'string' &&
      Array.isArray(r.warnings) &&
      typeof r.reasons === 'object' &&
      r.reasons !== null
        ? { ...r, title: typeof r.title === 'string' ? r.title : '', editor: r.editor ?? null }
        : undefined;
    return {
      v: 1,
      ...(typeof raw.text === 'string' && raw.text ? { text: raw.text } : {}),
      ...(review ? { review } : {}),
    };
  } catch {
    return { v: 1 };
  }
}

function write(d: ImportDraft): void {
  try {
    if (d.text || d.review) localStorage.setItem(IMPORT_DRAFT_KEY, JSON.stringify(d));
    else localStorage.removeItem(IMPORT_DRAFT_KEY);
  } catch {
    /* private mode or storage full: simply not kept */
  }
}

export function writeImportText(text: string): void {
  const d = readImportDraft();
  write({ v: 1, ...(text ? { text } : {}), ...(d.review ? { review: d.review } : {}) });
}

/** After "Parse": the text has become a recipe; the review takes its place. */
export function startReview(review: ReviewDraft): void {
  write({ v: 1, review });
}

export function saveReviewEdits(recipeId: string, editor: EdRecipe): void {
  const d = readImportDraft();
  if (d.review?.recipe_id !== recipeId) return;
  write({ ...d, review: { ...d.review, title: editor.title, editor } });
}

/** The review of this recipe, if one is in progress on this device. */
export function reviewFor(recipeId: string, version: number): ReviewDraft | null {
  const r = readImportDraft().review;
  return r && r.recipe_id === recipeId && r.recipe_version === version ? r : null;
}

export function endReview(recipeId: string): void {
  const d = readImportDraft();
  if (d.review?.recipe_id !== recipeId) return;
  write({ v: 1, ...(d.text ? { text: d.text } : {}) });
}
