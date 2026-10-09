import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { loadConfig, type Config } from '../../src/config.js';
import { createPool, type Db } from '../../src/db/pool.js';
import { signInitData, TEST_BOT_TOKEN } from './signInitData.js';

export const NOW = new Date('2026-03-01T12:00:00Z');

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL,
    BOT_TOKEN: TEST_BOT_TOKEN,
    LOG_LEVEL: 'silent',
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

export async function testApp(db: Db): Promise<FastifyInstance> {
  return buildApp({ config: testConfig(), db, now: () => NOW });
}

export async function resetData(db: Db): Promise<void> {
  await db.query('TRUNCATE recipes, book_members, books, users CASCADE');
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
