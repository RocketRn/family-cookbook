/**
 * Recipe data access. The real recipe API arrives in Sprint 2 (BE-04); until then screens use the
 * typed mock behind this interface. To switch, implement RecipeApi over createApiClient and change
 * the export in ./recipeApi.ts. Nothing else needs to change.
 */
export type Difficulty = 'easy' | 'medium' | 'hard';
export type Visibility = 'private' | 'book' | 'link';
export type RecipeScope = 'book' | 'mine' | 'saved';

export type RecipeSummary = {
  id: string;
  title: string;
  emoji: string;
  authorName: string;
  isMine: boolean;
  difficulty: Difficulty | null;
  totalMin: number | null;
  servings: number;
  tags: string[];
  visibility: Visibility;
  ingredientNames: string[];
  saved: boolean;
};

export type RecipeFilters = {
  scope: RecipeScope;
  q: string;
  difficulty: Difficulty | null;
  maxMin: number | null;
  tags: string[];
};

export interface RecipeApi {
  list(filters: RecipeFilters): Promise<RecipeSummary[]>;
  get(id: string): Promise<RecipeSummary | null>;
  setSaved(id: string, saved: boolean): Promise<void>;
}

export const EMPTY_FILTERS: RecipeFilters = {
  scope: 'book',
  q: '',
  difficulty: null,
  maxMin: null,
  tags: [],
};

const norm = (s: string) => s.toLocaleLowerCase().normalize('NFC').trim();

/** Pure filter shared by the mock and unit tests. Search covers title and ingredient names (PRD 6.2 BE-11). */
export function filterRecipes(all: RecipeSummary[], f: RecipeFilters): RecipeSummary[] {
  const q = norm(f.q);
  return all.filter((r) => {
    if (f.scope === 'mine' && !r.isMine) return false;
    if (f.scope === 'saved' && !r.saved) return false;
    if (f.scope === 'book' && r.visibility === 'private' && !r.isMine) return false;
    if (f.difficulty && r.difficulty !== f.difficulty) return false;
    if (f.maxMin !== null && (r.totalMin === null || r.totalMin > f.maxMin)) return false;
    if (f.tags.length > 0 && !f.tags.every((t) => r.tags.includes(t))) return false;
    if (q && !norm(r.title).includes(q) && !r.ingredientNames.some((n) => norm(n).includes(q)))
      return false;
    return true;
  });
}
