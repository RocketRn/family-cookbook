import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/pool.js';
import { adminPool, resetData, testApp, testPool } from './helpers/db.js';
import { caller, family, KEEPER, OUTSIDER, timerBody, type Family } from './helpers/cooking.js';

/**
 * FE-11 / S6-3 (PRD 3.3, UC-08; owner's Sprint 6 answer 2): someone outside the book who opens a
 * "by link" recipe may read it, recalculate it and cook it with timers. No saving and no reactions
 * for now. Timers and cooking sessions take the recipe's share token, like reading does.
 */
let db: Db;
let admin: Db;
let app: FastifyInstance;
let call: ReturnType<typeof caller>;
let fam: Family;
let token: string;

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
  fam = await family(app);
  const r = await call('PATCH', `/recipes/${fam.bookRecipeId}`, KEEPER, { visibility: 'link' });
  token = r.json().share_token;
  expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
});

const timer = (over: Record<string, unknown> = {}) =>
  call('POST', '/timers', OUTSIDER, {
    ...timerBody(),
    recipe_id: fam.bookRecipeId,
    step_id: fam.stepIds[1],
    ...over,
  });

describe('a guest with the recipe’s link', () => {
  it('reads it by the link', async () => {
    const r = await call('GET', `/r/${token}`, OUTSIDER);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ id: fam.bookRecipeId, title: 'Голубцы', is_mine: false });
    expect(r.json().share_token).toBeUndefined(); // only the author sees the token itself
  });

  it('starts a timer of a step: with the token it works, without it the recipe is not found', async () => {
    const ok = await timer({ share_token: token });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json().timer).toMatchObject({
      recipe_id: fam.bookRecipeId,
      recipe_title: 'Голубцы',
      step_number: 2,
    });
    expect((await timer()).statusCode).toBe(404);
    expect((await timer({ share_token: 'wrongwrongwrongwrongwrong' })).statusCode).toBe(404);
    // The timer is the guest's own: listed, +1 min and cancel work as for anyone.
    const list = (await call('GET', '/timers?active=1', OUTSIDER)).json();
    expect(list.timers).toHaveLength(1);
  });

  it('a cooking session too (start and progress)', async () => {
    const s = await call('POST', '/cook-sessions', OUTSIDER, {
      recipe_id: fam.bookRecipeId,
      recipe_version: 1,
      share_token: token,
    });
    expect(s.statusCode, s.body).toBe(201);
    const p = await call('PATCH', `/cook-sessions/${s.json().id}`, OUTSIDER, {
      max_step_index: 1,
      share_token: token,
    });
    expect(p.statusCode, p.body).toBe(200);
    expect(
      (
        await call('POST', '/cook-sessions', OUTSIDER, {
          recipe_id: fam.bookRecipeId,
          recipe_version: 1,
        })
      ).statusCode,
    ).toBe(404);
  });

  it('may not react or save (owner’s Sprint 6 answer 2)', async () => {
    const react = await call(
      'POST',
      `/recipes/${fam.bookRecipeId}/reactions?share_token=${token}`,
      OUTSIDER,
      { kind: 'heart' },
    );
    expect(react.statusCode).toBe(404);
    expect(
      (await call('POST', `/recipes/${fam.bookRecipeId}/save?share_token=${token}`, OUTSIDER))
        .statusCode,
    ).toBe(404);
    const counts = await admin.query('SELECT count(*)::int AS n FROM reactions');
    expect(counts.rows[0].n).toBe(0);
  });

  it('once the author stops sharing by link, the token opens nothing, timers included', async () => {
    await call('PATCH', `/recipes/${fam.bookRecipeId}`, KEEPER, { visibility: 'book' });
    expect((await call('GET', `/r/${token}`, OUTSIDER)).statusCode).toBe(404);
    expect((await timer({ share_token: token })).statusCode).toBe(404);
  });

  it('a token is only for that recipe', async () => {
    expect(
      (await timer({ share_token: token, recipe_id: fam.outsiderRecipeId, step_id: undefined }))
        .statusCode,
    ).toBe(201); // the guest's own recipe, readable anyway
    expect(
      (await timer({ share_token: token, recipe_id: randomUUID(), step_id: undefined })).statusCode,
    ).toBe(404);
  });
});
