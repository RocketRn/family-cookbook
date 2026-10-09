import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/pool.js';
import { withUser } from '../src/db/tx.js';
import { adminPool, resetData, testApp, testPool } from './helpers/db.js';
import {
  caller,
  family,
  KEEPER,
  MEMBER,
  OUTSIDER,
  timerBody,
  type Family,
} from './helpers/cooking.js';

/** BE-09 server timers: API, limits, ownership (PRD 4.6, 3.3; D-040). */
let db: Db;
let admin: Db;
let app: FastifyInstance;
let call: ReturnType<typeof caller>;
let fam: Family;
beforeAll(async () => {
  db = testPool();
  admin = adminPool();
  app = await testApp(db);
  call = caller(app);
});
afterAll(async () => {
  await app.close();
  await db.end();
  await admin.end();
});
beforeEach(async () => {
  await resetData(admin);
  fam = await family(app);
});

const start = (tg: number, over: Record<string, unknown> = {}) =>
  call('POST', '/timers', tg, timerBody(over));
const seconds = (a: string, b: string) => (Date.parse(a) - Date.parse(b)) / 1000;

describe('POST /timers', () => {
  it('starts a timer for a step the user can read; answers ends_at and the server clock', async () => {
    const before = Date.now();
    const res = await start(MEMBER, {
      recipe_id: fam.bookRecipeId,
      step_id: fam.stepIds[1],
      duration_sec: 5400,
    });
    expect(res.statusCode, res.body).toBe(201);
    const { timer, server_now } = res.json();
    expect(timer).toMatchObject({
      status: 'running',
      label: 'Тушить',
      duration_sec: 5400,
      recipe_id: fam.bookRecipeId,
      step_id: fam.stepIds[1],
    });
    expect(seconds(timer.ends_at, timer.started_at)).toBe(5400);
    expect(Math.abs(Date.parse(server_now) - before)).toBeLessThan(5000);
    // A snapshot for the message: the worker never reads recipes.
    const row = (
      await admin.query('SELECT recipe_title, step_number FROM timers WHERE id = $1', [timer.id])
    ).rows[0];
    expect(row).toEqual({ recipe_title: 'Голубцы', step_number: 2 });
  });

  it('the same client_timer_id again returns the same timer (a retried request)', async () => {
    const body = timerBody();
    const first = await call('POST', '/timers', MEMBER, body);
    const again = await call('POST', '/timers', MEMBER, body);
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(200);
    expect(again.json().timer.id).toBe(first.json().timer.id);
    expect((await admin.query('SELECT count(*)::int AS n FROM timers')).rows[0].n).toBe(1);
    // Another person may use the same client id: it is unique per person.
    expect((await call('POST', '/timers', KEEPER, body)).statusCode).toBe(201);
  });

  it('limits: 1 s to 24 h, a label of 1 to 100 characters, at most 10 running per person', async () => {
    for (const duration_sec of [0, 86401, 1.5]) {
      expect((await start(MEMBER, { duration_sec })).statusCode, String(duration_sec)).toBe(400);
    }
    expect((await start(MEMBER, { label: '' })).statusCode).toBe(400);
    expect((await start(MEMBER, { label: 'я'.repeat(101) })).statusCode).toBe(400);
    expect((await start(MEMBER, { duration_sec: 1 })).statusCode).toBe(201);
    expect((await start(MEMBER, { duration_sec: 86400 })).statusCode).toBe(201);
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) ids.push((await start(MEMBER)).json().timer.id);
    const eleventh = await start(MEMBER);
    expect(eleventh.statusCode).toBe(409);
    expect(eleventh.json().error.code).toBe('TOO_MANY_TIMERS');
    // Someone else's timers do not count; a cancelled one frees a place.
    expect((await start(KEEPER)).statusCode).toBe(201);
    expect((await call('DELETE', `/timers/${ids[0]}`, MEMBER)).statusCode).toBe(204);
    expect((await start(MEMBER)).statusCode).toBe(201);
  });

  it('ten requests at the same moment cannot make an eleventh timer', async () => {
    for (let i = 0; i < 5; i++) await start(MEMBER);
    const results = await Promise.all(Array.from({ length: 10 }, () => start(MEMBER)));
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(5);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(5);
  });

  it('refuses a recipe the user cannot read, a step of another recipe, and another cook session', async () => {
    const hidden = await start(MEMBER, { recipe_id: fam.outsiderRecipeId });
    expect(hidden.statusCode).toBe(404);
    const outsider = await start(OUTSIDER, {
      recipe_id: fam.bookRecipeId,
      step_id: fam.stepIds[0],
    });
    expect(outsider.statusCode).toBe(404);
    const mismatch = await start(MEMBER, {
      recipe_id: fam.outsiderRecipeId,
      step_id: fam.stepIds[0],
    });
    expect(mismatch.statusCode).toBe(404);
    const noRecipe = await start(MEMBER, { step_id: fam.stepIds[0] });
    expect(noRecipe.statusCode).toBe(400);
    const session = (
      await call('POST', '/cook-sessions', KEEPER, {
        recipe_id: fam.bookRecipeId,
        recipe_version: 1,
      })
    ).json();
    const foreign = await start(MEMBER, {
      recipe_id: fam.bookRecipeId,
      cook_session_id: session.id,
    });
    expect(foreign.statusCode).toBe(404);
    expect((await admin.query('SELECT count(*)::int AS n FROM timers')).rows[0].n).toBe(0);
  });

  it('an offline start counts from when it really started; one already over is refused', async () => {
    const startedAt = new Date(Date.now() - 100_000).toISOString();
    const res = await start(MEMBER, { started_at: startedAt, duration_sec: 600 });
    expect(res.statusCode).toBe(201);
    expect(Math.abs(seconds(res.json().timer.started_at, startedAt))).toBeLessThan(1);
    expect(seconds(res.json().timer.ends_at, startedAt)).toBeCloseTo(600, 0);
    const over = await start(MEMBER, {
      started_at: new Date(Date.now() - 700_000).toISOString(),
      duration_sec: 600,
    });
    expect(over.statusCode).toBe(422);
    expect(over.json().error.code).toBe('TIMER_EXPIRED');
    // A clock in the future cannot make a timer longer than asked.
    const future = await start(MEMBER, {
      started_at: new Date(Date.now() + 3_600_000).toISOString(),
      duration_sec: 60,
    });
    expect(Date.parse(future.json().timer.ends_at) - Date.now()).toBeLessThan(65_000);
  });
});

describe('GET /timers, +1 min and cancel', () => {
  it('lists only my running and just-ended timers, with the server clock', async () => {
    const mine = (await start(MEMBER)).json().timer;
    await start(KEEPER);
    const cancelled = (await start(MEMBER)).json().timer;
    await call('DELETE', `/timers/${cancelled.id}`, MEMBER);
    const res = await call('GET', '/timers?active=1', MEMBER);
    expect(res.statusCode).toBe(200);
    expect(res.json().timers.map((t: { id: string }) => t.id)).toEqual([mine.id]);
    expect(typeof res.json().server_now).toBe('string');
  });

  it('+1 min moves the end and the duration; cancel stops it; neither works twice', async () => {
    const t = (await start(MEMBER, { duration_sec: 300 })).json().timer;
    const ext = await call('POST', `/timers/${t.id}/extend`, MEMBER, { seconds: 60 });
    expect(ext.statusCode).toBe(200);
    expect(ext.json().timer.duration_sec).toBe(360);
    expect(seconds(ext.json().timer.ends_at, t.ends_at)).toBe(60);
    expect((await call('DELETE', `/timers/${t.id}`, MEMBER)).statusCode).toBe(204);
    const again = await call('DELETE', `/timers/${t.id}`, MEMBER);
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('TIMER_NOT_RUNNING');
    expect((await call('POST', `/timers/${t.id}/extend`, MEMBER, { seconds: 60 })).statusCode).toBe(
      409,
    );
    const long = (await start(MEMBER, { duration_sec: 86_400 })).json().timer;
    expect(
      (await call('POST', `/timers/${long.id}/extend`, MEMBER, { seconds: 60 })).statusCode,
    ).toBe(409);
  });

  it('nobody else can see, cancel or extend my timer: not someone in my book, not an outsider', async () => {
    const t = (await start(MEMBER, { recipe_id: fam.bookRecipeId })).json().timer;
    for (const other of [KEEPER, OUTSIDER]) {
      expect((await call('DELETE', `/timers/${t.id}`, other)).statusCode).toBe(404);
      expect(
        (await call('POST', `/timers/${t.id}/extend`, other, { seconds: 60 })).statusCode,
      ).toBe(404);
      const list = (await call('GET', '/timers?active=1', other)).json().timers;
      expect(list.map((x: { id: string }) => x.id)).not.toContain(t.id);
    }
    expect(
      (await admin.query('SELECT status FROM timers WHERE id = $1', [t.id])).rows[0].status,
    ).toBe('running');
    expect((await call('DELETE', `/timers/${randomUUID()}`, MEMBER)).statusCode).toBe(404);
  });
});

describe('the database enforces it too (row-level security, no direct changes)', () => {
  const userId = async (tg: number) =>
    (await admin.query('SELECT id FROM users WHERE tg_user_id = $1', [tg])).rows[0].id as string;

  it('another user reads none of my timers or cook sessions, and cannot insert one in my name', async () => {
    const t = (await start(MEMBER)).json().timer;
    await call('POST', '/cook-sessions', MEMBER, {
      recipe_id: fam.bookRecipeId,
      recipe_version: 1,
    });
    const member = await userId(MEMBER);
    const keeper = await userId(KEEPER);
    const seen = await withUser(db, { userId: keeper }, async (tx) => ({
      timers: (await tx.query('SELECT id FROM timers')).rowCount,
      sessions: (await tx.query('SELECT id FROM cook_sessions')).rowCount,
    }));
    expect(seen).toEqual({ timers: 0, sessions: 0 });
    await expect(
      withUser(db, { userId: keeper }, (tx) =>
        tx.query(
          `INSERT INTO timers (user_id, client_timer_id, label, duration_sec, started_at, ends_at)
           VALUES ($1, gen_random_uuid(), 'x', 60, now(), now() + interval '60 s')`,
          [member],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    expect(t.status).toBe('running');
  });

  it('a user cannot mark a timer fired, change it after it ended, or re-run it', async () => {
    const t = (await start(MEMBER)).json().timer;
    const member = await userId(MEMBER);
    await expect(
      withUser(db, { userId: member }, (tx) =>
        tx.query(`UPDATE timers SET status = 'fired', fired_at = now() WHERE id = $1`, [t.id]),
      ),
    ).rejects.toThrow(/permission denied/);
    // Even the owner of the tables cannot move a fired timer back or fire it twice.
    await admin.query(`UPDATE timers SET status = 'fired', fired_at = now() WHERE id = $1`, [t.id]);
    await expect(
      admin.query(`UPDATE timers SET status = 'running', fired_at = NULL WHERE id = $1`, [t.id]),
    ).rejects.toThrow(/cannot go from fired to running/);
    await expect(
      admin.query(`UPDATE timers SET fired_at = now() + interval '1 s' WHERE id = $1`, [t.id]),
    ).rejects.toThrow(/already fired/);
    await expect(
      admin.query(`UPDATE timers SET status = 'cancelled', cancelled_at = now() WHERE id = $1`, [
        t.id,
      ]),
    ).rejects.toThrow(/cannot go from fired to cancelled/);
  });
});

describe('cook sessions (analytics; progress stays on the device)', () => {
  it('starts, records the furthest step, finishes; only for recipes I can read; only mine', async () => {
    const res = await call('POST', '/cook-sessions', MEMBER, {
      recipe_id: fam.bookRecipeId,
      recipe_version: 1,
      scale_factor: 0.625,
    });
    expect(res.statusCode, res.body).toBe(201);
    const s = res.json();
    expect(s).toMatchObject({ state: 'active', max_step_index: 0, scale_factor: 0.625 });
    const step = await call('PATCH', `/cook-sessions/${s.id}`, MEMBER, { max_step_index: 1 });
    expect(step.json()).toMatchObject({ max_step_index: 1, state: 'active' });
    const done = await call('PATCH', `/cook-sessions/${s.id}`, MEMBER, { state: 'finished' });
    expect(done.json().state).toBe('finished');
    expect(done.json().finished_at).toBeTruthy();
    expect(
      (await call('PATCH', `/cook-sessions/${s.id}`, KEEPER, { max_step_index: 1 })).statusCode,
    ).toBe(404);
    const hidden = await call('POST', '/cook-sessions', MEMBER, {
      recipe_id: fam.outsiderRecipeId,
      recipe_version: 1,
    });
    expect(hidden.statusCode).toBe(404);
  });
});
