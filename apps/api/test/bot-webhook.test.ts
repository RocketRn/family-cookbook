import { startFakeTelegram, type FakeTelegram } from '@cookbook/fakebot';
import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setWebhook } from '../src/bot/webhookCli.js';
import { ConfigError, loadConfig } from '../src/config.js';
import type { Db } from '../src/db/pool.js';
import { withSystem, withUser } from '../src/db/tx.js';
import { sendDueMessages } from '../src/notify/outbox.js';
import { createTelegramClient } from '../src/notify/telegram.js';
import { renderMessage, type Lang } from '../src/notify/templates.js';
import { cleanupFinished } from '../src/timers/fire.js';
import { adminPool, insertUser, resetData, testApp, testConfig, testPool } from './helpers/db.js';

/**
 * BE-07 (PRD 4.4 "Incoming"): Telegram delivers updates to POST /bot/webhook with the secret token
 * set by setWebhook. The bot answers /start (also from an invite link) through the outbox, notices
 * when someone blocks it (my_chat_member), and handles every update once, however often Telegram
 * delivers it. No real Telegram: the answer is sent to the local stand-in.
 */
const SECRET = 'webhook-secret-for-tests-0123456789abcdef';
const LINKS = { botUsername: 'family_cookbook_bot', appShortName: 'cook' };
const APP_LINK = 'https://t.me/family_cookbook_bot/cook';

let db: Db;
let admin: Db;
let app: FastifyInstance;
let nextUpdate = 5000;

type From = { id: number; first_name?: string; username?: string; language_code?: string };
const person = (id: number, over: Partial<From> = {}) => ({
  id,
  is_bot: false,
  first_name: 'Мама',
  username: 'mama_cooks',
  language_code: 'ru',
  ...over,
});
function message(from: ReturnType<typeof person>, text: string, chatType = 'private') {
  return {
    update_id: nextUpdate++,
    message: {
      message_id: nextUpdate,
      date: 1_760_000_000,
      chat: { id: chatType === 'private' ? from.id : -100123, type: chatType },
      from,
      text,
    },
  };
}
function memberUpdate(id: number, status: 'kicked' | 'member', chatType = 'private') {
  return {
    update_id: nextUpdate++,
    my_chat_member: {
      chat: { id: chatType === 'private' ? id : -100123, type: chatType },
      from: person(id),
      date: 1_760_000_000,
      old_chat_member: { status: status === 'kicked' ? 'member' : 'kicked', user: { id: 1 } },
      new_chat_member: { status, user: { id: 1, is_bot: true, first_name: 'Cookbook' } },
    },
  };
}
const deliver = (body: unknown, secret: string | null = SECRET, to = app) =>
  to.inject({
    method: 'POST',
    url: '/bot/webhook',
    headers: secret === null ? {} : { 'x-telegram-bot-api-secret-token': secret },
    payload: body as object,
  });

const outbox = async () =>
  (
    await admin.query<{
      type: string;
      recipient_user_id: string;
      payload: { start: string | null };
      dedupe_key: string;
      priority: number;
    }>(
      `SELECT type, recipient_user_id, payload, dedupe_key, priority FROM notification_outbox ORDER BY created_at`,
    )
  ).rows;
const userByTg = async (tg: number) =>
  (
    await admin.query<{
      id: string;
      first_name: string | null;
      tg_username: string | null;
      ui_lang: string;
      bot_started: boolean;
    }>(
      'SELECT id, first_name, tg_username, ui_lang, bot_started FROM users WHERE tg_user_id = $1',
      [tg],
    )
  ).rows[0];

beforeAll(async () => {
  db = testPool();
  admin = adminPool();
  app = await testApp(db, { env: { BOT_WEBHOOK_SECRET: SECRET } });
});
afterAll(async () => {
  await app.close();
  await Promise.all([db.end(), admin.end()]);
});
beforeEach(async () => {
  await resetData(admin);
});

describe('the webhook door', () => {
  it('is closed (404) when no secret is configured', async () => {
    const closed = await testApp(db);
    try {
      expect((await deliver(message(person(7001), '/start'), SECRET, closed)).statusCode).toBe(404);
    } finally {
      await closed.close();
    }
    expect(await userByTg(7001)).toBeUndefined();
  });

  it.each([
    ['no secret', null],
    ['a wrong secret', 'webhook-secret-for-tests-0123456789abcdeX'],
    ['a shorter secret', 'webhook-secret'],
  ])('refuses %s (401) and writes nothing', async (_why, secret) => {
    const r = await deliver(message(person(7002), '/start'), secret);
    expect(r.statusCode).toBe(401);
    expect(await userByTg(7002)).toBeUndefined();
    expect(await outbox()).toEqual([]);
    expect((await admin.query('SELECT 1 FROM tg_updates')).rowCount).toBe(0);
  });

  it('limits wrong secrets per address (429)', async () => {
    const strict = await testApp(db, {
      env: { BOT_WEBHOOK_SECRET: SECRET, RATE_LIMIT_AUTH_FAILURES_PER_IP: '2' },
    });
    try {
      const codes = [];
      for (let i = 0; i < 3; i++)
        codes.push((await deliver({ update_id: i }, 'wrong', strict)).statusCode);
      expect(codes).toEqual([401, 401, 429]);
    } finally {
      await strict.close();
    }
  });

  it('answers 400 to something that is not an update, and 200 to updates it does not handle', async () => {
    expect((await deliver({ hello: 'world' })).statusCode).toBe(400);
    expect(
      (await deliver({ update_id: nextUpdate++, edited_message: { text: 'x' } })).statusCode,
    ).toBe(200);
    expect((await deliver({ update_id: nextUpdate++, message: { weird: true } })).statusCode).toBe(
      200,
    );
  });
});

describe('/start', () => {
  it('creates the person, notes that the bot may write, and queues one answer', async () => {
    const r = await deliver(message(person(7010, { language_code: 'uk' }), '/start'));
    expect(r.statusCode).toBe(200);
    const u = await userByTg(7010);
    expect(u).toMatchObject({
      first_name: 'Мама',
      tg_username: 'mama_cooks',
      ui_lang: 'uk',
      bot_started: true,
    });
    expect(await outbox()).toEqual([
      {
        type: 'bot_start',
        recipient_user_id: u!.id,
        payload: { start: null },
        dedupe_key: expect.stringMatching(/^start:\d+$/),
        priority: 0,
      },
    ]);
  });

  it('for someone who already uses the app: bot_started becomes true, their language stays', async () => {
    await insertUser(admin, 7011);
    await admin.query(
      `UPDATE users SET ui_lang = 'sv', bot_started = false WHERE tg_user_id = 7011`,
    );
    await deliver(message(person(7011, { language_code: 'ru', first_name: 'Anna' }), '/start'));
    expect(await userByTg(7011)).toMatchObject({
      ui_lang: 'sv',
      bot_started: true,
      first_name: 'Anna',
    });
    expect(await outbox()).toHaveLength(1);
  });

  it.each([
    ['/start join_Ab3dE5', 'join_Ab3dE5'],
    ['/start@family_cookbook_bot join_Ab3dE5', 'join_Ab3dE5'],
    ['/start rc_0123456789abcdef0123456789abcdef', 'rc_0123456789abcdef0123456789abcdef'],
    ['/start', null],
    ['/start    ', null],
    ['/start join_<b>', null],
    [`/start join_${'x'.repeat(70)}`, null],
    ['/start a b', null],
  ])('%s: keeps the invite or link only when it is a valid payload', async (text, start) => {
    await deliver(message(person(7012), text));
    expect((await outbox()).map((m) => m.payload)).toEqual([{ start }]);
  });

  it('handles each update once, however often Telegram delivers it (also at the same moment)', async () => {
    const u = message(person(7013), '/start join_Fam1ly');
    expect((await deliver(u)).statusCode).toBe(200);
    expect((await deliver(u)).statusCode).toBe(200);
    const again = message(person(7014), '/start');
    const codes = await Promise.all([deliver(again), deliver(again), deliver(again)]);
    expect(codes.map((c) => c.statusCode)).toEqual([200, 200, 200]);
    expect(await outbox()).toHaveLength(2);
    // A new /start (a new update) is answered again.
    await deliver(message(person(7013), '/start'));
    expect(await outbox()).toHaveLength(3);
  });

  it('is not answered from a group, from another bot, or for a deleted account', async () => {
    await deliver(message(person(7015), '/start', 'group'));
    await deliver(message({ ...person(7016), is_bot: true }, '/start'));
    const id = await insertUser(admin, 7017);
    await admin.query(`UPDATE users SET deleted_at = now(), first_name = NULL WHERE id = $1`, [id]);
    await deliver(message(person(7017), '/start'));
    expect(await outbox()).toEqual([]);
    expect(await userByTg(7015)).toBeUndefined();
    expect(await userByTg(7016)).toBeUndefined();
    expect(await userByTg(7017)).toMatchObject({ first_name: null, bot_started: false });
  });

  it('other messages get no answer yet (forwarding recipes to the bot comes later)', async () => {
    await deliver(message(person(7018), 'Привет! Вот рецепт борща'));
    await deliver(message(person(7018), '/help'));
    expect(await outbox()).toEqual([]);
  });
});

describe('blocking the bot (my_chat_member)', () => {
  it('blocked: bot_started becomes false; unblocked: true again', async () => {
    await insertUser(admin, 7020);
    await admin.query('UPDATE users SET bot_started = true WHERE tg_user_id = 7020');
    await deliver(memberUpdate(7020, 'kicked'));
    expect((await userByTg(7020))!.bot_started).toBe(false);
    await deliver(memberUpdate(7020, 'member'));
    expect((await userByTg(7020))!.bot_started).toBe(true);
    expect(await outbox()).toEqual([]);
  });

  it('creates nobody, and ignores groups', async () => {
    await deliver(memberUpdate(7021, 'member'));
    expect(await userByTg(7021)).toBeUndefined();
    await insertUser(admin, 7022);
    await admin.query('UPDATE users SET bot_started = true WHERE tg_user_id = 7022');
    await deliver(memberUpdate(7022, 'kicked', 'group'));
    expect((await userByTg(7022))!.bot_started).toBe(true);
  });
});

describe('the answer', () => {
  const langs: Lang[] = ['ru', 'uk', 'en', 'sv'];

  it.each(langs)('is written in the person’s language (%s), with a button into the app', (lang) => {
    const plain = renderMessage('bot_start', { start: null }, lang, LINKS)!;
    const invite = renderMessage('bot_start', { start: 'join_Ab3dE5' }, lang, LINKS)!;
    expect(plain.text.length).toBeGreaterThan(20);
    expect(invite.text).not.toBe(plain.text);
    expect(plain.reply_markup.inline_keyboard).toEqual([
      [{ text: expect.any(String), url: APP_LINK }],
    ]);
    expect(invite.reply_markup.inline_keyboard).toEqual([
      [{ text: expect.any(String), url: `${APP_LINK}?startapp=join_Ab3dE5` }],
    ]);
    expect(renderMessage('bot_start', { start: 'rc_ab' }, lang, LINKS)!.reply_markup).toEqual({
      inline_keyboard: [[{ text: expect.any(String), url: `${APP_LINK}?startapp=rc_ab` }]],
    });
  });

  it('never puts a payload it does not trust into the link', () => {
    for (const start of ['join_<b>', 'x'.repeat(65), 'a b', 42, undefined]) {
      const r = renderMessage('bot_start', { start }, 'en', LINKS)!;
      expect(r.reply_markup.inline_keyboard[0]![0]!.url).toBe(APP_LINK);
    }
  });

  it('reaches the person through the outbox (sent to the local stand-in)', async () => {
    const bot: FakeTelegram = await startFakeTelegram({ token: '123456:bot-webhook-test-token' });
    try {
      const telegram = createTelegramClient({
        baseUrl: bot.url,
        token: '123456:bot-webhook-test-token',
        allowLocal: true,
      });
      await deliver(message(person(7030, { language_code: 'en' }), '/start join_Fam1ly'));
      const s = await sendDueMessages(db, telegram, {
        links: LINKS,
        chatIntervalMs: 0,
        globalIntervalMs: 0,
      });
      expect(s.sent).toBe(1);
      expect(bot.messages).toHaveLength(1);
      expect(bot.messages[0]!.chat_id).toBe('7030');
      expect(bot.messages[0]!.reply_markup).toEqual({
        inline_keyboard: [[{ text: expect.any(String), url: `${APP_LINK}?startapp=join_Fam1ly` }]],
      });
    } finally {
      await bot.close();
    }
  });
});

describe('the whole loop on this computer', () => {
  it('the stand-in presses /start and blocks the bot; the app answers through the stand-in', async () => {
    const TOKEN = '123456:bot-loop-test-token';
    const live = await testApp(db, { env: { BOT_WEBHOOK_SECRET: SECRET } });
    await live.listen({ port: 0, host: '127.0.0.1' });
    const bot = await startFakeTelegram({ token: TOKEN });
    try {
      const target = { baseUrl: bot.url, token: TOKEN, allowLocal: true };
      const { port } = live.server.address() as AddressInfo;
      await setWebhook(target, { url: `http://127.0.0.1:${port}/bot/webhook`, secret: SECRET });
      expect(await bot.pressStart(100000002, 'join_Fam1ly')).toBe(200);
      const s = await sendDueMessages(db, createTelegramClient(target), {
        links: LINKS,
        chatIntervalMs: 0,
        globalIntervalMs: 0,
      });
      expect(s.sent).toBe(1);
      expect(bot.messages[0]).toMatchObject({ chat_id: '100000002' });
      expect(bot.messages[0]!.reply_markup).toEqual({
        inline_keyboard: [[{ text: expect.any(String), url: `${APP_LINK}?startapp=join_Fam1ly` }]],
      });
      expect(await userByTg(100000002)).toMatchObject({ bot_started: true, ui_lang: 'en' });
      expect(await bot.blockBot(100000002)).toBe(200);
      expect((await userByTg(100000002))!.bot_started).toBe(false);
    } finally {
      await bot.close();
      await live.close();
    }
  });
});

describe('who may do what', () => {
  it('the sign-in role may queue only the /start answer', async () => {
    const id = await insertUser(admin, 7040);
    const queue = (type: string) =>
      withSystem(db, (tx) =>
        tx.query(
          `INSERT INTO notification_outbox (type, recipient_user_id, payload, dedupe_key)
           VALUES ($1, $2, '{}', $3)`,
          [type, id, `test:${type}`],
        ),
      );
    await expect(queue('timer_fired')).rejects.toThrow(/row-level security/);
    await expect(queue('bot_start')).resolves.toBeDefined();
  });

  it('the user role cannot read the update log', async () => {
    const id = await insertUser(admin, 7041);
    await expect(
      withUser(db, { userId: id }, (tx) => tx.query('SELECT * FROM tg_updates')),
    ).rejects.toThrow(/permission denied/);
  });

  it('the worker forgets updates after 7 days', async () => {
    await admin.query(
      `INSERT INTO tg_updates (update_id, received_at) VALUES (1, now() - interval '8 days'), (2, now())`,
    );
    const removed = await cleanupFinished(db);
    expect(removed.updates).toBe(1);
    expect((await admin.query('SELECT update_id FROM tg_updates')).rows).toEqual([
      { update_id: '2' },
    ]);
  });
});

describe('the secret', () => {
  it('outside production: optional; when given, Telegram’s alphabet and at least 16 characters', () => {
    expect(testConfig().botWebhookSecret).toBeNull();
    expect(testConfig({ BOT_WEBHOOK_SECRET: SECRET }).botWebhookSecret).toBe(SECRET);
    for (const bad of ['short', 'has spaces in it 0123456789', 'ünicode-0123456789abcdef']) {
      expect(() => testConfig({ BOT_WEBHOOK_SECRET: bad })).toThrow(/BOT_WEBHOOK_SECRET/);
    }
  });

  it('in production: required, random-looking, at least 32 characters', () => {
    const prod = {
      NODE_ENV: 'production',
      DATABASE_URL:
        'postgres://cookbook_api:3f9c1e7a5b2d4c6e8f0a1b3c5d7e9f21@postgres:5432/cookbook',
      BOT_TOKEN: '987654321:AAG7kQ2mX9pL4vR8sT1wY6zB3nC5dF0hJ2k',
      BOT_USERNAME: 'family_cookbook_bot',
      MINI_APP_SHORT_NAME: 'cook',
      CORS_ORIGIN: 'https://family-cookbook.duckdns.org',
      S3_ENDPOINT: 'https://storage.googleapis.com',
      S3_REGION: 'auto',
      S3_BUCKET: 'family-cookbook-photos-4821',
      S3_ACCESS_KEY: 'GOOG1EREALLOOKINGKEY',
      S3_SECRET_KEY: 'real-looking-secret-0123456789',
    };
    const good = 'a3f9c1e7b5d2c4e6f8a0b1c3d5e7f921a3f9c1e7b5d2c4e6';
    expect(loadConfig({ ...prod, BOT_WEBHOOK_SECRET: good }).botWebhookSecret).toBe(good);
    for (const bad of [undefined, 'CHANGE_ME', SECRET.slice(0, 31), `dev-only-${good}`]) {
      expect(() => loadConfig({ ...prod, BOT_WEBHOOK_SECRET: bad }), String(bad)).toThrow(
        ConfigError,
      );
      expect(() => loadConfig({ ...prod, BOT_WEBHOOK_SECRET: bad })).toThrow(/BOT_WEBHOOK_SECRET/);
    }
  });
});
