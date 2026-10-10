import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/pool.js';
import { withUser } from '../src/db/tx.js';
import { adminPool, resetData, testApp, testPool } from './helpers/db.js';
import { caller, family, KEEPER, MEMBER, OUTSIDER, type Family } from './helpers/cooking.js';

/**
 * The personal "Saved" shelf (PRD 1.x "one shared book + a personal Saved shelf", UC-10, 3.2
 * saved_recipes, 4.9 POST/DELETE /recipes/:id/save, GET /recipes?scope=saved; D-051). Saved
 * recipes are shown only while you may still read them.
 */
let db: Db;
let admin: Db;
let app: FastifyInstance;
let call: ReturnType<typeof caller>;
let fam: Family;

beforeAll(async () => {
  db = testPool();
  admin = adminPool();
  app = await testApp(db);
  call = caller(app);
});
afterAll(async () => {
  await app.close();
  await Promise.all([db.end(), admin.end()]);
});
beforeEach(async () => {
  await resetData(admin);
  fam = await family(app);
});

const save = (tg: number, id = fam.bookRecipeId) => call('POST', `/recipes/${id}/save`, tg);
const unsave = (tg: number, id = fam.bookRecipeId) => call('DELETE', `/recipes/${id}/save`, tg);
const shelf = async (tg: number, query = '') =>
  (await call('GET', `/recipes?scope=saved&limit=50${query}`, tg)).json() as {
    items: Array<{ id: string; title: string; is_saved: boolean }>;
    next_cursor: string | null;
  };

describe('saving a recipe', () => {
  it('a member saves a book recipe: on the shelf, and the card and the list know it', async () => {
    const r = await save(MEMBER);
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toEqual({ saved: true });
    expect((await save(MEMBER)).statusCode).toBe(200);
    expect((await shelf(MEMBER)).items).toEqual([
      expect.objectContaining({ id: fam.bookRecipeId, title: 'Голубцы', is_saved: true }),
    ]);
    expect((await call('GET', `/recipes/${fam.bookRecipeId}`, MEMBER)).json().is_saved).toBe(true);
    const book = (await call('GET', '/recipes?scope=book&limit=50', MEMBER)).json();
    expect(book.items[0]).toMatchObject({ id: fam.bookRecipeId, is_saved: true });
    // Someone else's shelf is their own.
    expect((await shelf(KEEPER)).items).toEqual([]);
    expect((await call('GET', `/recipes/${fam.bookRecipeId}`, KEEPER)).json().is_saved).toBe(false);
  });

  it('removing: gone from the shelf; removing again is fine', async () => {
    await save(MEMBER);
    expect((await unsave(MEMBER)).statusCode).toBe(204);
    expect((await shelf(MEMBER)).items).toEqual([]);
    expect((await call('GET', `/recipes/${fam.bookRecipeId}`, MEMBER)).json().is_saved).toBe(false);
    expect((await unsave(MEMBER)).statusCode).toBe(204);
  });

  it('only a recipe you may read (404 otherwise)', async () => {
    expect((await save(MEMBER, fam.outsiderRecipeId)).statusCode).toBe(404);
    expect((await save(OUTSIDER)).statusCode).toBe(404);
    expect((await save(MEMBER, randomUUID())).statusCode).toBe(404);
    expect((await unsave(MEMBER, randomUUID())).statusCode).toBe(204);
  });

  it('a saved recipe you may no longer read leaves the shelf (and comes back if it can be read again)', async () => {
    await save(MEMBER);
    await call('PATCH', `/recipes/${fam.bookRecipeId}`, KEEPER, { visibility: 'private' });
    expect((await shelf(MEMBER)).items).toEqual([]);
    await call('PATCH', `/recipes/${fam.bookRecipeId}`, KEEPER, { visibility: 'book' });
    expect((await shelf(MEMBER)).items).toHaveLength(1);
    await call('DELETE', `/recipes/${fam.bookRecipeId}`, KEEPER);
    expect((await shelf(MEMBER)).items).toEqual([]);
  });

  it('the shelf has search and pages like the book, newest saved first', async () => {
    const ids: string[] = [];
    for (const title of ['Борщ', 'Щи', 'Пельмени']) {
      const r = await call('POST', '/recipes', KEEPER, {
        title,
        servings: 2,
        language: 'ru',
        status: 'published',
        visibility: 'book',
        ingredients: [
          { ref: 'a', name: 'капуста', qty_kind: 'exact', amount_min: 300, unit_code: 'g' },
        ],
        steps: [{ body: 'Варите.' }],
      });
      ids.push(r.json().id);
      await save(MEMBER, r.json().id);
    }
    expect((await shelf(MEMBER)).items.map((i) => i.title)).toEqual(['Пельмени', 'Щи', 'Борщ']);
    expect((await shelf(MEMBER, '&q=борщ')).items.map((i) => i.title)).toEqual(['Борщ']);
    const page1 = (await call('GET', '/recipes?scope=saved&limit=2', MEMBER)).json();
    expect(page1.items).toHaveLength(2);
    const page2 = (
      await call('GET', `/recipes?scope=saved&limit=2&cursor=${page1.next_cursor}`, MEMBER)
    ).json();
    expect(page2.items.map((i: { title: string }) => i.title)).toEqual(['Борщ']);
  });

  it('the shelf filters like the book: tags, difficulty and time (S6-7)', async () => {
    const make = async (title: string, extra: Record<string, unknown>) => {
      const r = await call('POST', '/recipes', KEEPER, {
        title,
        servings: 2,
        language: 'ru',
        status: 'published',
        visibility: 'book',
        ingredients: [
          { ref: 'a', name: 'мука', qty_kind: 'exact', amount_min: 300, unit_code: 'g' },
        ],
        steps: [{ body: 'Пеките.' }],
        ...extra,
      });
      expect(r.statusCode, r.body).toBe(201);
      await save(MEMBER, r.json().id);
    };
    await make('Пирог', { tags: ['baking'], difficulty: 'easy', prep_min: 20, cook_min: 40 });
    await make('Хлеб', { tags: ['baking'], difficulty: 'hard', prep_min: 60, cook_min: 60 });
    await make('Салат', { difficulty: 'easy', prep_min: 10 });
    const titles = async (query: string) =>
      (await shelf(MEMBER, query)).items.map((i) => i.title).sort();
    expect(await titles('&tag=baking')).toEqual(['Пирог', 'Хлеб']);
    expect(await titles('&difficulty=easy')).toEqual(['Пирог', 'Салат']);
    expect(await titles('&max_min=60')).toEqual(['Пирог', 'Салат']);
    expect(await titles('&tag=baking&difficulty=easy&max_min=60')).toEqual(['Пирог']);
  });

  it('the database keeps each shelf private', async () => {
    await save(MEMBER);
    const keeperId = (
      await admin.query<{ id: string }>('SELECT id FROM users WHERE tg_user_id = $1', [KEEPER])
    ).rows[0]!.id;
    const seen = await withUser(db, { userId: keeperId }, (tx) =>
      tx.query('SELECT * FROM saved_recipes'),
    );
    expect(seen.rows).toEqual([]);
  });
});
