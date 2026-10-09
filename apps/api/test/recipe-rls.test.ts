import { UNITS } from '@cookbook/recipe-core';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/pool.js';
import { withUser } from '../src/db/tx.js';
import { adminPool, authHeader, resetData, testApp, testPool } from './helpers/db.js';
import { fullRecipe } from './helpers/recipes.js';

/** RLS on the recipe content tables (migration 0004), exercised as the restricted role. */
let db: Db;
let admin: Db;
let app: FastifyInstance;
const tg = { author: 8101, member: 8102, outsider: 8103 };
const ids = {} as Record<keyof typeof tg, string>;
let bookRecipe: { id: string; ingredients: Array<{ id: string }>; steps: Array<{ id: string }> };
let draft: { id: string; ingredients: Array<{ id: string }> };
let linkRecipe: { id: string; share_token: string };

beforeAll(async () => {
  db = testPool();
  admin = adminPool();
  app = await testApp(db);
});
afterAll(async () => {
  await app.close();
  await db.end();
  await admin.end();
});

const call = (method: 'POST' | 'PATCH', url: string, who: number, payload?: object) =>
  app.inject({ method, url, headers: authHeader(who), ...(payload ? { payload } : {}) });

beforeEach(async () => {
  await resetData(admin);
  const book = (await call('POST', '/books', tg.author, { title: 'B' })).json();
  await call('POST', '/books/join', tg.member, { invite_code: book.invite_code });
  await call('POST', '/books', tg.outsider, { title: 'Other' });
  for (const k of Object.keys(tg) as Array<keyof typeof tg>) {
    ids[k] = (await admin.query('SELECT id FROM users WHERE tg_user_id = $1', [tg[k]])).rows[0].id;
  }
  bookRecipe = (
    await call(
      'POST',
      '/recipes',
      tg.author,
      fullRecipe({ status: 'published', visibility: 'book' }),
    )
  ).json();
  draft = (
    await call(
      'POST',
      '/recipes',
      tg.author,
      fullRecipe({ title: 'Draft', tags: ['Секретный тег'] }),
    )
  ).json();
  linkRecipe = (
    await call(
      'POST',
      '/recipes',
      tg.author,
      fullRecipe({ title: 'Link', status: 'published', visibility: 'link' }),
    )
  ).json();
});

const count = (userId: string, sql: string, params: unknown[] = [], shareToken?: string) =>
  withUser(db, { userId, shareToken }, async (tx) => (await tx.query(sql, params)).rowCount);

const CHILD_READS: Array<[string, string]> = [
  ['ingredients', 'SELECT 1 FROM recipe_ingredients WHERE recipe_id = $1'],
  ['steps', 'SELECT 1 FROM recipe_steps WHERE recipe_id = $1'],
  ['videos', 'SELECT 1 FROM recipe_videos WHERE recipe_id = $1'],
  [
    'step links',
    'SELECT 1 FROM step_ingredients si JOIN recipe_ingredients i ON i.id = si.ingredient_id WHERE i.recipe_id = $1',
  ],
  [
    'timers',
    'SELECT 1 FROM step_timers t JOIN recipe_steps s ON s.id = t.step_id WHERE s.recipe_id = $1',
  ],
  ['tags', 'SELECT 1 FROM recipe_tags WHERE recipe_id = $1'],
];

describe('reading recipe content follows the recipe (PRD 3.3)', () => {
  it.each(CHILD_READS)('%s: author and book member yes, outsider no', async (_name, sql) => {
    expect(await count(ids.author, sql, [bookRecipe.id])).toBeGreaterThan(0);
    expect(await count(ids.member, sql, [bookRecipe.id])).toBeGreaterThan(0);
    expect(await count(ids.outsider, sql, [bookRecipe.id])).toBe(0);
  });

  it.each(CHILD_READS)('%s of a draft: only the author', async (_name, sql) => {
    expect(await count(ids.author, sql, [draft.id])).toBeGreaterThan(0);
    expect(await count(ids.member, sql, [draft.id])).toBe(0);
  });

  it.each(CHILD_READS)(
    '%s of a link recipe: an outsider holding the token yes, without it no',
    async (_name, sql) => {
      expect(
        await count(ids.outsider, sql, [linkRecipe.id], linkRecipe.share_token),
      ).toBeGreaterThan(0);
      expect(await count(ids.outsider, sql, [linkRecipe.id])).toBe(0);
    },
  );

  it('a free-form tag of a draft stays invisible to others; system tags and units are public', async () => {
    const custom = 'SELECT 1 FROM tags WHERE custom_name = $1';
    expect(await count(ids.author, custom, ['Секретный тег'])).toBe(1);
    expect(await count(ids.member, custom, ['Секретный тег'])).toBe(0);
    expect(await count(ids.outsider, "SELECT 1 FROM tags WHERE slug = 'soup'")).toBe(1);
    expect(await count(ids.outsider, 'SELECT 1 FROM units')).toBe(UNITS.length);
  });
});

describe('writing recipe content: author only', () => {
  it("a book member cannot add, change or remove content of someone else's recipe", async () => {
    await expect(
      withUser(db, { userId: ids.member }, (tx) =>
        tx.query(
          `INSERT INTO recipe_ingredients (recipe_id, position, name, qty_kind) VALUES ($1, 99, 'x', 'pinch')`,
          [bookRecipe.id],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    expect(
      await count(
        ids.member,
        "UPDATE recipe_ingredients SET name = 'hacked' WHERE recipe_id = $1",
        [bookRecipe.id],
      ),
    ).toBe(0);
    expect(
      await count(ids.member, 'DELETE FROM recipe_steps WHERE recipe_id = $1', [bookRecipe.id]),
    ).toBe(0);
    expect(await count(ids.member, "UPDATE step_timers SET label = 'x'")).toBe(0);
  });

  it('a step can only be linked to an ingredient of the same recipe', async () => {
    const mine = (await call('POST', '/recipes', tg.member, fullRecipe({ title: 'Mine' }))).json();
    await expect(
      withUser(db, { userId: ids.member }, (tx) =>
        tx.query('INSERT INTO step_ingredients (step_id, ingredient_id) VALUES ($1, $2)', [
          mine.steps[0].id,
          bookRecipe.ingredients[0]!.id,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('a step can only link a video of the same recipe (foreign key)', async () => {
    const mine = (
      await call('POST', '/recipes', tg.author, fullRecipe({ title: 'Mine 2' }))
    ).json();
    const otherVideo = (
      await admin.query('SELECT id FROM recipe_videos WHERE recipe_id = $1', [bookRecipe.id])
    ).rows[0].id;
    await expect(
      withUser(db, { userId: ids.author }, (tx) =>
        tx.query('UPDATE recipe_steps SET video_id = $1 WHERE id = $2', [
          otherVideo,
          mine.steps[0].id,
        ]),
      ),
    ).rejects.toThrow(/recipe_steps_video/);
  });

  it('only the author may soft-delete; the keeper may only unpublish', async () => {
    const memberRecipe = (
      await call(
        'POST',
        '/recipes',
        tg.member,
        fullRecipe({ status: 'published', visibility: 'book' }),
      )
    ).json();
    const fn = (userId: string, name: string, id: string) =>
      withUser(
        db,
        { userId },
        async (tx) => (await tx.query(`SELECT ${name}($1) AS ok`, [id])).rows[0].ok,
      );
    expect(await fn(ids.author, 'soft_delete_recipe', memberRecipe.id)).toBe(false); // keeper
    expect(await fn(ids.outsider, 'unpublish_recipe', memberRecipe.id)).toBe(false);
    expect(await fn(ids.author, 'unpublish_recipe', memberRecipe.id)).toBe(true); // keeper moderation
    const row = (
      await admin.query('SELECT visibility, title, deleted_at FROM recipes WHERE id = $1', [
        memberRecipe.id,
      ])
    ).rows[0];
    expect(row).toEqual({ visibility: 'private', title: 'Голубцы', deleted_at: null });
  });

  it('ensure_custom_tag needs an identity', async () => {
    await expect(
      withUser(db, { userId: '' }, (tx) => tx.query("SELECT ensure_custom_tag('x')")),
    ).rejects.toThrow(/invalid custom tag/);
  });

  it('the share token exists exactly while visibility is link (constraint)', async () => {
    await expect(
      admin.query("UPDATE recipes SET visibility = 'book' WHERE id = $1", [linkRecipe.id]),
    ).rejects.toThrow(/recipes_share_token_iff_link/);
  });
});

describe('units: the database table equals the recipe-core list (single source of truth)', () => {
  it('same codes, dimensions, factors and aliases', async () => {
    const rows = (
      await admin.query('SELECT code, dimension, to_base, aliases FROM units ORDER BY code')
    ).rows;
    const expected = [...UNITS]
      .sort((a, b) => (a.code < b.code ? -1 : 1))
      .map((u) => ({
        code: u.code,
        dimension: u.dimension,
        to_base: u.toBase,
        aliases: u.aliases,
      }));
    expect(rows).toEqual(expected);
  });
});
