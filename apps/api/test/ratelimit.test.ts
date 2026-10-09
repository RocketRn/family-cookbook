import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/pool.js';
import { adminPool, authHeader, resetData, testApp, testPool } from './helpers/db.js';
import { multipart, png } from './helpers/images.js';

/** D-027: limits per IP, per user (PRD 7.1: 60/min), for uploads, and for failed sign-ins. */
let db: Db;
let admin: Db;
let app: FastifyInstance;
beforeAll(() => {
  db = testPool();
  admin = adminPool();
});
afterAll(async () => {
  await db.end();
  await admin.end();
});
beforeEach(() => resetData(admin));
afterEach(() => app?.close());

const build = async (env: Record<string, string>) => {
  app = await testApp(db, { env });
};
const me = (tg: number, ip = '10.0.0.1') =>
  app.inject({ method: 'GET', url: '/me', headers: authHeader(tg), remoteAddress: ip });

describe('rate limits', () => {
  it('per user: the request over the limit gets 429 RATE_LIMITED with Retry-After; others are unaffected', async () => {
    await build({ RATE_LIMIT_PER_USER: '3' });
    for (let n = 0; n < 3; n++) expect((await me(1)).statusCode).toBe(200);
    const res = await me(1);
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toMatchObject({
      code: 'RATE_LIMITED',
      details: { retry_after_seconds: expect.any(Number) },
    });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect((await me(2)).statusCode).toBe(200); // another user
  });

  it('the default per-user limit is 60 per minute (PRD 7.1)', async () => {
    await build({ RATE_LIMIT_PER_USER: '60' });
    const codes = [];
    for (let n = 0; n < 61; n++) codes.push((await me(3)).statusCode);
    expect(codes.filter((c) => c === 200)).toHaveLength(60);
    expect(codes[60]).toBe(429);
  });

  it('uploads have their own, smaller limit', async () => {
    await build({ RATE_LIMIT_UPLOADS_PER_USER: '1' });
    const send = async () => {
      const m = multipart(await png(20, 20));
      return app.inject({
        method: 'POST',
        url: '/media',
        headers: { ...authHeader(4), ...m.headers },
        payload: m.payload,
      });
    };
    expect((await send()).statusCode).toBe(201);
    const second = await send();
    expect(second.statusCode).toBe(429);
    expect(second.json().error.code).toBe('RATE_LIMITED');
    expect((await me(4)).statusCode).toBe(200); // other requests still work
  });

  it('failed sign-ins per IP: after the limit, bad initData gets 429 instead of 401; valid users still pass', async () => {
    await build({ RATE_LIMIT_AUTH_FAILURES_PER_IP: '2' });
    const bad = () =>
      app.inject({
        method: 'GET',
        url: '/me',
        headers: { authorization: 'tma bogus' },
        remoteAddress: '10.9.9.9',
      });
    expect((await bad()).statusCode).toBe(401);
    expect((await bad()).statusCode).toBe(401);
    expect((await bad()).statusCode).toBe(429);
    expect((await me(5, '10.9.9.9')).statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/me',
          headers: { authorization: 'tma bogus' },
          remoteAddress: '10.1.1.1',
        })
      ).statusCode,
    ).toBe(401);
  });

  it('per IP before any sign-in work, but /health is never limited', async () => {
    await build({ RATE_LIMIT_PER_IP: '2' });
    expect((await me(6, '10.5.5.5')).statusCode).toBe(200);
    expect((await me(7, '10.5.5.5')).statusCode).toBe(200);
    expect((await me(8, '10.5.5.5')).statusCode).toBe(429);
    expect((await me(8, '10.5.5.6')).statusCode).toBe(200);
    for (let n = 0; n < 5; n++) {
      expect(
        (await app.inject({ method: 'GET', url: '/health', remoteAddress: '10.5.5.5' })).statusCode,
      ).toBe(200);
    }
  });
});
