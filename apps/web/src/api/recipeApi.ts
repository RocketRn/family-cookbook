import { createMockRecipeApi } from './mockRecipes';
import type { RecipeApi } from './recipes';

/** The single switch point: replace with the real client when the recipe API ships (Sprint 2). */
export const recipeApi: RecipeApi = createMockRecipeApi();
