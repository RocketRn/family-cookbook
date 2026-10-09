import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/pool.js';
import { adminPool, authHeader, resetData, testApp, testPool } from './helpers/db.js';
import { fullRecipe } from './helpers/recipes.js';

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

const KEEPER = 8001;
const MEMBER = 8002;
const OUTSIDER = 8003;

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
const call = (method: Method, url: string, tg: number, payload?: object) =>
  app.inject({ method, url, headers: authHeader(tg), ...(payload ? { payload } : {}) });

beforeEach(async () => {
  await resetData(admin);
  const book = (await call('POST', '/books', KEEPER, { title: 'Семья' })).json();
  expect(
    (await call('POST', '/books/join', MEMBER, { invite_code: book.invite_code })).statusCode,
  ).toBe(201);
  await call('POST', '/books', OUTSIDER, { title: 'Другие' });
});

async function create(tg: number, body: object = fullRecipe()) {
  const res = await call('POST', '/recipes', tg, body);
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}
const publishToBook = (tg: number, id: string) =>
  call('PATCH', `/recipes/${id}`, tg, { status: 'published', visibility: 'book' });

describe('POST /recipes and GET /recipes/:id', () => {
  it('creates a private draft by default, in the author book, version 1', async () => {
    const r = await create(MEMBER, { title: 'Черновик' });
    expect(r).toMatchObject({
      title: 'Черновик',
      status: 'draft',
      visibility: 'private',
      version: 1,
      servings: 4,
      is_mine: true,
    });
    expect(r.book_id).toBeTruthy();
    expect(r.share_token).toBeNull();
  });

  it('stores the full structure and returns it with stable ids', async () => {
    const r = await create(MEMBER);
    expect(r.ingredients.map((i: { name: string }) => i.name)).toEqual([
      'говяжий фарш',
      'яйца',
      'мука',
      'сметана',
      'лавровый лист',
      'соль',
    ]);
    const [farsh, eggs, flour, cream, bay, salt] = r.ingredients;
    expect(farsh).toMatchObject({
      qty_kind: 'exact',
      amount_min: 800,
      amount_max: 800,
      unit_code: 'g',
      round_class: 'continuous',
    });
    expect(eggs).toMatchObject({ round_class: 'whole_item', min_piece: 1 }); // classified from the name
    expect(bay).toMatchObject({ round_class: 'spice_item' });
    expect(flour).toMatchObject({ group_label: 'Для соуса' });
    expect(cream).toMatchObject({ qty_kind: 'range', amount_min: 2, amount_max: 3 });
    expect(salt).toMatchObject({
      qty_kind: 'to_taste',
      amount_min: null,
      unit_code: null,
      raw_line: 'соль по вкусу',
    });

    const [s1, s2] = r.steps;
    expect(s1.body).toBe(`Смешайте {ing:${farsh.id}} и {ing:${eggs.id}}.`); // refs rewritten to ids
    expect(s1.ingredients).toEqual(
      expect.arrayContaining([
        { ingredient_id: farsh.id, portion_fraction: 1 },
        { ingredient_id: eggs.id, portion_fraction: 0.5 },
      ]),
    );
    expect(s2).toMatchObject({ video_id: r.videos[0].id, video_start_sec: 42 });
    expect(s2.timers).toEqual([
      { id: expect.any(String), position: 0, label: 'Тушение', duration_sec: 5400 },
    ]);
    expect(r.tags).toEqual([
      { slug: 'main', custom_name: null },
      { slug: expect.stringMatching(/^c:/), custom_name: 'Бабушкины' },
    ]);
    expect(r.author).toEqual({ id: expect.any(String), name: `User${MEMBER}` });

    const again = await call('GET', `/recipes/${r.id}`, MEMBER);
    expect(again.json()).toEqual(r);
  });

  it.each<[string, Record<string, unknown>]>([
    [
      'unknown unit',
      {
        ingredients: [
          { ref: 'a', name: 'x', qty_kind: 'exact', amount_min: 1, unit_code: 'bucket' },
        ],
      },
    ],
    [
      'duplicate refs',
      {
        ingredients: [
          { ref: 'a', name: 'x', qty_kind: 'pinch' },
          { ref: 'a', name: 'y', qty_kind: 'pinch' },
        ],
      },
    ],
    ['exact without amount', { ingredients: [{ ref: 'a', name: 'x', qty_kind: 'exact' }] }],
    [
      'reversed range',
      { ingredients: [{ ref: 'a', name: 'x', qty_kind: 'range', amount_min: 3, amount_max: 2 }] },
    ],
    [
      'to_taste with an amount',
      { ingredients: [{ ref: 'a', name: 'x', qty_kind: 'to_taste', amount_min: 1 }] },
    ],
    [
      'step links an unknown ingredient',
      { steps: [{ body: 'x', ingredients: [{ ref: 'nope' }] }] },
    ],
    [
      'portions add up to more than 1',
      {
        ingredients: [{ ref: 'a', name: 'x', qty_kind: 'exact', amount_min: 1 }],
        steps: [
          { body: 's1', ingredients: [{ ref: 'a', portion_fraction: 0.7 }] },
          { body: 's2', ingredients: [{ ref: 'a', portion_fraction: 0.7 }] },
        ],
      },
    ],
    ['placeholder to an unknown ingredient', { steps: [{ body: 'add {ing:ghost}' }] }],
    ['step video not in the recipe', { steps: [{ body: 'x', video_ref: 'nope' }] }],
    ['bad youtube id', { videos: [{ ref: 'v', youtube_id: 'short' }] }],
    ['unknown field', { colour: 'red' }],
    [
      '101 ingredients',
      {
        ingredients: Array.from({ length: 101 }, (_, n) => ({
          ref: `i${n}`,
          name: 'x',
          qty_kind: 'pinch',
        })),
      },
    ],
    ['61 steps', { steps: Array.from({ length: 61 }, () => ({ body: 'x' })) }],
    ['zero servings', { servings: 0 }],
    ['empty title', { title: '  ' }],
  ])('400 for %s', async (_name, patch) => {
    const res = await call('POST', '/recipes', MEMBER, { title: 'T', ...patch });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('a range whose bounds are equal is stored as exact', async () => {
    const r = await create(MEMBER, {
      title: 'T',
      ingredients: [
        { ref: 'a', name: 'x', qty_kind: 'range', amount_min: 2, amount_max: 2, unit_code: 'g' },
      ],
    });
    expect(r.ingredients[0]).toMatchObject({ qty_kind: 'exact', amount_min: 2, amount_max: 2 });
  });

  it('visibility book needs a book', async () => {
    const res = await call('POST', '/recipes', 8099, { title: 'T', visibility: 'book' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('NOT_IN_BOOK');
  });
});

describe('publishing and access (PRD 2.2 step 10, 3.3)', () => {
  it('refuses to publish without ingredients and steps, and lists what is missing', async () => {
    const r = await create(MEMBER, { title: 'Пусто' });
    const res = await publishToBook(MEMBER, r.id);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({
      code: 'NOT_PUBLISHABLE',
      details: { missing: ['ingredients', 'steps'] },
    });
    // nothing changed
    expect((await call('GET', `/recipes/${r.id}`, MEMBER)).json().status).toBe('draft');
  });

  it('a published book recipe is visible to book members only', async () => {
    const r = await create(MEMBER);
    expect((await call('GET', `/recipes/${r.id}`, KEEPER)).statusCode).toBe(404); // draft
    const pub = await publishToBook(MEMBER, r.id);
    expect(pub.statusCode, pub.body).toBe(200);
    expect(pub.json().published_at).toBeTruthy();
    const seen = await call('GET', `/recipes/${r.id}`, KEEPER);
    expect(seen.statusCode).toBe(200);
    expect(seen.json()).toMatchObject({ is_mine: false, can_edit: false, can_unpublish: true });
    expect(seen.json().share_token).toBeUndefined();
    expect(seen.json().ingredients).toHaveLength(6);
    expect((await call('GET', `/recipes/${r.id}`, OUTSIDER)).statusCode).toBe(404);
  });

  it('only the author edits or deletes; others get 403 (visible) or 404 (not visible)', async () => {
    const r = await create(MEMBER);
    await publishToBook(MEMBER, r.id);
    expect((await call('PATCH', `/recipes/${r.id}`, KEEPER, { title: 'Hacked' })).statusCode).toBe(
      403,
    );
    expect((await call('DELETE', `/recipes/${r.id}`, KEEPER)).statusCode).toBe(403);
    expect(
      (await call('PATCH', `/recipes/${r.id}`, OUTSIDER, { title: 'Hacked' })).statusCode,
    ).toBe(404);
    expect((await call('GET', `/recipes/${r.id}`, MEMBER)).json().title).toBe('Голубцы');
  });
});

describe('share link (D-023)', () => {
  it('a token appears when visibility becomes link, opens the recipe for anyone, and dies when it changes back', async () => {
    const r = await create(MEMBER);
    const shared = (
      await call('PATCH', `/recipes/${r.id}`, MEMBER, { status: 'published', visibility: 'link' })
    ).json();
    const token: string = shared.share_token;
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/); // 128 random bits
    expect(Buffer.from(token, 'base64url')).toHaveLength(16);

    const guest = await call('GET', `/r/${token}`, OUTSIDER);
    expect(guest.statusCode).toBe(200);
    expect(guest.json()).toMatchObject({
      id: r.id,
      author: { name: `User${MEMBER}` },
      is_mine: false,
    });
    expect(guest.json().share_token).toBeUndefined();

    const back = (await call('PATCH', `/recipes/${r.id}`, MEMBER, { visibility: 'book' })).json();
    expect(back.share_token).toBeNull();
    expect((await call('GET', `/r/${token}`, OUTSIDER)).statusCode).toBe(404);

    const again = (await call('PATCH', `/recipes/${r.id}`, MEMBER, { visibility: 'link' })).json();
    expect(again.share_token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(again.share_token).not.toBe(token); // the old link stays dead
  });

  it('a draft shared by link is not readable through its token', async () => {
    const r = await create(MEMBER, { title: 'T', visibility: 'link' });
    expect(r.share_token).toBeTruthy();
    expect((await call('GET', `/r/${r.share_token}`, OUTSIDER)).statusCode).toBe(404);
  });

  it('a malformed token is 400, an unknown one 404', async () => {
    expect((await call('GET', '/r/short', OUTSIDER)).statusCode).toBe(400);
    expect((await call('GET', `/r/${'A'.repeat(22)}`, OUTSIDER)).statusCode).toBe(404);
  });
});

describe('editing: versions and stable ids', () => {
  it('drafts do not bump the version; edits to a published recipe do; visibility alone does not', async () => {
    const r = await create(MEMBER);
    expect(
      (await call('PATCH', `/recipes/${r.id}`, MEMBER, { title: 'Draft 2' })).json().version,
    ).toBe(1);
    expect((await publishToBook(MEMBER, r.id)).json().version).toBe(1);
    expect(
      (await call('PATCH', `/recipes/${r.id}`, MEMBER, { title: 'Edited' })).json().version,
    ).toBe(2);
    expect(
      (await call('PATCH', `/recipes/${r.id}`, MEMBER, { title: 'Edited' })).json().version,
    ).toBe(2); // no change
    expect(
      (await call('PATCH', `/recipes/${r.id}`, MEMBER, { visibility: 'link' })).json().version,
    ).toBe(2);
    expect((await call('PATCH', `/recipes/${r.id}`, MEMBER, { servings: 6 })).json().version).toBe(
      3,
    );
  });

  it('replacing content keeps ids that are sent back, drops the rest, adds the new', async () => {
    const r = await create(MEMBER);
    const [farsh, eggs] = r.ingredients;
    const [s1] = r.steps;
    const res = await call('PATCH', `/recipes/${r.id}`, MEMBER, {
      ingredients: [
        {
          ref: farsh.id,
          id: farsh.id,
          name: 'фарш',
          qty_kind: 'exact',
          amount_min: 500,
          unit_code: 'g',
        },
        { ref: 'new', name: 'рис', qty_kind: 'exact', amount_min: 1, unit_code: 'cup' },
      ],
      videos: [],
      steps: [
        {
          id: s1.id,
          body: 'Добавьте {ing:new} к {ing:' + farsh.id + '}',
          ingredients: [{ ref: 'new' }, { ref: farsh.id }],
        },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    const u = res.json();
    expect(u.ingredients.map((i: { name: string }) => i.name)).toEqual(['фарш', 'рис']);
    expect(u.ingredients[0].id).toBe(farsh.id);
    expect(u.ingredients.some((i: { id: string }) => i.id === eggs.id)).toBe(false);
    expect(u.steps).toHaveLength(1);
    expect(u.steps[0].id).toBe(s1.id);
    expect(u.steps[0].body).toBe(`Добавьте {ing:${u.ingredients[1].id}} к {ing:${farsh.id}}`);
    expect(u.videos).toEqual([]);
  });

  it('ids from another recipe are rejected', async () => {
    const a = await create(MEMBER);
    const b = await create(MEMBER, { title: 'B' });
    const res = await call('PATCH', `/recipes/${b.id}`, MEMBER, {
      ingredients: [{ ref: 'x', id: a.ingredients[0].id, name: 'x', qty_kind: 'pinch' }],
      steps: [],
    });
    expect(res.statusCode).toBe(400);
  });

  it('ingredients and steps are replaced together', async () => {
    const r = await create(MEMBER);
    const res = await call('PATCH', `/recipes/${r.id}`, MEMBER, { ingredients: [] });
    expect(res.statusCode).toBe(400);
  });

  it('unpublishing back to draft is allowed; publishing an emptied recipe is not', async () => {
    const r = await create(MEMBER);
    await publishToBook(MEMBER, r.id);
    const res = await call('PATCH', `/recipes/${r.id}`, MEMBER, {
      ingredients: [],
      steps: [],
      videos: [],
    });
    expect(res.statusCode).toBe(409);
    expect((await call('GET', `/recipes/${r.id}`, MEMBER)).json().ingredients).toHaveLength(6); // rolled back
  });
});

describe('POST /recipes/:id/unpublish (keeper moderation) and DELETE', () => {
  it('the keeper unpublishes a member book recipe: private, link revoked, keeper loses access', async () => {
    const r = await create(MEMBER);
    await call('PATCH', `/recipes/${r.id}`, MEMBER, { status: 'published', visibility: 'link' });
    const res = await call('POST', `/recipes/${r.id}/unpublish`, KEEPER);
    expect(res.statusCode).toBe(204);
    expect((await call('GET', `/recipes/${r.id}`, KEEPER)).statusCode).toBe(404);
    const mine = (await call('GET', `/recipes/${r.id}`, MEMBER)).json();
    expect(mine).toMatchObject({ visibility: 'private', share_token: null, title: 'Голубцы' });
  });

  it("a member cannot unpublish someone else's recipe; the author can unpublish their own", async () => {
    const r = await create(KEEPER);
    await publishToBook(KEEPER, r.id);
    expect((await call('POST', `/recipes/${r.id}/unpublish`, MEMBER)).statusCode).toBe(403);
    expect((await call('POST', `/recipes/${r.id}/unpublish`, OUTSIDER)).statusCode).toBe(404);
    expect((await call('POST', `/recipes/${r.id}/unpublish`, KEEPER)).statusCode).toBe(204);
  });

  it('soft delete hides the recipe everywhere, including from its author', async () => {
    const r = await create(MEMBER);
    expect((await call('DELETE', `/recipes/${r.id}`, MEMBER)).statusCode).toBe(204);
    expect((await call('GET', `/recipes/${r.id}`, MEMBER)).statusCode).toBe(404);
    const row = (await admin.query('SELECT deleted_at FROM recipes WHERE id = $1', [r.id])).rows[0];
    expect(row.deleted_at).toBeTruthy();
  });
});

describe('GET /recipes (list with keyset pagination)', () => {
  it('book scope shows published book/link recipes of the book; mine shows all of my own', async () => {
    const pub = await create(MEMBER, fullRecipe({ title: 'Опубликован' }));
    await publishToBook(MEMBER, pub.id);
    await create(MEMBER, { title: 'Черновик' });
    const priv = await create(KEEPER, fullRecipe({ title: 'Личный' }));
    await call('PATCH', `/recipes/${priv.id}`, KEEPER, { status: 'published' }); // published but private
    const other = await create(OUTSIDER, fullRecipe({ title: 'Чужая книга' }));
    await publishToBook(OUTSIDER, other.id);

    const book = (await call('GET', '/recipes?scope=book', KEEPER)).json();
    expect(book.items.map((i: { title: string }) => i.title)).toEqual(['Опубликован']);
    expect(book.items[0]).toMatchObject({
      author: { name: `User${MEMBER}` },
      total_min: 120,
      ingredient_names: ['говяжий фарш', 'яйца', 'мука', 'сметана', 'лавровый лист', 'соль'],
      is_mine: false,
    });
    const mine = (await call('GET', '/recipes?scope=mine', MEMBER)).json();
    expect(mine.items.map((i: { title: string }) => i.title).sort()).toEqual([
      'Опубликован',
      'Черновик',
    ]);
  });

  it('pages through results with next_cursor and no duplicates', async () => {
    for (let n = 0; n < 5; n++) {
      const r = await create(MEMBER, fullRecipe({ title: `R${n}` }));
      await publishToBook(MEMBER, r.id);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = `/recipes?scope=book&limit=2${cursor ? `&cursor=${cursor}` : ''}`;
      const page = (await call('GET', url, KEEPER)).json();
      seen.push(...page.items.map((i: { title: string }) => i.title));
      cursor = page.next_cursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toEqual(['R4', 'R3', 'R2', 'R1', 'R0']);
  });

  it('rejects a bad cursor or limit; a user without a book gets an empty book list', async () => {
    expect((await call('GET', '/recipes?cursor=garbage', MEMBER)).statusCode).toBe(400);
    expect((await call('GET', '/recipes?limit=500', MEMBER)).statusCode).toBe(400);
    expect((await call('GET', '/recipes?scope=book', 8098)).json()).toEqual({
      items: [],
      next_cursor: null,
    });
  });
});

describe('PATCH /me (language sync)', () => {
  it('stores one of the four UI languages', async () => {
    const res = await call('PATCH', '/me', MEMBER, { ui_lang: 'sv' });
    expect(res.statusCode).toBe(200);
    expect(res.json().ui_lang).toBe('sv');
    expect((await call('GET', '/me', MEMBER)).json().ui_lang).toBe('sv');
  });

  it.each([['de'], ['RU'], [''], [null]])('rejects %j', async (ui_lang) => {
    expect((await call('PATCH', '/me', MEMBER, { ui_lang })).statusCode).toBe(400);
  });

  it('cannot change anything else', async () => {
    expect(
      (await call('PATCH', '/me', MEMBER, { ui_lang: 'en', bot_started: true })).statusCode,
    ).toBe(400);
  });
});
