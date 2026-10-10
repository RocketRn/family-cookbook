import type {
  Difficulty,
  ImportResult,
  Photo,
  RecipeListItem,
  RecipePage,
  Recipe,
  RecipeTag,
} from './types';

export type { Difficulty } from './types';
/** "book": published recipes of my book; "mine": everything I wrote, drafts included. */
/** The book, your own recipes, or your "Saved" shelf (D-051). */
export type RecipeScope = 'book' | 'mine' | 'saved';

/** Page size of recipe lists. Search and filters run on the server (BE-11, D-034). */
export const PAGE_SIZE = 50;
/** The API accepts a search text of up to 100 characters. */
export const SEARCH_MAX_CHARS = 100;

export interface RecipeApi {
  /** One page of the list with the search text and filters applied by the API. */
  listPage(filters: RecipeFilters, cursor: string | null): Promise<RecipePage>;
  /** null when the recipe does not exist or the user may not see it. */
  get(id: string): Promise<Recipe | null>;
  /** POST /recipes and PATCH /recipes/:id with the whole recipe (D-022). */
  create(body: object): Promise<Recipe>;
  update(id: string, body: object): Promise<Recipe>;
  /** The author or the book keeper hides a recipe from the book (PRD 3.3). */
  unpublish(id: string): Promise<void>;
  /** The author deletes a recipe (soft delete, PRD 4.9). */
  remove(id: string): Promise<void>;
  /** POST /recipes/import: pasted text becomes a private draft (PRD 2.2 variant A). */
  importText(text: string, uiLang: 'ru' | 'uk' | 'en' | 'sv'): Promise<ImportResult>;
  /** POST /media: one photo, already made smaller on the device. */
  uploadPhoto(photo: Blob, filename: string): Promise<Photo>;
  /** D-051: put a recipe on your "Saved" shelf, or take it off. */
  save(id: string): Promise<void>;
  unsave(id: string): Promise<void>;
}

/** What a list row needs, derived from an API list item. */
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
