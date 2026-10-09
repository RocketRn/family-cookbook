import type { Membership } from '../books/repo.js';
import type { ListItem, RecipeChildren, RecipeRow } from './repo.js';

/** API shape of one recipe (snake_case like the rest of the API). */
export function recipeView(
  row: RecipeRow,
  c: RecipeChildren,
  viewer: { id: string; membership: Membership | null },
) {
  const isAuthor = row.author_id === viewer.id;
  const keeperOfBook =
    viewer.membership?.role === 'owner' &&
    row.book_id !== null &&
    viewer.membership.book_id === row.book_id;
  const linksByStep = new Map<string, Array<{ ingredient_id: string; portion_fraction: number }>>();
  for (const l of c.links) {
    const list = linksByStep.get(l.step_id) ?? [];
    list.push({ ingredient_id: l.ingredient_id, portion_fraction: l.portion_fraction });
    linksByStep.set(l.step_id, list);
  }
  return {
    id: row.id,
    title: row.title,
    author: { id: row.author_id, name: row.author_name },
    is_mine: isAuthor,
    book_id: row.book_id,
    status: row.status,
    visibility: row.visibility,
    // The share link is the author's to hand out (D-023).
    ...(isAuthor ? { share_token: row.share_token } : {}),
    servings: row.servings,
    difficulty: row.difficulty,
    prep_min: row.prep_min,
    cook_min: row.cook_min,
    language: row.language,
    author_notes: row.author_notes,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
    published_at: row.published_at,
    can_edit: isAuthor,
    can_unpublish:
      row.visibility !== 'private' && (isAuthor || (keeperOfBook && row.status === 'published')),
    tags: c.tags,
    ingredients: c.ingredients,
    videos: c.videos,
    steps: c.steps.map((s) => ({
      ...s,
      ingredients: linksByStep.get(s.id) ?? [],
      timers: c.timers.filter((t) => t.step_id === s.id).map(({ step_id: _s, ...t }) => t),
    })),
  };
}

export function listItemView(r: ListItem, viewerId: string) {
  return {
    id: r.id,
    title: r.title,
    author: { id: r.author_id, name: r.author_name },
    is_mine: r.author_id === viewerId,
    difficulty: r.difficulty,
    prep_min: r.prep_min,
    cook_min: r.cook_min,
    total_min:
      r.prep_min === null && r.cook_min === null ? null : (r.prep_min ?? 0) + (r.cook_min ?? 0),
    servings: r.servings,
    visibility: r.visibility,
    status: r.status,
    language: r.language,
    tags: r.tags,
    ingredient_names: r.ingredient_names,
    published_at: r.published_at,
    updated_at: r.updated_at,
  };
}
