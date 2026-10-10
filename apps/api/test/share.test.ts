import { startFakeTelegram, type FakeTelegram } from '@cookbook/fakebot';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/pool.js';
import { adminPool, authHeader, resetData, testApp, testPool } from './helpers/db.js';
import { caller, family, KEEPER, MEMBER, OUTSIDER, type Family } from './helpers/cooking.js';
import { multipart, png } from './helpers/images.js';

/**
 * BE-12 / S6-3b (PRD 4.7, R1; D-056): "Share" asks the server to prepare a message with the
 * recipe's title (and photo) and an "Open the recipe" button; the app sends it with Telegram's
 * shareMessage. A book recipe's button works for the book; a recipe shared by link, for anyone.
 * Without Telegram (or when it refuses) the answer still has the link, for the app's fallback.
 */
const TOKEN = '123456:share-test-token';
const APP = 'https://t.me/your_cookbook_bot/cookbook';
let db: Db;
let admin: Db;
let bot: FakeTelegram;
let app: FastifyInstance;
let call: ReturnType<typeof caller>;
let fam: Family;

beforeAll(async () => {
  db = testPool();
  admin = adminPool();
  bot = await startFakeTelegram({ token: TOKEN });
  app = await testApp(db, {
    telegram: { baseUrl: bot.url, token: TOKEN, allowLocal: true, allowReal: false },
  });
  call = caller(app);
});
afterAll(async () => {
  await app.close();
  await bot.close();
  await Promise.all([db.end(), admin.end()]);
});
beforeEach(async () => {
  await resetData(admin);
  bot.clear();
  fam = await family(app);
});

const share = (tg: number, id = fam.bookRecipeId, to = app) =>
  to.inject({ method: 'POST', url: `/recipes/${id}/share`, headers: authHeader(tg) });
const hex = (id: string) => id.replace(/-/g, '');

describe('sharing a recipe', () => {
  it('a book recipe: a prepared message with its title and a button that opens it for the book', async () => {
    const r = await share(MEMBER);
    expect(r.statusCode, r.body).toBe(200);
    const link = `${APP}?startapp=rc_${hex(fam.bookRecipeId)}`;
    expect(r.json()).toEqual({ link, prepared_message_id: 'prepared-1', for: 'book' });
    expect(bot.prepared).toEqual([
      expect.objectContaining({
        id: 'prepared-1',
        user_id: MEMBER,
        result: expect.objectContaining({
          type: 'article',
          title: 'Голубцы',
          reply_markup: { inline_keyboard: [[{ text: 'Open the recipe', url: link }]] },
        }),
      }),
    ]);
    expect(bot.prepared[0]!.plain).toContain('Голубцы');
  });

  it('a recipe shared by link: the button is the link anyone can open', async () => {
    const token = (
      await call('PATCH', `/recipes/${fam.bookRecipeId}`, KEEPER, { visibility: 'link' })
    ).json().share_token;
    const r = await share(MEMBER);
    expect(r.json()).toMatchObject({ link: `${APP}?startapp=r_${token}`, for: 'anyone' });
  });

  it('with a cover photo: the message is the photo, the title its caption', async () => {
    const m = multipart(await png());
    const photo = await app.inject({
      method: 'POST',
      url: '/media',
      headers: { ...authHeader(KEEPER), ...m.headers },
      payload: m.payload,
    });
    await call('PATCH', `/recipes/${fam.bookRecipeId}`, KEEPER, {
      cover_media_id: photo.json().id,
    });
    await share(KEEPER);
    expect(bot.prepared[0]!.result).toMatchObject({
      type: 'photo',
      photo_url: expect.stringMatching(/^https?:\/\//),
      thumbnail_url: expect.stringMatching(/^https?:\/\//),
      caption: expect.stringContaining('Голубцы'),
      parse_mode: 'HTML',
    });
  });

  it('is written in the sharer’s language, with the title escaped', async () => {
    await call('PATCH', `/recipes/${fam.bookRecipeId}`, KEEPER, { title: 'Пирог <с вишней> & Co' });
    await call('PATCH', '/me', KEEPER, { ui_lang: 'ru' });
    await share(KEEPER);
    const p = bot.prepared[0]!;
    expect(p.plain).toContain('Пирог <с вишней> & Co');
    expect(JSON.stringify(p.result)).toContain('Пирог &lt;с вишней&gt; &amp; Co');
    expect(
      (p.result.reply_markup as { inline_keyboard: Array<Array<{ text: string }>> })
        .inline_keyboard[0]![0]!.text,
    ).toBe('Открыть рецепт');
  });

  it('a draft or a private recipe cannot be shared (409); one you cannot read is not found', async () => {
    const draft = (
      await call('POST', '/recipes', KEEPER, { title: 'Черновик', steps: [{ body: 'x' }] })
    ).json();
    const d = await share(KEEPER, draft.id);
    expect(d.statusCode).toBe(409);
    expect(d.json().error.code).toBe('NOT_SHAREABLE');
    expect((await share(MEMBER, fam.outsiderRecipeId)).statusCode).toBe(404);
    expect((await share(OUTSIDER)).statusCode).toBe(404);
    expect((await share(MEMBER, randomUUID())).statusCode).toBe(404);
    expect(bot.prepared).toEqual([]);
  });

  it('when Telegram refuses, or is not set up: still the link (the app offers it instead)', async () => {
    bot.failNext(1, { status: 400, description: 'Bad Request: test' });
    const refused = await share(MEMBER);
    expect(refused.statusCode).toBe(200);
    expect(refused.json()).toMatchObject({ prepared_message_id: null, for: 'book' });
    const without = await testApp(db);
    try {
      const r = await share(MEMBER, fam.bookRecipeId, without);
      expect(r.json()).toMatchObject({
        link: `${APP}?startapp=rc_${hex(fam.bookRecipeId)}`,
        prepared_message_id: null,
      });
    } finally {
      await without.close();
    }
  });
});
