import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/pool.js';
import { adminPool, authHeader, resetData, testApp, testPool } from './helpers/db.js';

/** BE-11 search and filters on GET /recipes (PRD 3.2 search_tsv, 4.9; D-034). */
let db: Db;
let admin: Db;
let app: FastifyInstance;
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

const KEEPER = 9001;
const MEMBER = 9002;
const OUTSIDER = 9003;

type Method = 'GET' | 'POST' | 'PATCH';
const call = (method: Method, url: string, tg: number, payload?: object) =>
  app.inject({ method, url, headers: authHeader(tg), ...(payload ? { payload } : {}) });

let refs = 0;
const ing = (name: string) => ({ ref: `r${++refs}`, name, qty_kind: 'to_taste' });
const step = { body: 'Готовьте.' };
async function publish(tg: number, body: Record<string, unknown>): Promise<string> {
  const res = await call('POST', '/recipes', tg, {
    servings: 4,
    language: 'ru',
    steps: [step],
    status: 'published',
    visibility: 'book',
    ...body,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id;
}
const titles = async (query: string, tg = MEMBER): Promise<string[]> => {
  const res = await call('GET', `/recipes?${query}`, tg);
  expect(res.statusCode, res.body).toBe(200);
  return res
    .json()
    .items.map((i: { title: string }) => i.title)
    .sort();
};
const search = (q: string, tg = MEMBER) => titles(`q=${encodeURIComponent(q)}`, tg);

beforeEach(async () => {
  await resetData(admin);
  const book = (await call('POST', '/books', KEEPER, { title: 'Семья' })).json();
  await call('POST', '/books/join', MEMBER, { invite_code: book.invite_code });
  await call('POST', '/books', OUTSIDER, { title: 'Другие' });
  await publish(KEEPER, {
    title: 'Голубцы',
    difficulty: 'hard',
    prep_min: 30,
    cook_min: 90,
    tags: ['main', 'Бабушкины'],
    ingredients: [ing('говяжий фарш'), ing('сметана'), ing('мёд')],
  });
  await publish(KEEPER, {
    title: 'Шарлотка',
    difficulty: 'easy',
    prep_min: 15,
    cook_min: 40,
    tags: ['baking', 'dessert'],
    ingredients: [ing('кислых яблок'), ing('сахара'), ing('корица')],
  });
  await publish(MEMBER, {
    title: 'Tomato soup',
    language: 'en',
    difficulty: 'easy',
    cook_min: 20,
    tags: ['soup'],
    ingredients: [ing('ripe tomatoes'), ing('garlic')],
  });
  await publish(MEMBER, {
    title: 'Köttbullar',
    language: 'sv',
    tags: ['main'],
    ingredients: [ing('köttfärs'), ing('äpplen')],
  });
  await publish(MEMBER, {
    title: 'Пиріг з яблуками',
    language: 'uk',
    difficulty: 'medium',
    prep_min: 20,
    tags: ['dessert'],
    ingredients: [ing('яблуко'), ing('борошно')],
  });
});

describe('GET /recipes?q= (server-side search)', () => {
  it('matches the beginning of a word while the user is still typing', async () => {
    expect(await search('голу')).toEqual(['Голубцы']);
    expect(await search('Шарл')).toEqual(['Шарлотка']);
    expect(await search('tom')).toEqual(['Tomato soup']);
  });

  it('finds ingredients in another grammatical form (ru, en, sv, uk)', async () => {
    expect(await search('яблоки')).toEqual(['Шарлотка']);
    expect(await search('сметаной')).toEqual(['Голубцы']);
    expect(await search('tomato')).toEqual(['Tomato soup']);
    expect(await search('äpple')).toEqual(['Köttbullar']);
    expect(await search('яблука')).toEqual(['Пиріг з яблуками']);
  });

  it('treats ё and е as the same letter, and ignores case', async () => {
    expect(await search('мед')).toEqual(['Голубцы']);
    expect(await search('МЁД')).toEqual(['Голубцы']);
  });

  it('finds tags by their name in any interface language, and free-form tags by their text', async () => {
    expect(await search('десерт')).toEqual(['Пиріг з яблуками', 'Шарлотка']);
    expect(await search('efterrätt')).toEqual(['Пиріг з яблуками', 'Шарлотка']);
    expect(await search('soppa')).toEqual(['Tomato soup']);
    expect(await search('бабушк')).toEqual(['Голубцы']);
  });

  it('needs every word to match (title, ingredient or tag)', async () => {
    expect(await search('шарлотка корица')).toEqual(['Шарлотка']);
    expect(await search('шарлотка чеснок')).toEqual([]);
    expect(await search('  ,.  ')).toHaveLength(5); // nothing to search for: the whole list
  });

  it('follows edits: new ingredients and tags are found, removed ones are not', async () => {
    const id = (await call('GET', '/recipes?q=шарлотка', KEEPER)).json().items[0].id;
    const patch = await call('PATCH', `/recipes/${id}`, KEEPER, {
      title: 'Яблочный пирог',
      tags: ['breakfast'],
      ingredients: [{ ref: 'a', name: 'груши', qty_kind: 'to_taste' }],
      steps: [{ body: 'Пеките.' }],
    });
    expect(patch.statusCode, patch.body).toBe(200);
    expect(await search('груш')).toEqual(['Яблочный пирог']);
    expect(await search('завтрак')).toEqual(['Яблочный пирог']);
    expect(await search('шарлотка')).toEqual([]);
    expect(await search('корица')).toEqual([]);
    expect(await search('десерт')).toEqual(['Пиріг з яблуками']);
  });

  it('never shows what the user may not read', async () => {
    await publish(OUTSIDER, { title: 'Чужие голубцы', ingredients: [ing('фарш')] });
    const draft = await call('POST', '/recipes', KEEPER, {
      title: 'Голубцы черновик',
      servings: 2,
    });
    expect(draft.statusCode).toBe(201);
    expect(await search('голубцы')).toEqual(['Голубцы']);
    expect(await titles('scope=mine&q=голубцы', KEEPER)).toEqual(['Голубцы', 'Голубцы черновик']);
    expect(await search('голубцы', OUTSIDER)).toEqual(['Чужие голубцы']);
  });

  it('is safe with any text: operators, quotes and other symbols are just characters', async () => {
    for (const q of [
      "'",
      '\\',
      '&|!():*<->',
      "голубцы' | 'шарлотка",
      'a:*',
      '((',
      '%',
      '_',
      '😀',
    ]) {
      const res = await call('GET', `/recipes?q=${encodeURIComponent(q)}`, MEMBER);
      expect(res.statusCode, `${q}: ${res.body}`).toBe(200);
    }
    expect(await search("голубцы' | 'шарлотка")).toEqual([]);
    expect((await call('GET', `/recipes?q=${'а'.repeat(101)}`, MEMBER)).statusCode).toBe(400);
  });
});

describe('GET /recipes filters', () => {
  it('filters by tag (every listed tag must be present), difficulty and total time', async () => {
    expect(await titles('tag=dessert')).toEqual(['Пиріг з яблуками', 'Шарлотка']);
    expect(await titles('tag=dessert&tag=baking')).toEqual(['Шарлотка']);
    expect(await titles('difficulty=easy')).toEqual(['Tomato soup', 'Шарлотка']);
    // Total = preparation + cooking; a recipe without any time never matches a time limit.
    expect(await titles('max_min=60')).toEqual(
      ['Tomato soup', 'Шарлотка', 'Пиріг з яблуками'].sort(),
    );
    expect(await titles('max_min=20')).toEqual(['Пиріг з яблуками', 'Tomato soup'].sort());
    expect(await titles('q=яблок&tag=dessert&difficulty=easy&max_min=60')).toEqual(['Шарлотка']);
  });

  it('pages through search results with the same cursor', async () => {
    const first = (await call('GET', '/recipes?q=десерт&limit=1', MEMBER)).json();
    expect(first.items).toHaveLength(1);
    expect(first.next_cursor).toBeTruthy();
    const second = (
      await call('GET', `/recipes?q=десерт&limit=1&cursor=${first.next_cursor}`, MEMBER)
    ).json();
    expect([first.items[0].title, second.items[0].title].sort()).toEqual([
      'Пиріг з яблуками',
      'Шарлотка',
    ]);
    expect(second.next_cursor).toBeNull();
  });

  it('refuses unknown values', async () => {
    for (const q of [
      'difficulty=extreme',
      'max_min=0',
      'max_min=abc',
      'tag=Not%20a%20slug',
      'sort=x',
    ]) {
      expect((await call('GET', `/recipes?${q}`, MEMBER)).statusCode, q).toBe(400);
    }
  });
});

describe('search vocabulary', () => {
  it('the tag names the search knows are exactly the ones the app shows (web locales)', async () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const slugs = [
      'soup',
      'main',
      'salad',
      'breakfast',
      'baking',
      'dessert',
      'vegan',
      'gluten_free',
      'lean',
    ];
    for (const slug of slugs) {
      const expected = ['en', 'ru', 'uk', 'sv'].map(
        (l) =>
          JSON.parse(readFileSync(path.join(dir, `../../web/src/i18n/locales/${l}.json`), 'utf8'))
            .tags[slug] as string,
      );
      const r = await admin.query<{ words: string }>('SELECT system_tag_words($1) AS words', [
        slug,
      ]);
      expect(r.rows[0]!.words, slug).toBe(expected.join(' '));
    }
  });
});
