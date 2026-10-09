import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { loadConfig, type Config } from '../../src/config.js';
import { createPool, type Db } from '../../src/db/pool.js';
import { MemoryStorage, type ObjectStorage } from '../../src/storage/storage.js';
import { signInitData, TEST_BOT_TOKEN } from './signInitData.js';

export const NOW = new Date('2026-03-01T12:00:00Z');

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL,
    BOT_TOKEN: TEST_BOT_TOKEN,
    LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'silent',
    S3_ENDPOINT: 'http://localhost:8333',
    S3_BUCKET: 'cookbook-test',
    S3_ACCESS_KEY: 'test-access',
    S3_SECRET_KEY: 'test-secret',
    // Generous by default; the rate-limit tests build an app with small limits.
    RATE_LIMIT_PER_USER: '100000',
    RATE_LIMIT_PER_IP: '100000',
    RATE_LIMIT_UPLOADS_PER_USER: '100000',
    RATE_LIMIT_AUTH_FAILURES_PER_IP: '100000',
    ...overrides,
  });
}

/** What the app under test uses: the restricted API user (DATABASE_URL). */
export function testPool(): Db {
  return createPool(process.env.DATABASE_URL!);
}

/** Owner user (MIGRATION_DATABASE_URL): schema resets, fixtures and assertions on raw tables. */
export function adminPool(): Db {
  return createPool(process.env.MIGRATION_DATABASE_URL!);
}

export async function testApp(
  db: Db,
  opts: { storage?: ObjectStorage; env?: Record<string, string> } = {},
): Promise<FastifyInstance> {
  return buildApp({
    config: testConfig(opts.env),
    db,
    now: () => NOW,
    storage: opts.storage ?? new MemoryStorage(),
  });
}

export async function resetData(db: Db): Promise<void> {
  await db.query('TRUNCATE recipes, book_members, books, users CASCADE');
  await db.query('DELETE FROM tags WHERE custom_name IS NOT NULL');
}

/** Authorization header for a Telegram user, valid at NOW. */
export function authHeader(
  tgUserId: number,
  extra: { language_code?: string; first_name?: string } = {},
) {
  const initData = signInitData({
    authDate: Math.floor(NOW.getTime() / 1000) - 10,
    user: {
      id: tgUserId,
      first_name: extra.first_name ?? `User${tgUserId}`,
      language_code: extra.language_code ?? 'en',
    },
  });
  return { authorization: `tma ${initData}` };
}

export async function insertUser(db: Db, tgUserId: number): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO users (tg_user_id, first_name) VALUES ($1, $2) RETURNING id`,
    [tgUserId, `User${tgUserId}`],
  );
  return r.rows[0]!.id;
}

export const uniqueToken = (): string => randomUUID().replace(/-/g, '');
