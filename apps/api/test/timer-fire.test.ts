import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/pool.js';
import { cleanupFinished, fireDueTimers } from '../src/timers/fire.js';
import { adminPool, insertUser, resetData, testPool } from './helpers/db.js';

/** BE-09 worker: a due timer fires exactly once, whatever happens (PRD 4.6; D-040). */
let db: Db;
let db2: Db;
let admin: Db;
let user: string;
beforeAll(() => {
  db = testPool();
  db2 = testPool(); // a second worker process
  admin = adminPool();
});
afterAll(async () => {
  await Promise.all([db.end(), db2.end(), admin.end()]);
});
beforeEach(async () => {
  await resetData(admin);
  user = await insertUser(admin, 9201);
});

/** A running timer that ended `endedAgoSec` ago (negative: still running). */
async function timer(
  over: { endedAgoSec?: number; label?: string; title?: string | null; step?: number | null } = {},
): Promise<string> {
  const ago = over.endedAgoSec ?? 1;
  const r = await admin.query<{ id: string }>(
    `INSERT INTO timers (user_id, client_timer_id, label, recipe_title, step_number, duration_sec,
                         started_at, ends_at)
     VALUES ($1, gen_random_uuid(), $2, $3, $4, 60,
             now() - make_interval(secs => $5 + 60), now() - make_interval(secs => $5))
     RETURNING id`,
    [
      user,
      over.label ?? 'Тушить',
      over.title === undefined ? 'Голубцы' : over.title,
      over.step ?? 2,
      ago,
    ],
  );
  return r.rows[0]!.id;
}
const outbox = async () =>
  (
    await admin.query(
      `SELECT type, dedupe_key, priority, status, payload, recipient_user_id FROM notification_outbox
        ORDER BY created_at`,
    )
  ).rows;
const status = async (id: string) =>
  (await admin.query('SELECT status, fired_at FROM timers WHERE id = $1', [id])).rows[0];

describe('firing due timers', () => {
  it('a due timer fires once: one message, first in the queue, with the snapshot', async () => {
    const id = await timer();
    const notYet = await timer({ endedAgoSec: -300 });
    const first = await fireDueTimers(db);
    expect(first.fired.map((f) => f.id)).toEqual([id]);
    expect((await status(id)).status).toBe('fired');
    expect((await status(notYet)).status).toBe('running');
    expect(await outbox()).toEqual([
      {
        type: 'timer_fired',
        dedupe_key: `timer:${id}`,
        priority: 0,
        status: 'pending',
        recipient_user_id: user,
        payload: {
          timer_id: id,
          label: 'Тушить',
          recipe_id: null,
          recipe_title: 'Голубцы',
          step_number: 2,
          // S6-4: the timer's end, to measure how late the message is (D-057).
          ends_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        },
      },
    ]);
    expect((await fireDueTimers(db)).fired).toEqual([]);
    expect(await outbox()).toHaveLength(1);
  });

  it('two workers at the same time fire each of 40 timers exactly once', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 40; i++) ids.add(await timer());
    const fired: string[] = [];
    for (let round = 0; round < 5; round++) {
      const [a, b] = await Promise.all([
        fireDueTimers(db, { limit: 7 }),
        fireDueTimers(db2, { limit: 7 }),
      ]);
      fired.push(...a.fired.map((f) => f.id), ...b.fired.map((f) => f.id));
    }
    while (true) {
      const more = await fireDueTimers(db);
      if (!more.fired.length) break;
      fired.push(...more.fired.map((f) => f.id));
    }
    expect(fired).toHaveLength(40);
    expect(new Set(fired)).toEqual(ids);
    const rows = await outbox();
    expect(rows).toHaveLength(40);
    expect(new Set(rows.map((r) => r.dedupe_key)).size).toBe(40);
  });

  it('a timer that ended while the worker was down fires at the next start, once, marked late', async () => {
    const id = await timer({ endedAgoSec: 600 });
    // "Restart": a fresh connection pool, as a new worker process would have.
    const restarted = testPool();
    try {
      const r = await fireDueTimers(restarted);
      expect(r.fired).toEqual([{ id, lateSec: expect.any(Number) }]);
      expect(r.fired[0]!.lateSec).toBeGreaterThanOrEqual(599);
      expect((await fireDueTimers(restarted)).fired).toEqual([]);
      expect((await fireDueTimers(db)).fired).toEqual([]);
    } finally {
      await restarted.end();
    }
    expect(await outbox()).toHaveLength(1);
  });

  it('a cancelled timer never fires; a fired one is never queued twice even by hand', async () => {
    const cancelled = await timer();
    await admin.query(
      `UPDATE timers SET status = 'cancelled', cancelled_at = now() WHERE id = $1`,
      [cancelled],
    );
    const id = await timer();
    await fireDueTimers(db);
    expect((await status(cancelled)).status).toBe('cancelled');
    await expect(
      admin.query(
        `INSERT INTO notification_outbox (type, recipient_user_id, payload, dedupe_key)
         VALUES ('timer_fired', $1, '{}', $2)`,
        [user, `timer:${id}`],
      ),
    ).rejects.toThrow(/duplicate key/);
    expect(await outbox()).toHaveLength(1);
  });

  it('timers muted in the profile fire without a message', async () => {
    await admin.query(
      `UPDATE users SET notify_prefs = notify_prefs || '{"timers": false}' WHERE id = $1`,
      [user],
    );
    const id = await timer();
    expect((await fireDueTimers(db)).fired.map((f) => f.id)).toEqual([id]);
    expect(await outbox()).toEqual([]);
  });

  it('finished timers are removed after 7 days; running and recent ones stay', async () => {
    const old = await timer({ endedAgoSec: 8 * 86400 });
    const recent = await timer();
    await fireDueTimers(db);
    await admin.query(
      `ALTER TABLE timers DISABLE TRIGGER timers_transition;
       UPDATE timers SET fired_at = now() - interval '8 days' WHERE id = '${old}';
       ALTER TABLE timers ENABLE TRIGGER timers_transition;`,
    );
    const running = await timer({ endedAgoSec: -600 });
    expect(await cleanupFinished(db)).toMatchObject({ timers: 1 });
    const left = (await admin.query('SELECT id FROM timers ORDER BY created_at')).rows.map(
      (r) => r.id,
    );
    expect(left.sort()).toEqual([recent, running].sort());
  });
});
