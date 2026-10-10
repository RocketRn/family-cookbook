import { startFakeTelegram, type FakeTelegram } from '@cookbook/fakebot';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/pool.js';
import { sendDueMessages } from '../src/notify/outbox.js';
import { createTelegramClient } from '../src/notify/telegram.js';
import { fireDueTimers } from '../src/timers/fire.js';
import { adminPool, resetData, testApp, testPool } from './helpers/db.js';
import { caller, family, MEMBER, timerBody, type Family } from './helpers/cooking.js';

/**
 * BE-14 / S6-4 (PRD 6.2, 7.1 "a timer message within 5 s"; D-057): how late timer messages are.
 * The worker logs each timer message's delay (end → sent). GET /health/full gives the last hour's
 * figures and whether the worker keeps up, and answers 503 when it does not, so a free uptime
 * check can e-mail the owner. GET /health stays the plain liveness check for Docker.
 */
const TOKEN = '123456:observability-test-token';
const LINKS = { botUsername: 'family_cookbook_bot', appShortName: 'cook' };
let db: Db;
let admin: Db;
let bot: FakeTelegram;
let app: FastifyInstance;
let call: ReturnType<typeof caller>;
let fam: Family;
let logs: Array<{ level: string; msg: string; data?: Record<string, unknown> }>;

beforeAll(async () => {
  db = testPool();
  admin = adminPool();
  bot = await startFakeTelegram({ token: TOKEN });
  app = await testApp(db);
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
  logs = [];
  fam = await family(app);
});

const send = () =>
  sendDueMessages(db, createTelegramClient({ baseUrl: bot.url, token: TOKEN, allowLocal: true }), {
    links: LINKS,
    chatIntervalMs: 0,
    globalIntervalMs: 0,
    log: (level, msg, data) => void logs.push({ level, msg, data }),
  });
/** A timer that ended `agoMs` ago, fired now (as the worker would). */
async function endedTimer(agoMs: number) {
  const r = await call('POST', '/timers', MEMBER, {
    ...timerBody(),
    recipe_id: fam.bookRecipeId,
    step_id: fam.stepIds[1],
  });
  expect(r.statusCode, r.body).toBe(201);
  const id = r.json().timer.id;
  await admin.query(
    `UPDATE timers SET started_at = now() - make_interval(secs => duration_sec) - make_interval(secs => $2::float8 / 1000),
                       ends_at = now() - make_interval(secs => $2::float8 / 1000) WHERE id = $1`,
    [id, agoMs],
  );
  await fireDueTimers(db);
  return id;
}
const full = () => app.inject({ method: 'GET', url: '/health/full' });

describe('how late timer messages are', () => {
  it('the timer’s end goes with its message, and the worker logs the delay when it is sent', async () => {
    const id = await endedTimer(1500);
    const q = await admin.query<{ payload: { ends_at?: string } }>(
      `SELECT payload FROM notification_outbox WHERE dedupe_key = $1`,
      [`timer:${id}`],
    );
    expect(Date.parse(q.rows[0]!.payload.ends_at!)).toBeLessThan(Date.now());
    await send();
    const line = logs.find((l) => l.msg === 'timer message sent');
    expect(line).toBeTruthy();
    expect(line!.data).toMatchObject({ timerId: id });
    expect(line!.data!.delayMs).toBeGreaterThanOrEqual(1500);
    expect(line!.data!.delayMs).toBeLessThan(15_000);
    expect(JSON.stringify(logs)).not.toContain(TOKEN.split(':')[1]);
  });

  it('GET /health/full: the last hour’s timer messages, their delays, and late ones (over 5 s)', async () => {
    await endedTimer(1000);
    await endedTimer(9000);
    await send();
    const r = await full();
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({
      status: 'ok',
      db: 'ok',
      worker: { overdue_messages: 0 },
      timer_messages_last_hour: { sent: 2, late: 1, failed: 0 },
    });
    const t = r.json().timer_messages_last_hour;
    expect(t.p50_ms).toBeGreaterThanOrEqual(1000);
    expect(t.max_ms).toBeGreaterThanOrEqual(9000);
    expect(t.p95_ms).toBeLessThanOrEqual(t.max_ms);
  });

  it('a message the bot could not deliver counts as failed', async () => {
    await endedTimer(1000);
    bot.blockChat(MEMBER);
    await send();
    expect((await full()).json().timer_messages_last_hour).toMatchObject({ sent: 0, failed: 1 });
  });

  it('nothing yet: zeros, and no figures to average', async () => {
    expect((await full()).json().timer_messages_last_hour).toEqual({
      sent: 0,
      late: 0,
      failed: 0,
      p50_ms: null,
      p95_ms: null,
      max_ms: null,
    });
  });
});

describe('is the worker keeping up?', () => {
  it('messages due for over 2 minutes and still not sent: 503, so the uptime check alerts', async () => {
    await endedTimer(1000);
    await admin.query(`UPDATE notification_outbox SET run_at = now() - interval '3 minutes'`);
    const r = await full();
    expect(r.statusCode).toBe(503);
    expect(r.json()).toMatchObject({ status: 'degraded', worker: { overdue_messages: 1 } });
    // The plain liveness check for Docker is not affected.
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });

  it('a message waiting for its retry (Telegram asked to wait) is not overdue', async () => {
    await endedTimer(1000);
    await admin.query(`UPDATE notification_outbox SET run_at = now() + interval '1 minute'`);
    expect((await full()).statusCode).toBe(200);
  });

  it('nobody can hammer it: limited per address', async () => {
    const strict = await testApp(db, { env: { RATE_LIMIT_PER_IP: '3' } });
    try {
      const codes = [];
      for (let i = 0; i < 4; i++)
        codes.push((await strict.inject({ method: 'GET', url: '/health/full' })).statusCode);
      expect(codes).toEqual([200, 200, 200, 429]);
    } finally {
      await strict.close();
    }
  });

  it('says nothing about people or recipes', async () => {
    await endedTimer(1000);
    await send();
    const body = (await full()).body;
    expect(body).not.toMatch(/Голубцы|Тушить|User9102|[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
});
