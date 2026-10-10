import { startFakeTelegram, type FakeTelegram } from '@cookbook/fakebot';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/pool.js';
import { adminPool, resetData } from './helpers/db.js';

/**
 * QA-03 / S6-5 (PRD 6.5, 4.6, 7.1; D-058): the worker under load. 1000 running timers of 100
 * people (10 each, the most one person may have), 100 of them ending in the same second, one per
 * person. Two real worker processes (`apps/worker`), as on a server that runs more than one, send
 * through the Telegram stand-in at the real pace (one message a second per chat, 25 a second for
 * the bot). Every message goes exactly once, none of the other 900 timers is touched, and the
 * delays are measured the way the server measures them (`delivery_health()`, D-057).
 */
const TOKEN = '123456:worker-load-test-token';
const PEOPLE = 100;
const PER_PERSON = 10;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const WORKER = path.join(ROOT, 'apps/worker/src/index.ts');

let admin: Db;
let bot: FakeTelegram;
const workers: ChildProcess[] = [];
const output: string[] = [];

function startWorker(): ChildProcess {
  const child = spawn(process.execPath, ['--import', 'tsx', '--conditions=source', WORKER], {
    cwd: path.join(ROOT, 'apps/api'),
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'development',
      DATABASE_URL: process.env.DATABASE_URL,
      LOG_LEVEL: 'warn',
      BOT_TOKEN: TOKEN,
      TELEGRAM_API_BASE: bot.url,
      BOT_USERNAME: 'family_cookbook_bot',
      MINI_APP_SHORT_NAME: 'cook',
      S3_ENDPOINT: 'http://127.0.0.1:9',
      S3_BUCKET: 'load-test',
      S3_ACCESS_KEY: 'load-test',
      S3_SECRET_KEY: 'load-test-secret',
      MEDIA_CLEANUP_INTERVAL_MIN: '1000000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (d) => output.push(String(d)));
  child.stderr?.on('data', (d) => output.push(String(d)));
  workers.push(child);
  return child;
}

beforeAll(async () => {
  admin = adminPool();
  await resetData(admin);
  // Telegram allows about 30 messages a second for a bot: more is answered with 429. The sender
  // keeps to 25 a second, which leaves a margin.
  bot = await startFakeTelegram({ token: TOKEN, globalPerSecond: 30 });
});
afterAll(async () => {
  // The workers must be gone before the next test file uses the database.
  await Promise.all(
    workers.map(
      (w) =>
        new Promise<void>((done) => {
          if (w.exitCode !== null || w.signalCode !== null) return done();
          const kill = setTimeout(() => w.kill('SIGKILL'), 5000);
          w.once('exit', () => {
            clearTimeout(kill);
            done();
          });
          w.kill('SIGTERM');
        }),
    ),
  );
  await bot.close();
  await admin.end();
});

const until = async (what: () => Promise<boolean>, ms: number) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await what()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};

describe('QA-03: 1000 running timers, 100 ending in the same second', () => {
  it('each of the 100 messages goes exactly once, quickly, and the other 900 timers are untouched', async () => {
    // 100 people who started the bot; 10 running timers each.
    await admin.query(
      `INSERT INTO users (tg_user_id, first_name, bot_started, app_opened_at)
       SELECT 8800000 + g, 'Load ' || g, true, now() FROM generate_series(1, $1) g`,
      [PEOPLE],
    );
    const burstAt = new Date(Date.now() + 6000);
    await admin.query(
      `INSERT INTO timers (user_id, client_timer_id, label, recipe_title, step_number, duration_sec,
                           started_at, ends_at)
       SELECT u.id, gen_random_uuid(), 'Таймер ' || k, 'Нагрузка', 1, d.sec,
              e.at - make_interval(secs => d.sec), e.at
         FROM users u
         CROSS JOIN generate_series(1, $1) k
         CROSS JOIN LATERAL (SELECT CASE WHEN k = 1 THEN $2::timestamptz
                                         ELSE $2::timestamptz + make_interval(mins => 10 + k * 5)
                                    END AS at) e
         CROSS JOIN LATERAL (SELECT 600 + k AS sec) d
        WHERE u.tg_user_id > 8800000`,
      [PER_PERSON, burstAt.toISOString()],
    );
    expect(
      (await admin.query(`SELECT count(*)::int AS n FROM timers WHERE status = 'running'`)).rows[0]
        .n,
    ).toBe(PEOPLE * PER_PERSON);

    startWorker();
    startWorker();

    const allSent = await until(async () => {
      const r = await admin.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM notification_outbox WHERE status = 'sent'`,
      );
      return r.rows[0]!.n >= PEOPLE;
    }, 45_000);
    expect(allSent, output.join('').slice(-2000)).toBe(true);
    await new Promise((r) => setTimeout(r, 2000)); // anything sent twice would show up by now

    // Exactly once: one message per person, one outbox row per timer, the rest still running.
    const perChat = new Map<string, number>();
    for (const m of bot.messages) perChat.set(m.chat_id, (perChat.get(m.chat_id) ?? 0) + 1);
    expect(perChat.size).toBe(PEOPLE);
    expect([...perChat.values()].every((n) => n === 1)).toBe(true);
    const states = await admin.query<{ status: string; n: number }>(
      `SELECT status::text, count(*)::int AS n FROM timers GROUP BY status ORDER BY status`,
    );
    expect(states.rows).toEqual([
      { status: 'fired', n: PEOPLE },
      { status: 'running', n: PEOPLE * (PER_PERSON - 1) },
    ]);

    // How late, as the server measures it (end → sent).
    const h = (await admin.query<{ h: Record<string, number> }>('SELECT delivery_health() AS h'))
      .rows[0]!.h;
    console.log(
      'QA-03 burst of 100:',
      JSON.stringify(h),
      `429s from the stand-in: ${bot.refused429}`,
    );
    expect(h.sent).toBe(PEOPLE);
    expect(h.failed).toBe(0);
    expect(h.overdue_messages).toBe(0);
    // Telegram never had to refuse one (no 429): the sender kept under the bot's limit.
    expect(bot.refused429).toBe(0);
    // 100 messages at 25 a second take 4 s; the timer poll adds up to 1 s. (Before D-058: the
    // last one went 18.5 s late, half of them over 8.8 s.)
    expect(h.max_ms).toBeLessThan(8000);
    expect(h.p50_ms).toBeLessThan(5000);
  }, 90_000);
});
