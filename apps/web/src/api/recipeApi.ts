import { ApiError } from './client';
import { api } from './endpoints';
import { PAGE_SIZE, type RecipeApi } from './recipes';
import type { Recipe, RecipePage } from './types';

/** The recipe API (BE-04). Screens use it only through this object, so tests can replace it. */
export const recipeApi: RecipeApi = {
  listPage(scope, cursor) {
    const q = new URLSearchParams({ scope, limit: String(PAGE_SIZE) });
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
