import { randomBytes } from 'node:crypto';
import type { Tx } from '../db/tx.js';
import { PLACEHOLDER, type ContentPlan, type ExistingIds } from './content.js';

/** 128 random bits, base64url (22 chars): fits a `startapp=r_<token>` deep link (PRD 4.7). */
export const newShareToken = (): string => randomBytes(16).toString('base64url');

export type RecipeRow = {
  id: string;
  author_id: string;
  book_id: string | null;
  title: string;
  status: 'draft' | 'published' | 'archived';
  visibility: 'private' | 'book' | 'link';
  share_token: string | null;
  servings: number;
  difficulty: 'easy' | 'medium' | 'hard' | null;
  prep_min: number | null;
  cook_min: number | null;
  language: string | null;
  author_notes: string | null;
  source_type: string;
  version: number;
  created_at: Date;
  updated_at: Date;
  published_at: Date | null;
  cover_media_id: string | null;
  author_name: string | null;
};

const RECIPE_COLUMNS = `r.id, r.author_id, r.book_id, r.title, r.status, r.visibility, r.share_token,
  r.servings, r.difficulty, r.prep_min, r.cook_min, trim(r.language) AS language, r.author_notes,
  r.source_type, r.version, r.created_at, r.updated_at, r.published_at, r.cover_media_id,
  recipe_author_name(r.id) AS author_name`;

/** Reads through RLS: returns null when the caller may not see the recipe. */
export async function findRecipe(tx: Tx, id: string): Promise<RecipeRow | null> {
  const r = await tx.query<RecipeRow>(`SELECT ${RECIPE_COLUMNS} FROM recipes r WHERE r.id = $1`, [
    id,
  ]);
  return r.rows[0] ?? null;
}

export async function findRecipeByShareToken(tx: Tx, token: string): Promise<RecipeRow | null> {
  const r = await tx.query<RecipeRow>(
    `SELECT ${RECIPE_COLUMNS} FROM recipes r WHERE r.share_token = $1`,
    [token],
  );
  return r.rows[0] ?? null;
}

export async function existingIds(tx: Tx, recipeId: string): Promise<ExistingIds> {
  const ids = async (table: string) =>
    new Set(
      (
        await tx.query<{ id: string }>(`SELECT id FROM ${table} WHERE recipe_id = $1`, [recipeId])
      ).rows.map((r) => r.id),
    );
  return {
    ingredients: await ids('recipe_ingredients'),
    steps: await ids('recipe_steps'),
    videos: await ids('recipe_videos'),
  };
}

export type RecipeInsert = {
  authorId: string;
  bookId: string | null;
  title: string;
  status: RecipeRow['status'];
  visibility: RecipeRow['visibility'];
  servings: number;
  difficulty: RecipeRow['difficulty'];
  prepMin: number | null;
  cookMin: number | null;
  language: string | null;
  authorNotes: string | null;
  coverMediaId: string | null;
  /** PRD 3.2 source_type; imports also keep the original text (raw_text). */
  sourceType?: 'manual' | 'paste' | 'bot_forward' | 'ocr';
  rawText?: string | null;
};

export async function insertRecipe(tx: Tx, r: RecipeInsert): Promise<string> {
  const res = await tx.query<{ id: string }>(
    `INSERT INTO recipes (author_id, book_id, title, status, visibility, share_token, servings, difficulty,
                          prep_min, cook_min, language, author_notes, cover_media_id, source_type, raw_text,
                          published_at)
     VALUES ($1, $2, $3, $4::recipe_status, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::recipe_source, $15,
             CASE WHEN $4::recipe_status = 'published' THEN now() END)
     RETURNING id`,
    [
      r.authorId,
      r.bookId,
      r.title,
      r.status,
      r.visibility,
      r.visibility === 'link' ? newShareToken() : null,
      r.servings,
      r.difficulty,
      r.prepMin,
      r.cookMin,
      r.language,
      r.authorNotes,
      r.coverMediaId,
      r.sourceType ?? 'manual',
      r.rawText ?? null,
    ],
  );
  return res.rows[0]!.id;
}

/**
 * Replaces the recipe's content with the plan. Lines that carry an id keep it (so `{ing:<id>}`
 * references and running timers that point at a step stay valid); lines without one are new.
 */
export async function writeContent(tx: Tx, recipeId: string, plan: ContentPlan): Promise<void> {
  const keep = (rows: Array<{ id: string | null }>) =>
    rows.map((x) => x.id).filter((x): x is string => !!x);

  await tx.query('DELETE FROM recipe_steps WHERE recipe_id = $1 AND NOT (id = ANY($2::uuid[]))', [
    recipeId,
    keep(plan.steps),
  ]);
  await tx.query(
    'DELETE FROM recipe_ingredients WHERE recipe_id = $1 AND NOT (id = ANY($2::uuid[]))',
    [recipeId, keep(plan.ingredients)],
  );
  await tx.query('DELETE FROM recipe_videos WHERE recipe_id = $1 AND NOT (id = ANY($2::uuid[]))', [
    recipeId,
    keep(plan.videos),
  ]);

  const ingredientIds = new Map<string, string>();
  for (const [position, i] of plan.ingredients.entries()) {
    const values = [
      recipeId,
      position,
      i.group_label,
      i.name,
      i.name_norm,
      i.qty_kind,
      i.amount_min,
      i.amount_max,
      i.unit_code,
      i.unit_raw,
      i.round_class,
      i.min_piece,
      i.optional,
      i.note,
      i.raw_line,
      i.parse_confidence,
    ];
    if (i.id) {
      await tx.query(
        `UPDATE recipe_ingredients SET position = $2, group_label = $3, name = $4, name_norm = $5, qty_kind = $6,
           amount_min = $7, amount_max = $8, unit_code = $9, unit_raw = $10, round_class = $11, min_piece = $12,
           optional = $13, note = $14, raw_line = $15, parse_confidence = $16
         WHERE id = $17 AND recipe_id = $1`,
        [...values, i.id],
      );
      ingredientIds.set(i.ref, i.id);
    } else {
      const r = await tx.query<{ id: string }>(
        `INSERT INTO recipe_ingredients (recipe_id, position, group_label, name, name_norm, qty_kind, amount_min,
           amount_max, unit_code, unit_raw, round_class, min_piece, optional, note, raw_line, parse_confidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
        values,
      );
      ingredientIds.set(i.ref, r.rows[0]!.id);
    }
  }

  const videoIds = new Map<string, string>();
  for (const [position, v] of plan.videos.entries()) {
    if (v.id) {
      await tx.query(
        'UPDATE recipe_videos SET position = $2, youtube_id = $3, title = $4 WHERE id = $5 AND recipe_id = $1',
        [recipeId, position, v.youtube_id, v.title, v.id],
      );
      videoIds.set(v.ref, v.id);
    } else {
      const r = await tx.query<{ id: string }>(
        'INSERT INTO recipe_videos (recipe_id, position, youtube_id, title) VALUES ($1, $2, $3, $4) RETURNING id',
        [recipeId, position, v.youtube_id, v.title],
      );
      videoIds.set(v.ref, r.rows[0]!.id);
    }
  }

  for (const [position, s] of plan.steps.entries()) {
    const body = s.body.replace(
      PLACEHOLDER,
      (_m, ref: string) => `{ing:${ingredientIds.get(ref)}}`,
    );
    const videoId = s.video_ref ? videoIds.get(s.video_ref)! : null;
    const values = [
      recipeId,
      position,
      s.title,
      body,
      videoId,
      s.video_start_sec,
      s.photo_media_id,
    ];
    let stepId: string;
    if (s.id) {
      await tx.query(
        `UPDATE recipe_steps SET position = $2, title = $3, body = $4, video_id = $5, video_start_sec = $6,
           photo_media_id = $7
         WHERE id = $8 AND recipe_id = $1`,
        [...values, s.id],
      );
      stepId = s.id;
    } else {
      const r = await tx.query<{ id: string }>(
        `INSERT INTO recipe_steps (recipe_id, position, title, body, video_id, video_start_sec, photo_media_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        values,
      );
      stepId = r.rows[0]!.id;
    }
    await tx.query('DELETE FROM step_ingredients WHERE step_id = $1', [stepId]);
    for (const l of s.links) {
      await tx.query(
        'INSERT INTO step_ingredients (step_id, ingredient_id, portion_fraction) VALUES ($1, $2, $3)',
        [stepId, ingredientIds.get(l.ref), l.portion_fraction],
      );
    }
    await tx.query('DELETE FROM step_timers WHERE step_id = $1', [stepId]);
    for (const [k, t] of s.timers.entries()) {
      await tx.query(
        'INSERT INTO step_timers (step_id, position, label, duration_sec) VALUES ($1, $2, $3, $4)',
        [stepId, k, t.label, t.duration_sec],
      );
    }
  }
}

/** System slugs are matched exactly; any other text becomes a free-form tag (PRD 3.2 tags). */
export async function setTags(tx: Tx, recipeId: string, tags: string[]): Promise<void> {
  await tx.query('DELETE FROM recipe_tags WHERE recipe_id = $1', [recipeId]);
  const unique = [...new Map(tags.map((t) => [t.trim().toLocaleLowerCase(), t.trim()])).values()];
  for (const tag of unique) {
    const system = await tx.query<{ id: string }>(
      'SELECT id FROM tags WHERE slug = $1 AND custom_name IS NULL',
      [tag],
    );
    const id =
      system.rows[0]?.id ??
      (await tx.query<{ id: string }>('SELECT ensure_custom_tag($1) AS id', [tag])).rows[0]!.id;
    await tx.query(
      'INSERT INTO recipe_tags (recipe_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [recipeId, id],
    );
  }
}

export async function countContent(
  tx: Tx,
  recipeId: string,
): Promise<{ ingredients: number; steps: number }> {
  const r = await tx.query<{ i: number; s: number }>(
    `SELECT (SELECT count(*)::int FROM recipe_ingredients WHERE recipe_id = $1) AS i,
            (SELECT count(*)::int FROM recipe_steps WHERE recipe_id = $1) AS s`,
    [recipeId],
  );
  return { ingredients: r.rows[0]!.i, steps: r.rows[0]!.s };
}

export type RecipeChildren = {
  ingredients: Array<Record<string, unknown>>;
  videos: Array<Record<string, unknown>>;
  steps: Array<Record<string, unknown> & { id: string }>;
  links: Array<{ step_id: string; ingredient_id: string; portion_fraction: number }>;
  timers: Array<{
    id: string;
    step_id: string;
    position: number;
    label: string;
    duration_sec: number;
  }>;
  tags: Array<{ slug: string; custom_name: string | null }>;
};

export async function loadChildren(tx: Tx, recipeId: string): Promise<RecipeChildren> {
  const q = async <T extends object>(sql: string) =>
    (await tx.query<T & Record<string, unknown>>(sql, [recipeId])).rows;
  return {
    ingredients: await q(
      `SELECT id, position, group_label, name, qty_kind, amount_min, amount_max, unit_code, unit_raw, round_class,
              min_piece, optional, note, raw_line, parse_confidence
         FROM recipe_ingredients WHERE recipe_id = $1 ORDER BY position`,
    ),
    videos: await q(
      `SELECT id, position, youtube_id, title FROM recipe_videos WHERE recipe_id = $1 ORDER BY position`,
    ),
    steps: await q<{ id: string }>(
      `SELECT id, position, title, body, photo_media_id, video_id, video_start_sec
         FROM recipe_steps WHERE recipe_id = $1 ORDER BY position`,
    ),
    links: await q<{ step_id: string; ingredient_id: string; portion_fraction: number }>(
      `SELECT si.step_id, si.ingredient_id, si.portion_fraction
         FROM step_ingredients si JOIN recipe_steps s ON s.id = si.step_id WHERE s.recipe_id = $1`,
    ),
    timers: await q<{
      id: string;
      step_id: string;
      position: number;
      label: string;
      duration_sec: number;
    }>(
      `SELECT t.id, t.step_id, t.position, t.label, t.duration_sec
         FROM step_timers t JOIN recipe_steps s ON s.id = t.step_id WHERE s.recipe_id = $1 ORDER BY t.position`,
    ),
    tags: await q<{ slug: string; custom_name: string | null }>(
      `SELECT t.slug, t.custom_name FROM recipe_tags rt JOIN tags t ON t.id = rt.tag_id
        WHERE rt.recipe_id = $1 ORDER BY t.custom_name NULLS FIRST, t.slug`,
    ),
  };
}

export type ListItem = {
  id: string;
  title: string;
  author_id: string;
  author_name: string | null;
  difficulty: RecipeRow['difficulty'];
  prep_min: number | null;
  cook_min: number | null;
  servings: number;
  visibility: RecipeRow['visibility'];
  status: RecipeRow['status'];
  language: string | null;
  published_at: Date | null;
  updated_at: Date;
  sort_at: Date;
  cover_media_id: string | null;
  ingredient_names: string[];
  tags: Array<{ slug: string; custom_name: string | null }>;
};

export type ListOptions = {
  scope: 'book' | 'mine';
  userId: string;
  bookId: string | null;
  limit: number;
  after: { at: string; id: string } | null;
  /** BE-11: search words (see searchWords); every one must match. Empty: no text search. */
  words: string[];
  /** System or free-form tag slugs; a recipe must have all of them. */
  tags: string[];
  difficulty: 'easy' | 'medium' | 'hard' | null;
  /** Preparation + cooking time at most this; recipes without any time never match. */
  maxMin: number | null;
};

/**
 * One page, newest first, keyset-paginated, with search and filters (BE-11, D-034). Reads through
 * RLS. Results stay in date order (not by relevance) so pages remain stable for the cursor.
 */
export async function listRecipes(tx: Tx, o: ListOptions): Promise<ListItem[]> {
  const sortExpr = o.scope === 'book' ? 'coalesce(r.published_at, r.created_at)' : 'r.updated_at';
  const params: unknown[] = [o.scope === 'book' ? o.bookId : o.userId, o.limit];
  const p = (v: unknown) => `$${params.push(v)}`;
  const conds = [
    o.scope === 'book'
      ? `r.book_id = $1 AND r.status = 'published' AND r.visibility IN ('book', 'link')`
      : `r.author_id = $1`,
  ];
  if (o.after)
    conds.push(`(${sortExpr}, r.id) < (${p(o.after.at)}::timestamptz, ${p(o.after.id)}::uuid)`);
  if (o.words.length > 0) conds.push(`r.search_tsv @@ recipe_search_query(${p(o.words)}::text[])`);
  if (o.tags.length > 0)
    conds.push(
      `(SELECT count(*) FROM recipe_tags rt JOIN tags t ON t.id = rt.tag_id
         WHERE rt.recipe_id = r.id AND t.slug = ANY(${p(o.tags)}::text[])) = ${p(o.tags.length)}`,
    );
  if (o.difficulty) conds.push(`r.difficulty = ${p(o.difficulty)}::recipe_difficulty`);
  if (o.maxMin !== null)
    conds.push(
      `(r.prep_min IS NOT NULL OR r.cook_min IS NOT NULL)
       AND coalesce(r.prep_min, 0) + coalesce(r.cook_min, 0) <= ${p(o.maxMin)}`,
    );
  const r = await tx.query<ListItem>(
    `SELECT r.id, r.title, r.author_id, recipe_author_name(r.id) AS author_name, r.difficulty, r.prep_min,
            r.cook_min, r.servings, r.visibility, r.status, trim(r.language) AS language, r.published_at,
            r.updated_at, ${sortExpr} AS sort_at, r.cover_media_id,
            coalesce((SELECT array_agg(i.name ORDER BY i.position) FROM recipe_ingredients i WHERE i.recipe_id = r.id),
                     '{}') AS ingredient_names,
            coalesce((SELECT json_agg(json_build_object('slug', t.slug, 'custom_name', t.custom_name)
                                      ORDER BY t.custom_name NULLS FIRST, t.slug)
                        FROM recipe_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.recipe_id = r.id), '[]') AS tags
       FROM recipes r
      WHERE ${conds.join(' AND ')}
      ORDER BY ${sortExpr} DESC, r.id DESC
      LIMIT $2`,
    params,
  );
  return r.rows;
}
