import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/pool.js';
import { withUser } from '../src/db/tx.js';
import { importTimeout, type ImportParser } from '../src/import/parserPool.js';
import { renderMessage, type Lang } from '../src/notify/templates.js';
import { adminPool, insertUser, resetData, testApp, testPool } from './helpers/db.js';
import { TEST_BOT_TOKEN } from './helpers/signInitData.js';
import { caller, family, KEEPER, MEMBER } from './helpers/cooking.js';

/**
 * S6-2 (PRD 2.2 variant B, UC-02; owner's Sprint 6 answers and additions; D-054): a recipe text
 * forwarded (or written) to the bot becomes a private draft of the person who sent it, read by the
 * same parser as "Paste", and the bot answers with a button that opens "Check the recipe".
 * Forwarded text is untrusted: text only, capped, limited per person, time-limited parsing, and
 * only for people who already opened the app.
 */
const SECRET = 'webhook-secret-for-tests-0123456789abcdef';
const LINKS = { botUsername: 'family_cookbook_bot', appShortName: 'cook' };
const RECIPE = [
  'Сырники',
  '',
  'Ингредиенты:',
  'Творог — 500 г',
  'Яйца — 2 шт.',
  'Сахар — 2 ст. л.',
  '',
  'Приготовление:',
  '1. Смешайте творог с яйцами и сахаром.',
  '2. Обжаривайте по 3 минуты с каждой стороны.',
].join('\n');

let db: Db;
let admin: Db;
let app: FastifyInstance;
let call: ReturnType<typeof caller>;
let nextUpdate = 70_000;

const person = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  is_bot: false,
  first_name: 'Мама',
  language_code: 'ru',
  ...over,
});
/** A message in the person's private chat with the bot; forwarded unless said otherwise. */
function message(
  from: ReturnType<typeof person>,
  body: Record<string, unknown>,
  opts: { chatType?: string; forwarded?: boolean } = {},
) {
  return {
    update_id: nextUpdate++,
    message: {
      message_id: nextUpdate,
      date: 1_760_000_000,
      chat: {
        id: opts.chatType && opts.chatType !== 'private' ? -100123 : from.id,
        type: opts.chatType ?? 'private',
      },
      from,
      ...(opts.forwarded === false
        ? {}
        : {
            forward_origin: {
              type: 'hidden_user',
              sender_user_name: 'Бабушка',
              date: 1_759_000_000,
            },
          }),
      ...body,
    },
  };
}
const text = (tg: number, t: string, opts?: { chatType?: string; forwarded?: boolean }) =>
  message(person(tg), { text: t }, opts);
const deliver = (body: unknown, secret: string | null = SECRET, to = app) =>
  to.inject({
    method: 'POST',
    url: '/bot/webhook',
    headers: secret === null ? {} : { 'x-telegram-bot-api-secret-token': secret },
    payload: body as object,
  });

const userId = async (tg: number) =>
  (await admin.query<{ id: string }>('SELECT id FROM users WHERE tg_user_id = $1', [tg])).rows[0]
    ?.id;
const drafts = async () =>
  (
    await admin.query<{
      id: string;
      author_id: string;
      book_id: string | null;
      title: string;
      status: string;
      visibility: string;
      source_type: string;
      raw_text: string;
    }>(
      `SELECT id, author_id, book_id, title, status, visibility, source_type, raw_text
         FROM recipes WHERE source_type = 'bot_forward' ORDER BY created_at`,
    )
  ).rows;
const replies = async () =>
  (
    await admin.query<{
      recipient_user_id: string;
      payload: { kind: string; recipe_id?: string; title?: string };
      priority: number;
    }>(
      `SELECT recipient_user_id, payload, priority FROM notification_outbox
        WHERE type = 'bot_reply' ORDER BY created_at, id`,
    )
  ).rows;
const kinds = async () => (await replies()).map((r) => r.payload.kind);

beforeAll(async () => {
  db = testPool();
  admin = adminPool();
  app = await testApp(db, { env: { BOT_WEBHOOK_SECRET: SECRET } });
  call = caller(app);
});
afterAll(async () => {
  await app.close();
  await Promise.all([db.end(), admin.end()]);
});
beforeEach(async () => {
  await resetData(admin);
  await family(app); // KEEPER and MEMBER have opened the app
});

describe('a recipe forwarded to the bot', () => {
  it('becomes a private draft of the sender, read like "Paste", and the bot answers with "Check the recipe"', async () => {
    const r = await deliver(text(MEMBER, RECIPE));
    expect(r.statusCode, r.body).toBe(200);
    const [d, ...more] = await drafts();
    expect(more).toEqual([]);
    expect(d).toMatchObject({
      author_id: await userId(MEMBER),
      book_id: null,
      title: 'Сырники',
      status: 'draft',
      visibility: 'private',
      source_type: 'bot_forward',
      raw_text: RECIPE,
    });
    // The same parser as "Paste": ingredients, steps and the timer it found.
    const recipe = (await call('GET', `/recipes/${d!.id}`, MEMBER)).json();
    expect(recipe.ingredients.map((i: { name: string }) => i.name)).toEqual([
      'Творог',
      'Яйца',
      'Сахар',
    ]);
    expect(recipe.steps).toHaveLength(2);
    expect(recipe.steps[1].timers).toEqual([expect.objectContaining({ duration_sec: 180 })]);
    expect(await replies()).toEqual([
      {
        recipient_user_id: await userId(MEMBER),
        payload: { kind: 'draft_saved', recipe_id: d!.id, title: 'Сырники' },
        priority: 0,
      },
    ]);
  });

  it('text written to the bot (not forwarded) works the same way', async () => {
    await deliver(text(MEMBER, RECIPE, { forwarded: false }));
    expect(await drafts()).toHaveLength(1);
  });

  it('the draft is private: nobody else sees it, not even the book’s keeper', async () => {
    await deliver(text(MEMBER, RECIPE));
    const [d] = await drafts();
    expect((await call('GET', `/recipes/${d!.id}`, KEEPER)).statusCode).toBe(404);
    const book = (await call('GET', '/recipes?scope=book&limit=50', KEEPER)).json();
    expect(book.items.map((i: { id: string }) => i.id)).not.toContain(d!.id);
    const mine = (await call('GET', '/recipes?scope=mine&limit=50', MEMBER)).json();
    expect(mine.items.map((i: { id: string }) => i.id)).toContain(d!.id);
  });

  it('"Check the recipe" gets what the review needs: the original text, warnings and reasons', async () => {
    await deliver(text(MEMBER, `${RECIPE}\nСоль`));
    const [d] = await drafts();
    const notes = await call('GET', `/recipes/${d!.id}/import`, MEMBER);
    expect(notes.statusCode, notes.body).toBe(200);
    const recipe = (await call('GET', `/recipes/${d!.id}`, MEMBER)).json();
    expect(notes.json()).toEqual({
      original: `${RECIPE}\nСоль`,
      warnings: expect.any(Array),
      reasons: Object.fromEntries(
        recipe.ingredients.map((i: { id: string }) => [i.id, expect.any(Array)]),
      ),
    });
    // Only for the author, and only while the draft is as the bot made it.
    expect((await call('GET', `/recipes/${d!.id}/import`, KEEPER)).statusCode).toBe(404);
    await call('PATCH', `/recipes/${d!.id}`, MEMBER, { title: 'Сырники мамины' });
    expect((await call('GET', `/recipes/${d!.id}/import`, MEMBER)).statusCode).toBe(404);
  });

  it('the same text again: no second draft; the bot points to the one it made', async () => {
    await deliver(text(MEMBER, RECIPE));
    await deliver(text(MEMBER, RECIPE));
    const all = await drafts();
    expect(all).toHaveLength(1);
    expect((await replies()).map((r) => r.payload)).toEqual([
      { kind: 'draft_saved', recipe_id: all[0]!.id, title: 'Сырники' },
      { kind: 'draft_exists', recipe_id: all[0]!.id, title: 'Сырники' },
    ]);
  });

  it('the same update delivered twice, also at the same moment, makes one draft and one answer', async () => {
    const u = text(MEMBER, RECIPE);
    await Promise.all([deliver(u), deliver(u), deliver(u)]);
    expect(await drafts()).toHaveLength(1);
    expect(await kinds()).toEqual(['draft_saved']);
  });

  it('a draft from paste is also reviewable from another device (the same notes)', async () => {
    const r = await call('POST', '/recipes/import', MEMBER, { text: RECIPE, ui_lang: 'ru' });
    const notes = await call('GET', `/recipes/${r.json().recipe.id}/import`, MEMBER);
    expect(notes.statusCode).toBe(200);
    expect(notes.json().original).toBe(RECIPE);
  });
});

describe('forwarded text is untrusted input', () => {
  it('only from people who already opened the app: a stranger gets nothing, and nothing is stored', async () => {
    const r = await deliver(text(7777, RECIPE));
    expect(r.statusCode).toBe(200);
    expect(await userId(7777)).toBeUndefined();
    expect(await drafts()).toEqual([]);
    expect(await replies()).toEqual([]);
  });

  it('someone who only pressed /start (never opened the app) is asked to open it first; no draft', async () => {
    await deliver(text(7778, '/start'));
    await deliver(text(7778, RECIPE));
    expect(await drafts()).toEqual([]);
    expect(await kinds()).toEqual(['open_app_first']);
    // Once they open the app, forwarding works.
    await call('GET', '/me', 7778);
    await deliver(text(7778, RECIPE));
    expect(await drafts()).toHaveLength(1);
  });

  it('a person added without opening the app (e.g. by an import) is not trusted either', async () => {
    await insertUser(admin, 7779);
    await deliver(text(7779, RECIPE));
    expect(await drafts()).toEqual([]);
    expect(await kinds()).toEqual(['open_app_first']);
  });

  it.each([
    ['a photo with a caption', { photo: [{ file_id: 'x', width: 1, height: 1 }], caption: RECIPE }],
    ['a document', { document: { file_id: 'x' }, caption: RECIPE }],
    ['a sticker', { sticker: { file_id: 'x' } }],
    ['only spaces', { text: '   \n  ' }],
  ])('%s: only text is read; the bot says it can see no text', async (_why, body) => {
    await deliver(message(person(MEMBER), body));
    expect(await drafts()).toEqual([]);
    expect(await kinds()).toEqual(['no_text']);
  });

  it('a text longer than Telegram allows (4096) is refused without reading it', async () => {
    await deliver(text(MEMBER, `${RECIPE}\n${'а'.repeat(5000)}`));
    expect(await drafts()).toEqual([]);
    expect(await kinds()).toEqual(['too_long']);
  });

  it.each([
    ['a group chat', { chatType: 'group' }],
    ['a channel post forwarded into a group', { chatType: 'supergroup' }],
  ])('%s is ignored', async (_why, opts) => {
    await deliver(text(MEMBER, RECIPE, opts));
    expect(await drafts()).toEqual([]);
    expect(await replies()).toEqual([]);
  });

  it('other commands (/help, /settings) are not recipes: ignored', async () => {
    await deliver(text(MEMBER, '/help', { forwarded: false }));
    await deliver(text(MEMBER, '  /settings please', { forwarded: false }));
    expect(await drafts()).toEqual([]);
    expect(await replies()).toEqual([]);
  });

  it('another bot is ignored', async () => {
    await deliver(message(person(MEMBER, { is_bot: true }), { text: RECIPE }));
    expect(await drafts()).toEqual([]);
  });

  it('at most 30 forwarded recipes an hour per person; then one "too many" answer an hour', async () => {
    for (let i = 0; i < 30; i++) await deliver(text(MEMBER, `${RECIPE}\n${i}`));
    expect(await drafts()).toHaveLength(30);
    await deliver(text(MEMBER, `${RECIPE}\nещё`));
    await deliver(text(MEMBER, `${RECIPE}\nи ещё`));
    expect(await drafts()).toHaveLength(30);
    const k = await kinds();
    expect(k.filter((x) => x === 'draft_saved')).toHaveLength(30);
    expect(k.filter((x) => x === 'too_many')).toHaveLength(1);
    // Another person is not affected.
    await deliver(text(KEEPER, RECIPE));
    expect(await drafts()).toHaveLength(31);
  }, 60_000);

  it('deleted drafts still count (deleting does not reopen the limit)', async () => {
    await admin.query(
      `INSERT INTO recipes (author_id, title, status, visibility, servings, language, source_type, deleted_at)
       SELECT $1, 'x', 'draft', 'private', 4, 'ru', 'bot_forward', now() FROM generate_series(1, 30)`,
      [await userId(MEMBER)],
    );
    await deliver(text(MEMBER, RECIPE));
    expect(await kinds()).toEqual(['too_many']);
  });

  it('the parser has the same time limit as "Paste": too slow, no draft, and the bot says so', async () => {
    const slow: ImportParser = {
      parse: () => Promise.reject(importTimeout()),
      close: async () => undefined,
    };
    const timed = await testApp(db, { env: { BOT_WEBHOOK_SECRET: SECRET }, importParser: slow });
    try {
      const r = await deliver(text(MEMBER, RECIPE), SECRET, timed);
      expect(r.statusCode).toBe(200);
    } finally {
      await timed.close();
    }
    expect(await drafts()).toEqual([]);
    expect(await kinds()).toEqual(['not_read']);
  });
});

describe('the webhook secret (owner’s Sprint 6 addition)', () => {
  it.each([
    ['without the secret header', null],
    ['with a wrong secret', `${SECRET.slice(0, -1)}X`],
  ])('a forwarded recipe %s is refused (401) and nothing is stored', async (_why, secret) => {
    const r = await deliver(text(MEMBER, RECIPE), secret);
    expect(r.statusCode).toBe(401);
    expect(await drafts()).toEqual([]);
    expect(await replies()).toEqual([]);
    expect((await admin.query('SELECT 1 FROM tg_updates')).rowCount).toBe(0);
  });

  it('every call is checked: a right secret once does not open the door for the next call', async () => {
    expect((await deliver(text(MEMBER, RECIPE))).statusCode).toBe(200);
    expect((await deliver(text(MEMBER, `${RECIPE}\n2`), null)).statusCode).toBe(401);
    expect(await drafts()).toHaveLength(1);
  });

  it('neither the secret nor the bot token ever reaches the log', async () => {
    const lines: string[] = [];
    const logged = await testApp(db, {
      env: { BOT_WEBHOOK_SECRET: SECRET, LOG_LEVEL: 'trace' },
      logStream: { write: (l: string) => void lines.push(l) },
    });
    try {
      await deliver(text(MEMBER, RECIPE), SECRET, logged);
      await deliver(text(MEMBER, RECIPE), 'wrong-secret', logged);
      await deliver(text(MEMBER, RECIPE), null, logged);
      await deliver({ not: 'an update' }, SECRET, logged);
    } finally {
      await logged.close();
    }
    const all = lines.join('\n');
    expect(all.length).toBeGreaterThan(0);
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain('wrong-secret');
    expect(all).not.toContain('x-telegram-bot-api-secret-token');
    // The bot token (it signs sign-in data) is not logged either, not even its secret part.
    expect(all).not.toContain(TEST_BOT_TOKEN.split(':')[1]);
  });
});

describe('the bot’s answers', () => {
  const langs: Lang[] = ['ru', 'uk', 'en', 'sv'];
  const ID = '0a1b2c3d-0000-4000-8000-00000000abcd';
  it.each(langs)(
    'are written in the person’s language (%s), escaped, with the right button',
    (lang) => {
      const saved = renderMessage(
        'bot_reply',
        { kind: 'draft_saved', recipe_id: ID, title: 'Пирог <с вишней>' },
        lang,
        LINKS,
      )!;
      expect(saved.text).toContain('Пирог &lt;с вишней&gt;');
      expect(saved.reply_markup.inline_keyboard[0]![0]!.url).toBe(
        'https://t.me/family_cookbook_bot/cook?startapp=draft_0a1b2c3d00004000800000000000abcd',
      );
      const exists = renderMessage(
        'bot_reply',
        { kind: 'draft_exists', recipe_id: ID, title: 'x' },
        lang,
        LINKS,
      )!;
      expect(exists.text).not.toBe(saved.text);
      for (const kind of ['no_text', 'too_long', 'too_many', 'not_read', 'open_app_first']) {
        const r = renderMessage('bot_reply', { kind }, lang, LINKS)!;
        expect(r.text.length, kind).toBeGreaterThan(10);
        expect(r.reply_markup.inline_keyboard[0]![0]!.url).toBe(
          'https://t.me/family_cookbook_bot/cook',
        );
      }
      expect(renderMessage('bot_reply', { kind: 'unknown' }, lang, LINKS)).toBeNull();
    },
  );

  it('are sent by the worker like every message (the app cannot write one itself)', async () => {
    await expect(
      withUser(db, { userId: (await userId(MEMBER))! }, (tx) =>
        tx.query(
          `INSERT INTO notification_outbox (type, recipient_user_id, payload, dedupe_key)
           VALUES ('bot_reply', app_user_id(), '{"kind":"no_text"}', 'reply:fake')`,
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
