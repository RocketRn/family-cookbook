import type { Difficulty, RecipeListItem, RecipePage, Recipe, RecipeTag } from './types';

export type { Difficulty } from './types';
/** "book": published recipes of my book; "mine": everything I wrote, drafts included. */
export type RecipeScope = 'book' | 'mine';

/** Page size of recipe lists (owner decision 6: client-side search over loaded pages until BE-11). */
export const PAGE_SIZE = 50;

export interface RecipeApi {
  listPage(scope: RecipeScope, cursor: string | null): Promise<RecipePage>;
  /** null when the recipe does not exist or the user may not see it. */
  get(id: string): Promise<Recipe | null>;
}

/** What a list row and the client-side filter need, derived from an API list item. */
export type RecipeSummary = {
  id: string;
  title: string;
  emoji: string;
  authorName: string;
  isMine: boolean;
  isDraft: boolean;
  difficulty: Difficulty | null;
  totalMin: number | null;
  servings: number;
  tags: RecipeTag[];
  ingredientNames: string[];
  thumbUrl: string | null;
};

export type RecipeFilters = {
  scope: RecipeScope;
  q: string;
  difficulty: Difficulty | null;
  maxMin: number | null;
  /** System tag slugs; a recipe must have all of them. */
  tags: string[];
};

export const EMPTY_FILTERS: RecipeFilters = {
  scope: 'book',
  q: '',
  difficulty: null,
  maxMin: null,
  tags: [],
};

/** A picture for recipes without a photo, from the first system tag that has one. */
const TAG_EMOJI: Record<string, string> = {
  soup: '🍲',
  salad: '🥗',
  breakfast: '🍳',
  baking: '🥧',
  dessert: '🍰',
  main: '🍽️',
  vegan: '🥦',
  lean: '🥦',
  gluten_free: '🌾',
};
export const emojiFor = (tags: RecipeTag[]): string =>
  tags.map((t) => TAG_EMOJI[t.slug]).find(Boolean) ?? '🍽️';

export function toSummary(r: RecipeListItem): RecipeSummary {
  return {
    id: r.id,
    title: r.title,
    emoji: emojiFor(r.tags),
    authorName: r.author.name ?? '',
    isMine: r.is_mine,
    isDraft: r.status === 'draft',
    difficulty: r.difficulty,
    totalMin: r.total_min,
    servings: r.servings,
    tags: r.tags,
    ingredientNames: r.ingredient_names,
    thumbUrl: r.cover?.thumb_url ?? null,
  };
}

const norm = (s: string) => s.toLocaleLowerCase().normalize('NFC').trim();

/**
 * Client-side search and filters over the loaded recipes (owner decision 6). Search covers the
 * title and ingredient names (PRD 6.2 BE-11); the scope is applied by the API.
 */
export function filterRecipes(all: RecipeSummary[], f: RecipeFilters): RecipeSummary[] {
  const q = norm(f.q);
  return all.filter((r) => {
    if (f.difficulty && r.difficulty !== f.difficulty) return false;
    if (f.maxMin !== null && (r.totalMin === null || r.totalMin > f.maxMin)) return false;
    if (f.tags.length > 0 && !f.tags.every((t) => r.tags.some((x) => x.slug === t))) return false;
    if (q && !norm(r.title).includes(q) && !r.ingredientNames.some((n) => norm(n).includes(q)))
      return false;
    return true;
  });
}
