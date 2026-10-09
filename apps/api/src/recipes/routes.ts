import type { FastifyInstance } from 'fastify';
import { currentUser } from '../auth/plugin.js';
import { membershipOf } from '../books/repo.js';
import type { Db } from '../db/pool.js';
import { withUser, type Tx } from '../db/tx.js';
import { AppError, forbidden, notFound } from '../errors.js';
import { noExistingIds, planContent, publishProblems } from './content.js';
import {
  countContent,
  existingIds,
  findRecipe,
  findRecipeByShareToken,
  insertRecipe,
  listRecipes,
  loadChildren,
  newShareToken,
  setTags,
  writeContent,
  type RecipeRow,
} from './repo.js';
import {
  createRecipeBody,
  listQuery,
  patchRecipeBody,
  recipeParams,
  shareParams,
  type PatchRecipeBody,
} from './schema.js';
import { listItemView, recipeView } from './view.js';

const recipeNotFound = () => notFound('Recipe not found');
const notInBook = () =>
  new AppError(409, 'NOT_IN_BOOK', 'Join or create a book to share a recipe with it');

async function assertPublishable(
  tx: Tx,
  id: string,
  title: string,
  servings: number,
): Promise<void> {
  const n = await countContent(tx, id);
  const missing = publishProblems({
    title,
    servings,
    ingredientCount: n.ingredients,
    stepCount: n.steps,
  });
  if (missing.length) {
    throw new AppError(
      409,
      'NOT_PUBLISHABLE',
      'A recipe needs a title, servings, an ingredient and a step',
      { missing },
    );
  }
}

async function view(tx: Tx, row: RecipeRow, userId: string) {
  return recipeView(row, await loadChildren(tx, row.id), {
    id: userId,
    membership: await membershipOf(tx, userId),
  });
}

/** Cursor = base64url(JSON [sort timestamp, id]); opaque to clients. */
const encodeCursor = (at: Date, id: string) =>
  Buffer.from(JSON.stringify([at.toISOString(), id])).toString('base64url');
function decodeCursor(c: string | undefined): { at: string; id: string } | null {
  if (!c) return null;
  try {
    const [at, id] = JSON.parse(Buffer.from(c, 'base64url').toString('utf8')) as [unknown, unknown];
    if (
      typeof at === 'string' &&
      !Number.isNaN(Date.parse(at)) &&
      typeof id === 'string' &&
      /^[0-9a-f-]{36}$/.test(id)
    ) {
      return { at, id };
    }
  } catch {
    /* fall through */
  }
  throw new AppError(400, 'VALIDATION_ERROR', 'Invalid cursor');
}

/** Content fields whose change bumps the version of a published recipe (PRD 3.2 recipes.version). */
const CONTENT_FIELDS = [
  'title',
  'servings',
  'difficulty',
  'prep_min',
  'cook_min',
  'language',
  'author_notes',
] as const;

function contentChanged(row: RecipeRow, b: PatchRecipeBody): boolean {
  if (b.ingredients !== undefined || b.tags !== undefined) return true;
  return CONTENT_FIELDS.some((f) => b[f] !== undefined && b[f] !== row[f]);
}

export function registerRecipes(app: FastifyInstance, db: Db): void {
  app.post('/recipes', async (req, reply) => {
    const user = currentUser(req);
    const body = createRecipeBody.parse(req.body);
    const plan = planContent(body, noExistingIds());
    const created = await withUser(db, { userId: user.id }, async (tx) => {
      const membership = await membershipOf(tx, user.id);
      if (body.visibility === 'book' && !membership) throw notInBook();
      const id = await insertRecipe(tx, {
        authorId: user.id,
        bookId: membership?.book_id ?? null,
        title: body.title,
        status: body.status,
        visibility: body.visibility,
        servings: body.servings,
        difficulty: body.difficulty,
        prepMin: body.prep_min,
        cookMin: body.cook_min,
        language: body.language,
        authorNotes: body.author_notes,
      });
      await writeContent(tx, id, plan);
      await setTags(tx, id, body.tags);
      if (body.status === 'published') await assertPublishable(tx, id, body.title, body.servings);
      return view(tx, (await findRecipe(tx, id))!, user.id);
    });
    return reply.status(201).send(created);
  });

  app.get('/recipes', async (req) => {
    const user = currentUser(req);
    const q = listQuery.parse(req.query);
    const after = decodeCursor(q.cursor);
    return withUser(db, { userId: user.id }, async (tx) => {
      const membership = await membershipOf(tx, user.id);
      if (q.scope === 'book' && !membership) return { items: [], next_cursor: null };
      const rows = await listRecipes(tx, {
        scope: q.scope,
        userId: user.id,
        bookId: membership?.book_id ?? null,
        limit: q.limit + 1,
        after,
      });
      const page = rows.slice(0, q.limit);
      const last = page[page.length - 1];
      return {
        items: page.map((r) => listItemView(r, user.id)),
        next_cursor: rows.length > q.limit && last ? encodeCursor(last.sort_at, last.id) : null,
      };
    });
  });

  app.get('/recipes/:id', async (req) => {
    const user = currentUser(req);
    const { id } = recipeParams.parse(req.params);
    return withUser(db, { userId: user.id }, async (tx) => {
      const row = await findRecipe(tx, id);
      if (!row) throw recipeNotFound();
      return view(tx, row, user.id);
    });
  });

  // PRD 4.9 GET /r/:share_token: anyone holding the token, only while published with visibility link.
  app.get('/r/:token', async (req) => {
    const user = currentUser(req);
    const { token } = shareParams.parse(req.params);
    return withUser(db, { userId: user.id, shareToken: token }, async (tx) => {
      const row = await findRecipeByShareToken(tx, token);
      if (!row) throw recipeNotFound();
      return view(tx, row, user.id);
    });
  });

  app.patch('/recipes/:id', async (req) => {
    const user = currentUser(req);
    const { id } = recipeParams.parse(req.params);
    const body = patchRecipeBody.parse(req.body);
    return withUser(db, { userId: user.id }, async (tx) => {
      const row = await findRecipe(tx, id);
      if (!row) throw recipeNotFound();
      // Only the author edits; the keeper may only unpublish (PRD 3.3).
      if (row.author_id !== user.id) throw forbidden('Only the author can edit this recipe');
      const plan = body.ingredients
        ? planContent(
            { ingredients: body.ingredients, steps: body.steps!, videos: body.videos ?? [] },
            await existingIds(tx, id),
          )
        : null;
      const membership = await membershipOf(tx, user.id);
      const visibility = body.visibility ?? row.visibility;
      const status = body.status ?? row.status;
      if (visibility === 'book' && !membership) throw notInBook();
      const bump = row.status === 'published' && contentChanged(row, body);
      await tx.query(
        `UPDATE recipes SET
           title = $2, servings = $3, difficulty = $4, prep_min = $5, cook_min = $6, language = $7, author_notes = $8,
           status = $9::recipe_status, visibility = $10, share_token = $11, book_id = $12,
           version = version + $13,
           published_at = CASE WHEN $9::recipe_status = 'published' THEN coalesce(published_at, now()) ELSE published_at END,
           updated_at = now()
         WHERE id = $1`,
        [
          id,
          body.title ?? row.title,
          body.servings ?? row.servings,
          body.difficulty !== undefined ? body.difficulty : row.difficulty,
          body.prep_min !== undefined ? body.prep_min : row.prep_min,
          body.cook_min !== undefined ? body.cook_min : row.cook_min,
          body.language !== undefined ? body.language : row.language,
          body.author_notes !== undefined ? body.author_notes : row.author_notes,
          status,
          visibility,
          // A share token lives exactly while the recipe is shared by link; re-sharing gives a new one.
          visibility === 'link' ? (row.share_token ?? newShareToken()) : null,
          membership?.book_id ?? null,
          bump ? 1 : 0,
        ],
      );
      if (plan) await writeContent(tx, id, plan);
      if (body.tags) await setTags(tx, id, body.tags);
      if (status === 'published')
        await assertPublishable(tx, id, body.title ?? row.title, body.servings ?? row.servings);
      return view(tx, (await findRecipe(tx, id))!, user.id);
    });
  });

  app.post('/recipes/:id/unpublish', async (req, reply) => {
    const user = currentUser(req);
    const { id } = recipeParams.parse(req.params);
    await withUser(db, { userId: user.id }, async (tx) => {
      if (!(await findRecipe(tx, id))) throw recipeNotFound();
      const done = await tx.query<{ ok: boolean }>('SELECT unpublish_recipe($1) AS ok', [id]);
      if (!done.rows[0]!.ok)
        throw forbidden('Only the author or the keeper of the book can unpublish this recipe');
    });
    return reply.status(204).send();
  });

  app.delete('/recipes/:id', async (req, reply) => {
    const user = currentUser(req);
    const { id } = recipeParams.parse(req.params);
    await withUser(db, { userId: user.id }, async (tx) => {
      const row = await findRecipe(tx, id);
      if (!row) throw recipeNotFound();
      if (row.author_id !== user.id) throw forbidden('Only the author can delete this recipe');
      // Soft delete (PRD 4.9, 7.3 #4) through a function: afterwards the row is visible to nobody.
      await tx.query('SELECT soft_delete_recipe($1)', [id]);
    });
    return reply.status(204).send();
  });
}
