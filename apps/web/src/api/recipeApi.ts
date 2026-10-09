import { ApiError } from './client';
import { api } from './endpoints';
import { PAGE_SIZE, SEARCH_MAX_CHARS, type RecipeApi } from './recipes';
import type { Recipe, RecipePage } from './types';

/** The recipe API (BE-04). Screens use it only through this object, so tests can replace it. */
export const recipeApi: RecipeApi = {
  listPage(f, cursor) {
    const q = new URLSearchParams({ scope: f.scope, limit: String(PAGE_SIZE) });
    const text = f.q.trim();
    if (text) q.set('q', text.slice(0, SEARCH_MAX_CHARS));
    for (const tag of f.tags) q.append('tag', tag);
    if (f.difficulty) q.set('difficulty', f.difficulty);
    if (f.maxMin !== null) q.set('max_min', String(f.maxMin));
    if (cursor) q.set('cursor', cursor);
    return api().request<RecipePage>('GET', `/recipes?${q.toString()}`);
  },
  async get(id) {
    try {
      return await api().request<Recipe>('GET', `/recipes/${encodeURIComponent(id)}`);
    } catch (err) {
      // Not found, not allowed to see it, or not a recipe id at all: all mean "no such recipe".
      if (err instanceof ApiError && (err.code === 'NOT_FOUND' || err.code === 'VALIDATION_ERROR'))
        return null;
      throw err;
    }
  },
};
