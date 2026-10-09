import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from '../src/db/migrate.js';
import type { Db } from '../src/db/pool.js';
import { testPool } from './helpers/db.js';

let db: Db;
beforeAll(() => {
  db = testPool();
});
afterAll(async () => {
  await migrateUp(db); // leave the schema in place for other files
  await db.end();
});

const tables = async (): Promise<string[]> =>
  (
    await db.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations' ORDER BY 1`,
    )
  ).rows.map((r) => r.tablename);

describe('migrations', () => {
  it('roll back to an empty database and apply again to an empty database', async () => {
    await migrateDown(db, Infinity);
    expect(await tables()).toEqual([]);
    const types = await db.query(
      `SELECT 1 FROM pg_type WHERE typname IN ('ui_lang','book_role','recipe_status','recipe_visibility')`,
    );
    expect(types.rowCount).toBe(0);

    const ran = await migrateUp(db);
    expect(ran).toEqual(['0001_users', '0002_books_recipes_rls']);
    expect(await migrateUp(db)).toEqual([]); // idempotent
  });

  it('creates only the Sprint 1 tables (no Stage 2-4 or later-sprint tables)', async () => {
    expect(await tables()).toEqual(['book_members', 'books', 'recipes', 'users']);
  });

  it('enforces one book per user and one owner per book', async () => {
    await db.query('TRUNCATE recipes, book_members, books, users CASCADE');
    const u = (
      await db.query<{ id: string }>(`INSERT INTO users (tg_user_id) VALUES (1), (2) RETURNING id`)
    ).rows;
    const [u1, u2] = [u[0]!.id, u[1]!.id];
    const b1 = (
      await db.query<{ id: string }>(
        `INSERT INTO books (title, owner_id, invite_code) VALUES ('a', $1, 'c1') RETURNING id`,
        [u1],
      )
    ).rows[0]!.id;
    const b2 = (
      await db.query<{ id: string }>(
        `INSERT INTO books (title, owner_id, invite_code) VALUES ('b', $1, 'c2') RETURNING id`,
        [u2],
      )
    ).rows[0]!.id;
    await db.query(`INSERT INTO book_members (book_id, user_id, role) VALUES ($1, $2, 'owner')`, [
      b1,
      u1,
    ]);
    await expect(
      db.query(`INSERT INTO book_members (book_id, user_id, role) VALUES ($1, $2, 'member')`, [
        b2,
        u1,
      ]),
    ).rejects.toThrow(/book_members_one_book_per_user/);
    await expect(
      db.query(`INSERT INTO book_members (book_id, user_id, role) VALUES ($1, $2, 'owner')`, [
        b1,
        u2,
      ]),
    ).rejects.toThrow(/book_members_one_owner/);
  });
});
