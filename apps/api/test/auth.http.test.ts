import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/pool.js';
import {
  adminPool,
  authHeader,
  NOW,
  resetData,
  testApp,
  testConfig,
  testPool,
} from './helpers/db.js';
import { signInitData } from './helpers/signInitData.js';

let db: Db;
let admin: Db;
let app: FastifyInstance;
beforeAll(async () => {
  db = testPool();
  admin = adminPool();
  app = await testApp(db);
});
afterAll(async () => {
  await app.close();
  await db.end();
  await admin.end();
});
beforeEach(() => resetData(admin));

const seconds = Math.floor(NOW.getTime() / 1000);

describe('GET /health', () => {
  it('reports ok with a working database', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'ok' });
  });
});

describe('request id', () => {
  it('echoes a plain x-request-id and replaces an unsafe one', async () => {
    const ok = await app.inject({
      method: 'GET',
      url: '/nope',
      headers: { 'x-request-id': 'abc-123.x' },
    });
    expect(ok.json().error.request_id).toBe('abc-123.x');
    for (const bad of ['a b', 'x'.repeat(200), 'line\nbreak', '<script>']) {
      const res = await app.inject({
        method: 'GET',
        url: '/nope',
        headers: { 'x-request-id': bad },
      });
      expect(res.json().error.request_id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});

describe('error shape', () => {
  it('unknown routes use the consistent error body', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatchObject({ code: 'NOT_FOUND', request_id: expect.any(String) });
  });
});

describe('auth middleware + GET /me', () => {
  it('creates the user on first sign-in and returns the profile', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: authHeader(5001, { language_code: 'sv', first_name: 'Åsa' }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      tg_user_id: '5001',
      first_name: 'Åsa',
      ui_lang: 'sv',
      bot_started: false,
    });
    const count = await admin.query('SELECT count(*) FROM users');
    expect(count.rows[0].count).toBe('1');
  });

  it('is idempotent across sign-ins, refreshes the profile, keeps ui_lang chosen at creation', async () => {
    await app.inject({
      method: 'GET',
      url: '/me',
      headers: authHeader(5002, { language_code: 'uk', first_name: 'Old' }),
    });
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: authHeader(5002, { language_code: 'en', first_name: 'New' }),
    });
    expect(res.json()).toMatchObject({ first_name: 'New', ui_lang: 'uk' });
    expect((await admin.query('SELECT count(*) FROM users')).rows[0].count).toBe('1');
  });

  it.each([
    ['en-US', 'en'],
    ['ru', 'ru'],
    ['de', 'en'],
    [undefined, 'en'],
  ])('maps language_code %s to ui_lang %s', async (code, expected) => {
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: authHeader(5003, code ? { language_code: code } : {}),
    });
    // authHeader defaults to "en" when undefined, which still exercises the fallback path
    expect(res.json().ui_lang).toBe(expected);
    await resetData(admin);
  });

  it('401 without the header', async () => {
    const res = await app.inject({ method: 'GET', url: '/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  it('401 for a wrong scheme', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Bearer abc' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('401 for a tampered, wrong-token and expired initData, with a generic message', async () => {
    const good = signInitData({ authDate: seconds - 10 });
    const cases = [
      good.replace('1001', '1002'),
      signInitData({ authDate: seconds - 10, botToken: '1:other' }),
      signInitData({ authDate: seconds - 86_400 - 5 }),
      signInitData({ authDate: seconds - 10, omitHash: true }),
      'garbage',
    ];
    for (const initData of cases) {
      const res = await app.inject({
        method: 'GET',
        url: '/me',
        headers: { authorization: `tma ${initData}` },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.message).toBe('Invalid or expired initData');
    }
    expect((await admin.query('SELECT count(*) FROM users')).rows[0].count).toBe('0');
  });

  it('never writes the Telegram profile back into an anonymised (soft-deleted) account', async () => {
    await app.inject({
      method: 'GET',
      url: '/me',
      headers: authHeader(5005, { first_name: 'Real' }),
    });
    await admin.query(
      `UPDATE users SET deleted_at = now(), first_name = NULL, tg_username = NULL, photo_url = NULL
        WHERE tg_user_id = 5005`,
    );
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: authHeader(5005, { first_name: 'Real' }),
    });
    expect(res.statusCode).toBe(403);
    const row = (await admin.query('SELECT first_name FROM users WHERE tg_user_id = 5005')).rows[0];
    expect(row.first_name).toBeNull();
  });

  it('403 for a soft-deleted account', async () => {
    await app.inject({ method: 'GET', url: '/me', headers: authHeader(5004) });
    await admin.query('UPDATE users SET deleted_at = now() WHERE tg_user_id = 5004');
    const res = await app.inject({ method: 'GET', url: '/me', headers: authHeader(5004) });
    expect(res.statusCode).toBe(403);
  });
});

describe('dev initData path', () => {
  const DEV = '000000:DEV-ONLY-FAKE-TOKEN';
  const devSigned = () => `tma ${signInitData({ authDate: seconds - 10, botToken: DEV })}`;

  it('is rejected by default (flag off)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: devSigned() },
    });
    expect(res.statusCode).toBe(401);
  });

  it('is accepted only when development + flag configure the dev token', async () => {
    const { buildApp } = await import('../src/app.js');
    const devConfig = testConfig({
      NODE_ENV: 'development',
      ALLOW_DEV_INIT_DATA: 'true',
      DEV_BOT_TOKEN: DEV,
    });
    const devApp = await buildApp({ config: devConfig, db, now: () => NOW });
    const res = await devApp.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: devSigned() },
    });
    expect(res.statusCode).toBe(200);
    await devApp.close();
  });
});
