import { startFakeTelegram, type FakeTelegram } from '@cookbook/fakebot';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/pool.js';
import { withUser } from '../src/db/tx.js';
import { sendDueMessages } from '../src/notify/outbox.js';
import { createTelegramClient } from '../src/notify/telegram.js';
import { renderMessage, type Lang } from '../src/notify/templates.js';
import { adminPool, resetData, testApp, testPool } from './helpers/db.js';
import { caller, family, KEEPER, MEMBER, OUTSIDER } from './helpers/cooking.js';

/**
 * Notification settings and the new-recipe message (PRD 3.2 notify_prefs, 4.4 new_recipe; D-049).
 * Owner's Sprint 5 answers: "someone cooked my recipe" is on by default, with a quiet mode;
 * "a new recipe in the book" is off by default, with a switch in the Profile.
 */
let db: Db;
let admin: Db;
let app: FastifyInstance;
let call: ReturnType<typeof caller>;
const SECOND_MEMBER = 9104;
const LINKS = { botUsername: 'family_cookbook_bot', appShortName: 'cook' };
const DEFAULTS = { timers: true, cooked: true, new_recipe: false, mute_social: false };

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
  await family(app);
  const book = (await call('GET', '/books/current', KEEPER)).json();
  await call('POST', '/books/join', SECOND_MEMBER, { invite_code: book.invite_code });
});

const prefs = (tg: number, notify_prefs: object) => call('PATCH', '/me', tg, { notify_prefs });
const userId = async (tg: number) =>
  (await admin.query<{ id: string }>('SELECT id FROM users WHERE tg_user_id = $1', [tg])).rows[0]!
    .id;
const outbox = async (type = 'new_recipe') =>
  (
    await admin.query<{
      recipient_user_id: string;
      payload: Record<string, unknown>;
      dedupe_key: string;
      delay_sec: number;
    }>(
      `SELECT recipient_user_id, payload, dedupe_key,
              round(extract(epoch FROM run_at - created_at))::int AS delay_sec
         FROM notification_outbox WHERE type = $1 AND status = 'pending' ORDER BY created_at`,
      [type],
    )
  ).rows;
const publish = async (tg: number, over: object = {}) => {
  const r = await call('POST', '/recipes', tg, {
    title: 'Борщ',
    servings: 4,
    language: 'ru',
    status: 'published',
    visibility: 'book',
    ingredients: [{ ref: 'a', name: 'свёкла', qty_kind: 'exact', amount_min: 300, unit_code: 'g' }],
    steps: [{ body: 'Варите.' }],
    ...over,
  });
  expect(r.statusCode, r.body).toBe(201);
  return r;
};

describe('the settings (GET / PATCH /me)', () => {
  it('a new person: timers and "cooked" on, "new recipe" off, quiet mode off', async () => {
    expect((await call('GET', '/me', MEMBER)).json().notify_prefs).toEqual(DEFAULTS);
  });

  it('changes only what is sent, and keeps it', async () => {
    const r = await prefs(MEMBER, { new_recipe: true });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().notify_prefs).toEqual({ ...DEFAULTS, new_recipe: true });
    await prefs(MEMBER, { mute_social: true });
    expect((await call('GET', '/me', MEMBER)).json().notify_prefs).toEqual({
      ...DEFAULTS,
      new_recipe: true,
      mute_social: true,
    });
    // The language and the settings can change together.
    const both = await call('PATCH', '/me', MEMBER, {
      ui_lang: 'sv',
      notify_prefs: { cooked: false },
    });
    expect(both.json()).toMatchObject({ ui_lang: 'sv', notify_prefs: { cooked: false } });
  });

  it.each([
    [{ notify_prefs: { spam: true } }],
    [{ notify_prefs: { cooked: 'yes' } }],
    [{ notify_prefs: {} }],
    [{}],
  ])('refuses %j (400)', async (body) => {
    expect((await call('PATCH', '/me', MEMBER, body)).statusCode).toBe(400);
  });

  it('only your own settings (the app cannot set someone else’s)', async () => {
    await withUser(db, { userId: await userId(MEMBER) }, (tx) =>
      tx.query(`SELECT update_notify_prefs('{"new_recipe": true}'::jsonb)`),
    );
    expect((await call('GET', '/me', KEEPER)).json().notify_prefs.new_recipe).toBe(false);
    expect((await call('GET', '/me', MEMBER)).json().notify_prefs.new_recipe).toBe(true);
  });
});

describe('a new recipe in the book (new_recipe)', () => {
  it('off by default: nobody gets a message', async () => {
    await publish(KEEPER);
    expect(await outbox()).toEqual([]);
  });

  it('to the members who turned it on, not the author, not in quiet mode, a few minutes later', async () => {
    await prefs(MEMBER, { new_recipe: true });
    await prefs(SECOND_MEMBER, { new_recipe: true, mute_social: true });
    await prefs(KEEPER, { new_recipe: true });
    await prefs(OUTSIDER, { new_recipe: true });
    const r = (await publish(KEEPER, { title: 'Пирог <с вишней>' })).json();
    expect(await outbox()).toEqual([
      {
        recipient_user_id: await userId(MEMBER),
        dedupe_key: `new:${r.id}:${await userId(MEMBER)}`,
        payload: { recipe_id: r.id, recipe_title: 'Пирог <с вишней>', author_name: 'User9101' },
        delay_sec: 300,
      },
    ]);
  });

  it('only when the recipe reaches the book: a draft or a private recipe waits; once each', async () => {
    await prefs(MEMBER, { new_recipe: true });
    const draft = (await publish(KEEPER, { status: 'draft' })).json();
    const own = (await publish(KEEPER, { visibility: 'private' })).json();
    expect(await outbox()).toEqual([]);
    await call('PATCH', `/recipes/${draft.id}`, KEEPER, { status: 'published' });
    await call('PATCH', `/recipes/${own.id}`, KEEPER, { visibility: 'book' });
    expect((await outbox()).map((m) => m.payload.recipe_id).sort()).toEqual(
      [draft.id, own.id].sort(),
    );
    // Editing a published recipe sends nothing more.
    await call('PATCH', `/recipes/${draft.id}`, KEEPER, { title: 'Борщ украинский' });
    expect(await outbox()).toHaveLength(2);
  });

  it('a recipe taken back or deleted before the message goes: the message is dropped', async () => {
    await prefs(MEMBER, { new_recipe: true });
    const a = (await publish(KEEPER)).json();
    const b = (await publish(KEEPER, { title: 'Щи' })).json();
    await call('POST', `/recipes/${a.id}/unpublish`, KEEPER);
    await call('DELETE', `/recipes/${b.id}`, KEEPER);
    expect(await outbox()).toEqual([]);
  });

  it('the app cannot write such a message itself', async () => {
    await expect(
      withUser(db, { userId: await userId(KEEPER) }, async (tx) =>
        tx.query(
          `INSERT INTO notification_outbox (type, recipient_user_id, payload, dedupe_key)
           VALUES ('new_recipe', $1, '{}', 'new:fake')`,
          [await userId(MEMBER)],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  const langs: Lang[] = ['ru', 'uk', 'en', 'sv'];
  it.each(langs)(
    'is written in the member’s language (%s), escaped, with "Open the recipe"',
    (lang) => {
      const p = {
        recipe_id: '0a1b2c3d-0000-4000-8000-00000000abcd',
        recipe_title: 'Пирог <с вишней>',
        author_name: 'Лена & Co',
      };
      const r = renderMessage('new_recipe', p, lang, LINKS)!;
      expect(r.text).toContain('Лена &amp; Co');
      expect(r.text).toContain('Пирог &lt;с вишней&gt;');
      expect(r.reply_markup.inline_keyboard[0]![0]!.url).toBe(
        'https://t.me/family_cookbook_bot/cook?startapp=rc_0a1b2c3d00004000800000000000abcd',
      );
      const many = renderMessage('new_recipe', { ...p, collapsed: 5 }, lang, LINKS)!;
      expect(many.text).toContain('5');
      expect(many.text).not.toContain('Пирог');
      expect(many.reply_markup.inline_keyboard[0]![0]!.url).toBe(
        'https://t.me/family_cookbook_bot/cook',
      );
    },
  );

  describe('sent by the worker: more than 3 at once become one message (PRD 4.4)', () => {
    const TOKEN = '123456:notify-prefs-test-token';
    let bot: FakeTelegram;
    beforeAll(async () => {
      bot = await startFakeTelegram({ token: TOKEN });
    });
    afterAll(() => bot.close());
    beforeEach(() => bot.clear());
    const send = () =>
      sendDueMessages(
        db,
        createTelegramClient({ baseUrl: bot.url, token: TOKEN, allowLocal: true }),
        {
          links: LINKS,
          chatIntervalMs: 0,
          globalIntervalMs: 0,
        },
      );
    const publishMany = async (n: number) => {
      await prefs(MEMBER, { new_recipe: true });
      for (let i = 0; i < n; i++) await publish(KEEPER, { title: `Рецепт ${i + 1}` });
      await admin.query(
        `UPDATE notification_outbox SET run_at = created_at WHERE type = 'new_recipe'`,
      );
    };

    it('three: three messages', async () => {
      await publishMany(3);
      await send();
      expect(bot.messages.map((m) => m.plain)).toEqual([
        expect.stringContaining('Рецепт 1'),
        expect.stringContaining('Рецепт 2'),
        expect.stringContaining('Рецепт 3'),
      ]);
    });

    it('four: one message "4 new recipes", and all four are done', async () => {
      await publishMany(4);
      await send();
      expect(bot.messages).toHaveLength(1);
      expect(bot.messages[0]!.plain).toContain('4');
      const left = await admin.query(
        `SELECT count(*)::int AS n FROM notification_outbox WHERE type = 'new_recipe' AND status <> 'sent'`,
      );
      expect(left.rows[0].n).toBe(0);
      await send();
      expect(bot.messages).toHaveLength(1);
    });
  });
});

describe('the old default is changed for people who never chose (migration 0010)', () => {
  it('"new recipe" becomes off; other settings stay', async () => {
    const r = await admin.query<{ d: string }>(
      `SELECT column_default AS d FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'notify_prefs'`,
    );
    expect(JSON.parse(r.rows[0]!.d.replace(/^'|'::jsonb$/g, ''))).toEqual(DEFAULTS);
  });
});
