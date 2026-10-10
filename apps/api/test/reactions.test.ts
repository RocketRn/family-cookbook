import { startFakeTelegram, type FakeTelegram } from '@cookbook/fakebot';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/pool.js';
import { withUser } from '../src/db/tx.js';
import { cleanupOrphanMedia } from '../src/media/cleanup.js';
import { sendDueMessages } from '../src/notify/outbox.js';
import { createTelegramClient } from '../src/notify/telegram.js';
import { renderMessage, type Lang } from '../src/notify/templates.js';
import { MemoryStorage } from '../src/storage/storage.js';
import { adminPool, authHeader, resetData, testApp, testPool } from './helpers/db.js';
import { caller, family, KEEPER, MEMBER, OUTSIDER, type Family } from './helpers/cooking.js';
import { multipart, png } from './helpers/images.js';

/**
 * BE-10 (PRD 2.4 steps 12-14, 3.2 reactions, 4.4 recipe_cooked; D-048): reactions on a recipe and
 * "👨‍🍳 I cooked it" with an optional photo and words for the author, who gets one bot message
 * (none for their own recipe). Owner's Sprint 5 answers: a recipe can be marked cooked many times
 * ("cooked N times"); the message to the author is on by default, quiet mode turns it off.
 */
let db: Db;
let admin: Db;
let app: FastifyInstance;
let storage: MemoryStorage;
let call: ReturnType<typeof caller>;
let fam: Family;
const SECOND_MEMBER = 9104;
const LINKS = { botUsername: 'family_cookbook_bot', appShortName: 'cook' };

beforeAll(async () => {
  db = testPool();
  admin = adminPool();
  storage = new MemoryStorage();
  app = await testApp(db, { storage });
  call = caller(app);
});
afterAll(async () => {
  await app.close();
  await Promise.all([db.end(), admin.end()]);
});
beforeEach(async () => {
  await resetData(admin);
  storage.objects.clear();
  fam = await family(app);
  const book = (await call('GET', '/books/current', KEEPER)).json();
  await call('POST', '/books/join', SECOND_MEMBER, { invite_code: book.invite_code });
});

const react = (tg: number, body: object, recipeId = fam.bookRecipeId, query = '') =>
  call('POST', `/recipes/${recipeId}/reactions${query}`, tg, body);
const summary = (tg: number, recipeId = fam.bookRecipeId, query = '') =>
  call('GET', `/recipes/${recipeId}/reactions${query}`, tg);
const uploadPhoto = async (tg: number): Promise<string> => {
  const m = multipart(await png());
  const res = await app.inject({
    method: 'POST',
    url: '/media',
    headers: { ...authHeader(tg), ...m.headers },
    payload: m.payload,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id;
};
const outbox = async () =>
  (
    await admin.query<{
      type: string;
      recipient_user_id: string;
      payload: Record<string, unknown>;
      dedupe_key: string;
    }>(
      'SELECT type, recipient_user_id, payload, dedupe_key FROM notification_outbox ORDER BY created_at',
    )
  ).rows;
const userId = async (tg: number) =>
  (await admin.query<{ id: string }>('SELECT id FROM users WHERE tg_user_id = $1', [tg])).rows[0]!
    .id;

describe('emotions and "I’ll cook it again" (one each, tapping again removes)', () => {
  it('a member reacts; the same reaction again is the same one', async () => {
    const first = await react(MEMBER, { kind: 'heart' });
    expect(first.statusCode, first.body).toBe(201);
    const id = first.json().reaction.id;
    const again = await react(MEMBER, { kind: 'heart' });
    expect(again.statusCode).toBe(200);
    expect(again.json().reaction.id).toBe(id);
    await react(SECOND_MEMBER, { kind: 'heart' });
    await react(MEMBER, { kind: 'cook_again' });
    const s = (await summary(MEMBER)).json();
    expect(s.counts).toEqual({
      heart: 2,
      yum: 0,
      fire: 0,
      idea: 0,
      curious: 0,
      cook_again: 1,
      cooked: 0,
    });
    expect(s.mine).toMatchObject({
      heart: id,
      yum: null,
      cook_again: expect.any(String),
      cooked: 0,
    });
    expect(again.json().summary).toBeDefined();
  });

  it('removing: only your own (someone else’s answers 404, like a missing one)', async () => {
    const id = (await react(MEMBER, { kind: 'yum' })).json().reaction.id;
    expect((await call('DELETE', `/reactions/${id}`, SECOND_MEMBER)).statusCode).toBe(404);
    expect((await call('DELETE', `/reactions/${id}`, KEEPER)).statusCode).toBe(404);
    expect((await call('DELETE', `/reactions/${id}`, MEMBER)).statusCode).toBe(204);
    expect((await call('DELETE', `/reactions/${id}`, MEMBER)).statusCode).toBe(404);
    expect((await summary(MEMBER)).json().counts.yum).toBe(0);
  });

  it('only on a recipe you may read: someone outside the book gets 404', async () => {
    expect((await react(OUTSIDER, { kind: 'heart' })).statusCode).toBe(404);
    expect((await summary(OUTSIDER)).statusCode).toBe(404);
    expect((await react(MEMBER, { kind: 'heart' }, fam.outsiderRecipeId)).statusCode).toBe(404);
    expect((await react(MEMBER, { kind: 'heart' }, randomUUID())).statusCode).toBe(404);
  });

  it('someone with the recipe’s link sees the counts but may not react (owner’s Sprint 6 answer 2)', async () => {
    await react(MEMBER, { kind: 'fire' });
    const r = (
      await call('PATCH', `/recipes/${fam.bookRecipeId}`, KEEPER, { visibility: 'link' })
    ).json();
    const q = `?share_token=${r.share_token}`;
    expect((await react(OUTSIDER, { kind: 'fire' }, fam.bookRecipeId, q)).statusCode).toBe(404);
    expect((await summary(OUTSIDER, fam.bookRecipeId, q)).json().counts.fire).toBe(1);
    expect(
      (await summary(OUTSIDER, fam.bookRecipeId, '?share_token=wrongwrongwrongwrong')).statusCode,
    ).toBe(404);
  });

  it.each([
    [{ kind: 'dislike' }],
    [{ kind: 'my_version' }], // hidden until stage 2 (owner, Sprint 4)
    [{ kind: 'heart', note: 'words are for "I cooked it"' }],
    [{ kind: 'yum', photo_media_id: randomUUID() }],
    [{}],
  ])('refuses %j (400)', async (body) => {
    expect((await react(MEMBER, body)).statusCode).toBe(400);
  });
});

describe('"I cooked it"', () => {
  it('can be marked many times, with or without a photo and words: "cooked N times"', async () => {
    const photo = await uploadPhoto(MEMBER);
    const a = await react(MEMBER, {
      kind: 'cooked',
      note: 'Чуть пересолила, но вкусно!',
      photo_media_id: photo,
    });
    expect(a.statusCode, a.body).toBe(201);
    expect(a.json().reaction).toMatchObject({
      kind: 'cooked',
      note: 'Чуть пересолила, но вкусно!',
      photo: { url: expect.stringContaining(`media/${photo}/full.jpg`) },
    });
    const b = await react(MEMBER, { kind: 'cooked' });
    expect(b.statusCode).toBe(201);
    expect(b.json().reaction.id).not.toBe(a.json().reaction.id);
    await react(SECOND_MEMBER, { kind: 'cooked' });
    const s = (await summary(MEMBER)).json();
    expect(s.counts.cooked).toBe(3);
    expect(s.mine.cooked).toBe(2);
  });

  it('the words: up to 500 characters, trimmed; empty words are none', async () => {
    expect((await react(MEMBER, { kind: 'cooked', note: 'я'.repeat(500) })).statusCode).toBe(201);
    expect((await react(MEMBER, { kind: 'cooked', note: 'я'.repeat(501) })).statusCode).toBe(400);
    const r = await react(MEMBER, { kind: 'cooked', note: '   ' });
    expect(r.json().reaction.note).toBeNull();
  });

  it('only your own photo and your own cooking session', async () => {
    const theirs = await uploadPhoto(SECOND_MEMBER);
    expect((await react(MEMBER, { kind: 'cooked', photo_media_id: theirs })).statusCode).toBe(400);
    const session = (
      await call('POST', '/cook-sessions', SECOND_MEMBER, {
        recipe_id: fam.bookRecipeId,
        recipe_version: 1,
      })
    ).json();
    expect((await react(MEMBER, { kind: 'cooked', cook_session_id: session.id })).statusCode).toBe(
      400,
    );
    expect(
      (await react(SECOND_MEMBER, { kind: 'cooked', cook_session_id: session.id })).statusCode,
    ).toBe(201);
  });

  it('who sees the photos and words: the author all of them, each cook only their own', async () => {
    const photo = await uploadPhoto(MEMBER);
    await react(MEMBER, { kind: 'cooked', note: 'Для автора', photo_media_id: photo });
    await react(SECOND_MEMBER, { kind: 'cooked', note: 'Тоже для автора' });
    const forAuthor = (await summary(KEEPER)).json().cooked;
    expect(forAuthor).toHaveLength(2);
    expect(forAuthor.map((c: { note: string }) => c.note).sort()).toEqual([
      'Для автора',
      'Тоже для автора',
    ]);
    expect(forAuthor.find((c: { note: string }) => c.note === 'Для автора')).toMatchObject({
      cook_name: 'User9102',
      photo: { url: expect.stringContaining(photo) },
      mine: false,
    });
    const forMember = (await summary(MEMBER)).json().cooked;
    expect(forMember).toEqual([expect.objectContaining({ note: 'Для автора', mine: true })]);
    // The database says the same, whatever the API does.
    const seen = await withUser(db, { userId: await userId(SECOND_MEMBER) }, (tx) =>
      tx.query<{ note: string }>('SELECT note FROM reactions'),
    );
    expect(seen.rows.map((r) => r.note)).toEqual(['Тоже для автора']);
  });

  it('a used photo is kept by the clean-up; once the mark is removed it goes', async () => {
    const photo = await uploadPhoto(MEMBER);
    const id = (await react(MEMBER, { kind: 'cooked', photo_media_id: photo })).json().reaction.id;
    await admin.query(`UPDATE media SET created_at = now() - interval '2 days'`);
    expect(await cleanupOrphanMedia(db, storage)).toBe(0);
    await call('DELETE', `/reactions/${id}`, MEMBER);
    expect(await cleanupOrphanMedia(db, storage)).toBe(1);
  });
});

describe('the message to the author (recipe_cooked)', () => {
  it('one message per mark, to the author, with what the bot needs', async () => {
    const photo = await uploadPhoto(MEMBER);
    const id = (
      await react(MEMBER, { kind: 'cooked', note: 'Очень вкусно', photo_media_id: photo })
    ).json().reaction.id;
    expect(await outbox()).toEqual([
      {
        type: 'recipe_cooked',
        recipient_user_id: await userId(KEEPER),
        dedupe_key: `cooked:${id}`,
        payload: {
          reaction_id: id,
          recipe_id: fam.bookRecipeId,
          recipe_title: 'Голубцы',
          cook_name: 'User9102',
          note: 'Очень вкусно',
          photo_key: `media/${photo}`,
        },
      },
    ]);
    await react(MEMBER, { kind: 'cooked' });
    expect(await outbox()).toHaveLength(2);
  });

  it('none for your own recipe, for emotions, or when the author turned it off', async () => {
    await react(KEEPER, { kind: 'cooked', note: 'Сама приготовила' });
    await react(MEMBER, { kind: 'heart' });
    await react(MEMBER, { kind: 'cook_again' });
    expect(await outbox()).toEqual([]);
    for (const prefs of [{ cooked: false }, { mute_social: true }]) {
      await admin.query('UPDATE users SET notify_prefs = $2 WHERE tg_user_id = $1', [
        KEEPER,
        prefs,
      ]);
      await react(MEMBER, { kind: 'cooked' });
    }
    expect(await outbox()).toEqual([]);
    await admin.query(`UPDATE users SET notify_prefs = '{"cooked": true}' WHERE tg_user_id = $1`, [
      KEEPER,
    ]);
    await react(MEMBER, { kind: 'cooked' });
    expect(await outbox()).toHaveLength(1);
  });

  it('the app cannot write such a message itself (only the database does, with the mark)', async () => {
    await expect(
      withUser(db, { userId: await userId(MEMBER) }, async (tx) =>
        tx.query(
          `INSERT INTO notification_outbox (type, recipient_user_id, payload, dedupe_key)
           VALUES ('recipe_cooked', $1, '{}', 'cooked:fake')`,
          [await userId(KEEPER)],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  const langs: Lang[] = ['ru', 'uk', 'en', 'sv'];
  const payload = {
    reaction_id: randomUUID(),
    recipe_id: '0a1b2c3d-0000-4000-8000-00000000abcd',
    recipe_title: 'Пирог <с вишней> & сливками',
    cook_name: 'Лена <b>',
    note: 'Тесто «как пух» & <i>сочно</i>',
    photo_key: 'media/x',
  };

  it.each(langs)(
    'is written in the author’s language (%s), escaped, with "Open the recipe"',
    (lang) => {
      const r = renderMessage('recipe_cooked', payload, lang, LINKS)!;
      expect(r.text).toContain('Лена &lt;b&gt;');
      expect(r.text).toContain('Пирог &lt;с вишней&gt; &amp; сливками');
      expect(r.text).toContain('Тесто «как пух» &amp; &lt;i&gt;сочно&lt;/i&gt;');
      expect(r.text).not.toMatch(/<(?!\/?b>)/); // no tag but the bold we add
      expect(r.reply_markup.inline_keyboard).toEqual([
        [
          {
            text: expect.any(String),
            url: 'https://t.me/family_cookbook_bot/cook?startapp=rc_0a1b2c3d00004000800000000000abcd',
          },
        ],
      ]);
      expect([...r.text].length).toBeLessThanOrEqual(1024); // a photo caption's limit
    },
  );

  it('without words there is no empty line for them', () => {
    const r = renderMessage('recipe_cooked', { ...payload, note: null }, 'en', LINKS)!;
    expect(r.text.split('\n')).toHaveLength(1);
  });

  describe('sent by the worker (to the local stand-in)', () => {
    const TOKEN = '123456:reactions-test-token';
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
          photoUrl: async (key) => `http://127.0.0.1:8333/cookbook-media/${key}/full.jpg?signed`,
        },
      );

    it('with the photo (sendPhoto, the text as its caption)', async () => {
      const photo = await uploadPhoto(MEMBER);
      await react(MEMBER, { kind: 'cooked', note: 'Ура', photo_media_id: photo });
      expect((await send()).sent).toBe(1);
      expect(bot.messages).toEqual([
        expect.objectContaining({
          chat_id: String(KEEPER),
          photo: `http://127.0.0.1:8333/cookbook-media/media/${photo}/full.jpg?signed`,
          plain: expect.stringContaining('Ура'),
        }),
      ]);
    });

    it('without a photo: a text message', async () => {
      await react(MEMBER, { kind: 'cooked' });
      expect((await send()).sent).toBe(1);
      expect(bot.messages[0]).toMatchObject({ chat_id: String(KEEPER), photo: null });
    });

    it('if Telegram cannot take the photo, the words still arrive as a text message', async () => {
      const photo = await uploadPhoto(MEMBER);
      await react(MEMBER, { kind: 'cooked', note: 'Ура', photo_media_id: photo });
      bot.failNext(1, {
        status: 400,
        description: 'Bad Request: wrong file identifier/HTTP URL specified',
      });
      expect((await send()).sent).toBe(1);
      expect(bot.messages).toEqual([
        expect.objectContaining({ photo: null, plain: expect.stringContaining('Ура') }),
      ]);
    });
  });
});
