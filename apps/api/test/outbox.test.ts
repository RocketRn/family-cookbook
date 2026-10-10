import { startFakeTelegram, type FakeTelegram } from '@cookbook/fakebot';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/pool.js';
import { sendDueMessages, sendWhileBusy, type SenderOptions } from '../src/notify/outbox.js';
import { createTelegramClient, type TelegramClient } from '../src/notify/telegram.js';
import { fireDueTimers } from '../src/timers/fire.js';
import { adminPool, resetData, testPool } from './helpers/db.js';

/**
 * BE-08 outbox sender against the local Telegram stand-in (PRD 4.4; D-039): escaping, Telegram's
 * limits, 429 / 403 / errors, and no message lost when a worker stops half-way.
 */
const TOKEN = '123456:outbox-test-token-not-real-aaaaaaaaaaaaa';
let db: Db;
let db2: Db;
let admin: Db;
let bot: FakeTelegram;
let telegram: TelegramClient;
const opts: SenderOptions = {
  links: { botUsername: 'cookbook_test_bot', appShortName: 'cook' },
  chatIntervalMs: 1000,
  globalIntervalMs: 0,
};

beforeAll(async () => {
  db = testPool();
  db2 = testPool();
  admin = adminPool();
  bot = await startFakeTelegram({ token: TOKEN });
  telegram = createTelegramClient({ baseUrl: bot.url, token: TOKEN, allowLocal: true });
});
afterAll(async () => {
  await Promise.all([db.end(), db2.end(), admin.end(), bot.close()]);
});
beforeEach(async () => {
  await resetData(admin);
  bot.clear();
});

let nextTg = 7000;
async function user(lang: 'ru' | 'uk' | 'en' | 'sv' = 'ru'): Promise<{ id: string; tg: number }> {
  const tg = ++nextTg;
  const r = await admin.query<{ id: string }>(
    `INSERT INTO users (tg_user_id, first_name, ui_lang, bot_started) VALUES ($1, 'U', $2, true) RETURNING id`,
    [tg, lang],
  );
  return { id: r.rows[0]!.id, tg };
}
/** A timer that is due now, fired into the outbox. */
async function fired(
  userId: string,
  over: {
    label?: string;
    title?: string | null;
    step?: number | null;
    recipe?: string | null;
  } = {},
): Promise<string> {
  const r = await admin.query<{ id: string }>(
    `INSERT INTO timers (user_id, client_timer_id, label, recipe_title, step_number, recipe_id,
                         duration_sec, started_at, ends_at)
     VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, 60, now() - interval '61 s', now() - interval '1 s')
     RETURNING id`,
    [
      userId,
      over.label ?? 'Тушить',
      over.title === undefined ? 'Голубцы' : over.title,
      over.step === undefined ? 2 : over.step,
      over.recipe ?? null,
    ],
  );
  await fireDueTimers(db);
  return r.rows[0]!.id;
}
const row = async (timerId: string) =>
  (
    await admin.query(
      `SELECT status, attempts, run_at, sent_at, last_error, extract(epoch FROM run_at - now()) AS wait
         FROM notification_outbox WHERE dedupe_key = $1`,
      [`timer:${timerId}`],
    )
  ).rows[0];
const timerStatus = async (id: string) =>
  (await admin.query('SELECT status FROM timers WHERE id = $1', [id])).rows[0].status;
/** Pretend `sec` seconds have passed: everything waiting becomes due. */
const elapse = async (sec: number) => {
  await admin.query(`UPDATE notification_outbox SET run_at = run_at - make_interval(secs => $1)`, [
    sec,
  ]);
  await admin.query(`UPDATE outbox_gates SET next_at = next_at - make_interval(secs => $1)`, [sec]);
};

describe('sending', () => {
  it('sends a due timer message in the recipient language, HTML-escaped, with "open the step"', async () => {
    const u = await user('ru');
    const recipe = '0b6f0a39-1e7e-4f5b-9f8e-0c1d2e3f4a5b';
    await admin.query(`INSERT INTO recipes (id, author_id, title) VALUES ($1, $2, 'Голубцы')`, [
      recipe,
      u.id,
    ]);
    const id = await fired(u.id, {
      label: 'Тушить <на> медленном & огне',
      title: 'Голубцы',
      recipe,
    });
    const r = await sendDueMessages(db, telegram, opts);
    expect(r.sent).toBe(1);
    const [m] = bot.messages;
    expect(m!.chat_id).toBe(String(u.tg));
    expect(m!.parse_mode).toBe('HTML');
    expect(m!.plain).toBe(
      '⏰ \u2068Тушить <на> медленном & огне\u2069 — готово!\n«\u2068Голубцы\u2069», шаг 2',
    );
    expect(m!.text).toContain('&lt;на&gt; медленном &amp; огне');
    expect(m!.reply_markup).toEqual({
      inline_keyboard: [
        [
          {
            text: 'Открыть шаг',
            url: 'https://t.me/cookbook_test_bot/cook?startapp=cook_0b6f0a391e7e4f5b9f8e0c1d2e3f4a5b_2',
          },
        ],
      ],
    });
    expect(await row(id)).toMatchObject({ status: 'sent', attempts: 1, last_error: null });
    expect(await timerStatus(id)).toBe('fired');
    // Nothing more to send.
    expect((await sendDueMessages(db, telegram, opts)).sent).toBe(0);
    expect(bot.calls).toBe(1);
  });

  it('writes in all four languages', async () => {
    const texts: Record<string, string> = {};
    for (const lang of ['ru', 'uk', 'en', 'sv'] as const) {
      const u = await user(lang);
      await fired(u.id, { label: 'Ugn', title: 'Pie', step: 3 });
      await sendDueMessages(db, telegram, opts);
      texts[lang] = bot.messages[bot.messages.length - 1]!.plain;
    }
    expect(texts).toEqual({
      ru: '⏰ \u2068Ugn\u2069 — готово!\n«\u2068Pie\u2069», шаг 3',
      uk: '⏰ \u2068Ugn\u2069 — готово!\n«\u2068Pie\u2069», крок 3',
      en: '⏰ \u2068Ugn\u2069 — done!\n“\u2068Pie\u2069”, step 3',
      sv: '⏰ \u2068Ugn\u2069 — klart!\n”\u2068Pie\u2069”, steg 3',
    });
  });

  it('a timer without a recipe is just the label, and its button opens the app', async () => {
    const u = await user('en');
    await fired(u.id, { label: 'Tea', title: null, step: null });
    await sendDueMessages(db, telegram, opts);
    expect(bot.messages[0]!.plain).toBe('⏰ \u2068Tea\u2069 — done!');
    expect(bot.messages[0]!.reply_markup).toEqual({
      inline_keyboard: [[{ text: 'Open the app', url: 'https://t.me/cookbook_test_bot/cook' }]],
    });
  });

  it.each([
    ['HTML', '<b>Пирог</b> <a href="javascript:alert(1)">x</a> & <script>'],
    ['Markdown', '*Пирог* _с_ [ссылкой](http://x) `код` ~~зачёркнуто~~ #1 > цитата \\ | {}.!'],
    ['entities', '&amp; &lt; &#60; &quot;'],
    ['emoji', '👨‍👩‍👧‍👦 Семейный 🇸🇪🇺🇦 пирог 🥧'],
    ['right-to-left', 'עוגת תפוחים مع التفاح'],
    ['a bidi override', 'Пирог \u202Eйынтарбо\u202C текст'],
    ['control characters', 'Пирог\u0007\u001B[31m красный\r\nновая строка'],
    ['a very long title', 'Очень '.repeat(33)],
  ])('a hostile recipe title with %s always reaches Telegram, escaped', async (_kind, title) => {
    const u = await user('ru');
    // The database keeps at most 200 characters of a title and 100 of a label (the API cuts them).
    const id = await fired(u.id, { title, label: [...title].slice(0, 100).join('') });
    const r = await sendDueMessages(db, telegram, opts);
    expect(r, (await row(id)).last_error ?? '').toMatchObject({ sent: 1, failed: 0 });
    const plain = bot.messages[0]!.plain;
    expect([...plain].length).toBeLessThanOrEqual(400);
    // No control characters (except the template's own line break) and no direction overrides.
    const bad = [...plain].filter((ch) => {
      const c = ch.codePointAt(0)!;
      return (c < 32 && c !== 10) || (c >= 0x202a && c <= 0x202e);
    });
    expect(bad).toEqual([]);
    // The template uses no tags, so any "<" in what was sent would be unescaped user text.
    expect(bot.messages[0]!.text).not.toContain('<');
  });

  it('a long title is cut on a character boundary, never inside an emoji', async () => {
    const u = await user('ru');
    // 60 letters and 19 families (7 code points each): the cut falls among the families.
    await fired(u.id, { title: 'а'.repeat(60) + '👨‍👩‍👧‍👦'.repeat(19), label: 'x' });
    await sendDueMessages(db, telegram, opts);
    const plain = bot.messages[0]!.plain;
    expect(plain).toContain('…');
    expect(plain).not.toContain('\uFFFD');
    const families = plain.split('«\u2068')[1]!.split('…')[0]!.slice(60);
    expect(families.length).toBeGreaterThan(0);
    expect(families.replaceAll('👨‍👩‍👧‍👦', '')).toBe('');
  });
});

describe("Telegram's limits and answers", () => {
  it('429: waits retry_after (this message and all sending), does not count as a failure, then sends', async () => {
    const u = await user();
    const id = await fired(u.id);
    bot.failNext(1, { status: 429, retryAfter: 7 });
    const r = await sendDueMessages(db, telegram, opts);
    expect(r).toMatchObject({ sent: 0, deferred: 1 });
    const waiting = await row(id);
    expect(waiting).toMatchObject({ status: 'pending', attempts: 0 });
    expect(Number(waiting.wait)).toBeGreaterThan(6);
    // Another user's message waits too: a 429 slows the whole bot down.
    const other = await user();
    await fired(other.id);
    expect((await sendDueMessages(db, telegram, opts)).sent).toBe(0);
    await elapse(8);
    expect((await sendDueMessages(db, telegram, opts)).sent).toBe(2);
    expect(await row(id)).toMatchObject({ status: 'sent', attempts: 1 });
  });

  it('403: stops, records that the bot may not write, fails the timer, sends nothing more to them', async () => {
    const u = await user();
    const a = await fired(u.id);
    const b = await fired(u.id, { label: 'Второй' });
    bot.blockChat(u.tg);
    const r = await sendDueMessages(db, telegram, { ...opts, chatIntervalMs: 0 });
    expect(r).toMatchObject({ sent: 0, blocked: 2 });
    expect(bot.calls).toBe(1);
    expect(await row(a)).toMatchObject({ status: 'blocked' });
    expect(await row(b)).toMatchObject({ status: 'blocked' });
    expect(await timerStatus(a)).toBe('failed');
    expect(await timerStatus(b)).toBe('failed');
    expect(
      (await admin.query('SELECT bot_started FROM users WHERE id = $1', [u.id])).rows[0]
        .bot_started,
    ).toBe(false);
    await elapse(3600);
    expect((await sendDueMessages(db, telegram, opts)).sent).toBe(0);
    expect(bot.calls).toBe(1);
  });

  it('errors: retries after 1 s, 5 s, 30 s and 5 min, then gives up after 5 attempts and fails the timer', async () => {
    const u = await user();
    const id = await fired(u.id);
    bot.failNext(5, { status: 500 });
    const waits: number[] = [];
    for (let i = 0; i < 4; i++) {
      expect(await sendDueMessages(db, telegram, opts)).toMatchObject({ sent: 0, retried: 1 });
      const r = await row(id);
      expect(r).toMatchObject({ status: 'pending', attempts: i + 1 });
      waits.push(Math.round(Number(r.wait)));
      await elapse(400);
    }
    expect(waits).toEqual([1, 5, 30, 300]);
    expect(await sendDueMessages(db, telegram, opts)).toMatchObject({ failed: 1 });
    expect(await row(id)).toMatchObject({ status: 'failed', attempts: 5 });
    expect(await timerStatus(id)).toBe('failed');
  });

  it('400 (Telegram refuses the message) is not retried', async () => {
    const u = await user();
    const id = await fired(u.id);
    bot.failNext(1, { status: 400, description: 'Bad Request: chat not found' });
    expect(await sendDueMessages(db, telegram, opts)).toMatchObject({ failed: 1 });
    expect(await row(id)).toMatchObject({ status: 'failed', attempts: 1 });
    expect((await row(id)).last_error).toContain('chat not found');
  });

  it('one message per second to the same chat; other chats are not held up', async () => {
    const a = await user();
    const b = await user();
    await fired(a.id, { label: 'A1' });
    await fired(a.id, { label: 'A2' });
    await fired(b.id, { label: 'B1' });
    const r = await sendDueMessages(db, telegram, opts);
    expect(r).toMatchObject({ sent: 2, deferred: 1 });
    expect(bot.messages.map((m) => m.plain.split('\u2068')[1]!.split('\u2069')[0])).toEqual([
      'A1',
      'B1',
    ]);
    await elapse(1.1);
    expect((await sendDueMessages(db, telegram, opts)).sent).toBe(1);
  });

  it('the bot as a whole stays under its rate (here 5 a second): a short wait is waited out', async () => {
    // S6-5 (QA-03, D-058): putting the message off until the next poll (half a second later)
    // made a burst of 100 timer messages take 18 s; the sender now waits the few milliseconds.
    for (let i = 0; i < 6; i++) await fired((await user()).id);
    const times: number[] = [];
    const timed: TelegramClient = {
      ...telegram,
      sendMessage: (...a) => {
        times.push(Date.now());
        return telegram.sendMessage(...a);
      },
    };
    const r = await sendDueMessages(db, timed, { ...opts, globalIntervalMs: 200 });
    expect(r).toMatchObject({ sent: 6, deferred: 0 });
    const gaps = times.slice(1).map((t, i) => t - times[i]!);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(180);
  });

  it('a longer wait for the whole bot (over a second) is not waited out: the message is put off', async () => {
    for (let i = 0; i < 2; i++) await fired((await user()).id);
    const r = await sendDueMessages(db, telegram, { ...opts, globalIntervalMs: 3000 });
    expect(r).toMatchObject({ sent: 1, deferred: 1 });
    const wait = (
      await admin.query(
        `SELECT extract(epoch FROM run_at - now()) AS w FROM notification_outbox WHERE status = 'pending'`,
      )
    ).rows.map((x) => Number(x.w));
    expect(wait[0]).toBeGreaterThan(2);
  });

  it('while more is due than one batch, the worker keeps going without idling between batches', async () => {
    for (let i = 0; i < 25; i++) await fired((await user()).id);
    const r = await sendWhileBusy(db, telegram, { ...opts, batch: 10, globalIntervalMs: 5 });
    expect(r).toMatchObject({ sent: 25, deferred: 0 });
    expect(bot.messages).toHaveLength(25);
    // Nothing left: one more round finds nothing and stops at once.
    expect(await sendWhileBusy(db, telegram, opts)).toMatchObject({ sent: 0, claimed: 0 });
  });

  it('…but not forever: it stops after the time it is given, the rest goes on the next poll', async () => {
    for (let i = 0; i < 12; i++) await fired((await user()).id);
    const r = await sendWhileBusy(db, telegram, {
      ...opts,
      batch: 2,
      globalIntervalMs: 100,
      busyForMs: 300,
    });
    expect(r.sent).toBeGreaterThan(1);
    expect(r.sent).toBeLessThan(12);
  });

  it('timer messages go first', async () => {
    const u = await user();
    const v = await user();
    const later = await fired(u.id, { label: 'first in, timer' });
    await admin.query(
      `UPDATE notification_outbox SET priority = 1, run_at = now() - interval '1 h'`,
    );
    const urgent = await fired(v.id, { label: 'second in, but priority 0' });
    await sendDueMessages(db, telegram, { ...opts, batch: 1 });
    expect(await row(urgent)).toMatchObject({ status: 'sent' });
    expect(await row(later)).toMatchObject({ status: 'pending' });
  });
});

describe('no message lost, none sent twice by two workers', () => {
  it('a message taken by a worker that stopped half-way is sent by the next one', async () => {
    const u = await user();
    const id = await fired(u.id);
    // Worker A took it (status "sending") and then its process was killed.
    await admin.query(
      `UPDATE notification_outbox SET status = 'sending', locked_until = now() + interval '30 s'`,
    );
    expect((await sendDueMessages(db, telegram, opts)).sent).toBe(0); // still A's for now
    await admin.query(`UPDATE notification_outbox SET locked_until = now() - interval '1 s'`);
    const restarted = testPool();
    try {
      expect((await sendDueMessages(restarted, telegram, opts)).sent).toBe(1);
    } finally {
      await restarted.end();
    }
    expect(await row(id)).toMatchObject({ status: 'sent' });
  });

  it('two senders at once deliver each of 20 messages exactly once', async () => {
    for (let i = 0; i < 20; i++) await fired((await user()).id, { label: `T${i}` });
    const o = { ...opts, batch: 4 };
    for (let round = 0; round < 8; round++) {
      await Promise.all([sendDueMessages(db, telegram, o), sendDueMessages(db2, telegram, o)]);
    }
    const labels = bot.messages.map((m) => m.plain.split('\u2068')[1]!.split('\u2069')[0]);
    expect(labels).toHaveLength(20);
    expect(new Set(labels).size).toBe(20);
  });
});

describe('the Telegram client', () => {
  it('refuses the real Telegram API unless allowed (tests and the demo can never reach it)', () => {
    expect(() =>
      createTelegramClient({ baseUrl: 'https://api.telegram.org', token: TOKEN }),
    ).toThrow(/real Telegram/);
    // Not even when told it may: this is a test run (S5-2; the full rules: prod-safety.test.ts).
    expect(() =>
      createTelegramClient({ baseUrl: 'https://api.telegram.org', token: TOKEN, allowReal: true }),
    ).toThrow(/real Telegram/);
    expect(() => createTelegramClient({ baseUrl: bot.url, token: TOKEN })).toThrow(/local/);
  });
});
