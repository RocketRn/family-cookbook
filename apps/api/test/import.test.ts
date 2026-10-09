import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/pool.js';
import { AppError } from '../src/errors.js';
import { WorkerParserPool, type ImportParser } from '../src/import/parserPool.js';
import { adminPool, authHeader, resetData, testApp, testPool } from './helpers/db.js';

/** BE-06 POST /recipes/import (PRD 2.2, 4.9; D-033). */
let db: Db;
let admin: Db;
let app: FastifyInstance;
beforeAll(() => {
  db = testPool();
  admin = adminPool();
});
afterAll(async () => {
  await db.end();
  await admin.end();
});
beforeEach(() => resetData(admin));
afterEach(() => app?.close());

const fixture = (name: string) =>
  readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      `../../../packages/recipe-core/test/fixtures/import/${name}.txt`,
    ),
    'utf8',
  );
const post = (body: unknown, tg = 1001) =>
  app.inject({
    method: 'POST',
    url: '/recipes/import',
    payload: body as object,
    headers: authHeader(tg),
  });

describe('POST /recipes/import', () => {
  it('turns pasted text into a private draft, keeping the original text', async () => {
    app = await testApp(db);
    const text = fixture('01-ru-sharlotka');
    const res = await post({ text, ui_lang: 'en' });
    expect(res.statusCode).toBe(201);
    const { recipe, import: info } = res.json();
    expect(recipe).toMatchObject({
      title: 'Шарлотка с яблоками',
      status: 'draft',
      visibility: 'private',
      servings: 6,
      language: 'ru',
      author_notes: 'Яблоки лучше кислые: антоновка или симиренко.',
    });
    expect(
      recipe.ingredients.map((i: { group_label: string; name: string }) => [i.group_label, i.name]),
    ).toEqual([
      ['Для теста', 'яйца'],
      ['Для теста', 'сахара'],
      ['Для теста', 'муки'],
      ['Для теста', 'соли'],
      ['Для начинки', 'кислых яблок'],
      ['Для начинки', 'корица'],
    ]);
    expect(recipe.steps).toHaveLength(4);
    expect(recipe.steps[3]).toMatchObject({
      body: 'Выпекайте 40 минут при 180 °C.',
      video_start_sec: 30,
    });
    expect(recipe.steps[3].timers).toEqual([
      expect.objectContaining({ duration_sec: 2400, label: 'Выпекайте 40 минут при 180 °C' }),
    ]);
    expect(recipe.videos).toEqual([expect.objectContaining({ youtube_id: 'aqz-KE-bpKQ' })]);
    // Confidence is stored on the line; the reasons come with the response.
    expect(info.lines[0]).toEqual({
      ingredient_id: recipe.ingredients[0].id,
      confidence: 0.9,
      reasons: ['p4'],
    });
    expect(info.warnings).toEqual([]);
    const row = await admin.query('SELECT source_type, raw_text FROM recipes WHERE id = $1', [
      recipe.id,
    ]);
    expect(row.rows[0]).toEqual({ source_type: 'paste', raw_text: text });
    const conf = await admin.query(
      'SELECT parse_confidence FROM recipe_ingredients WHERE id = $1',
      [recipe.ingredients[4].id],
    );
    expect(Number(conf.rows[0].parse_confidence)).toBeCloseTo(0.8, 6);
  });

  it('links an ingredient mentioned in several steps with shares that add up to at most 1', async () => {
    app = await testApp(db);
    const res = await post({ text: fixture('01-ru-sharlotka'), ui_lang: 'ru' });
    const { recipe } = res.json();
    const sugar = recipe.ingredients[1].id; // "сахара": steps 1 only; "муки": steps 2
    const flourId = recipe.ingredients[2].id;
    const shares = (id: string) =>
      recipe.steps.flatMap(
        (s: { ingredients: Array<{ ingredient_id: string; portion_fraction: number }> }) =>
          s.ingredients.filter((l) => l.ingredient_id === id).map((l) => l.portion_fraction),
      );
    expect(shares(sugar)).toEqual([1]);
    expect(shares(flourId).reduce((a: number, b: number) => a + b, 0)).toBeLessThanOrEqual(1);
  });

  it('a text without a title gets a neutral one in the user language; only the author sees the draft', async () => {
    app = await testApp(db);
    const res = await post({ text: '2 яйца\n1 стакан сахара', ui_lang: 'uk' });
    expect(res.statusCode).toBe(201);
    expect(res.json().recipe.title).toBe('Новий рецепт');
    expect(res.json().import.warnings).toContain('no_steps');
    const other = await app.inject({
      method: 'GET',
      url: `/recipes/${res.json().recipe.id}`,
      headers: authHeader(2002),
    });
    expect(other.statusCode).toBe(404);
  });

  it('refuses an empty text and a text over 20,000 characters (PRD 7.1)', async () => {
    app = await testApp(db);
    expect((await post({ text: '   \n ', ui_lang: 'ru' })).json().error.code).toBe(
      'VALIDATION_ERROR',
    );
    expect((await post({ text: 'а'.repeat(20_001), ui_lang: 'ru' })).statusCode).toBe(400);
    expect((await post({ text: 'а'.repeat(20_000), ui_lang: 'ru' })).statusCode).toBe(201);
  });

  it('a hostile 20,000-character text is answered quickly, without an error', async () => {
    app = await testApp(db);
    const t = Date.now();
    const res = await post({ text: ('1' + ' '.repeat(50) + '- ').repeat(370), ui_lang: 'ru' });
    expect(res.statusCode).toBe(201);
    expect(Date.now() - t).toBeLessThan(5000);
  });

  it('has its own rate limit (PRD 7.1: 10 per minute)', async () => {
    app = await testApp(db, { env: { RATE_LIMIT_IMPORTS_PER_USER: '2' } });
    expect((await post({ text: 'Суп\n1 л воды', ui_lang: 'ru' })).statusCode).toBe(201);
    expect((await post({ text: 'Суп\n1 л воды', ui_lang: 'ru' })).statusCode).toBe(201);
    const third = await post({ text: 'Суп\n1 л воды', ui_lang: 'ru' });
    expect(third.statusCode).toBe(429);
    expect(third.json().error.code).toBe('RATE_LIMITED');
  });

  it('a parse over the time limit is answered 422 IMPORT_TIMEOUT and creates nothing', async () => {
    const slow: ImportParser = {
      parse: () => Promise.reject(new AppError(422, 'IMPORT_TIMEOUT', 'too slow')),
      close: async () => {},
    };
    app = await testApp(db, { importParser: slow });
    const res = await post({ text: 'Суп\n1 л воды', ui_lang: 'ru' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('IMPORT_TIMEOUT');
    expect((await admin.query('SELECT count(*)::int AS n FROM recipes')).rows[0].n).toBe(0);
  });
});

describe('parser worker pool: the hard time limit', () => {
  it('stops a parse that runs too long, then keeps working with a fresh worker', async () => {
    const pool = new WorkerParserPool({ size: 1, timeoutMs: 2000, testHooks: true });
    try {
      const t = Date.now();
      await expect(pool.parse('Суп\n1 л воды', 'ru', { busyMs: 30_000 })).rejects.toMatchObject({
        code: 'IMPORT_TIMEOUT',
      });
      expect(Date.now() - t).toBeLessThan(5000);
      const ok = await pool.parse('Суп\n1 л воды', 'ru');
      expect(ok.ingredients[0]).toMatchObject({ amountMin: 1, unitCode: 'l', name: 'воды' });
    } finally {
      await pool.close();
    }
  });
});
