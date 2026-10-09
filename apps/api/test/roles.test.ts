import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/pool.js';
import { ensureRuntimeRole, verifyRuntimeRole } from '../src/db/roles.js';
import { withSystem, withUser } from '../src/db/tx.js';
import { adminPool, insertUser, resetData, testPool } from './helpers/db.js';

/** D-013: the API's own database user can do nothing on its own and cannot bypass RLS. */
let db: Db;
let admin: Db;
beforeAll(() => {
  db = testPool();
  admin = adminPool();
});
afterAll(async () => {
  await db.end();
  await admin.end();
});
beforeEach(() => resetData(admin));

describe('API database user', () => {
  it('passes the startup safety check; the owner user does not', async () => {
    expect(await verifyRuntimeRole(db)).toEqual([]);
    const ownerProblems = await verifyRuntimeRole(admin);
    expect(ownerProblems.join('\n')).toMatch(/owns tables/);
  });

  it('is not a superuser, has no BYPASSRLS, is NOINHERIT and owns nothing', async () => {
    const r = await db.query(
      `SELECT rolsuper, rolbypassrls, rolinherit, rolcreatedb, rolcreaterole,
              (SELECT count(*) FROM pg_class c WHERE c.relowner = r.oid)::int AS owned
         FROM pg_roles r WHERE rolname = current_user`,
    );
    expect(r.rows[0]).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolinherit: false,
      rolcreatedb: false,
      rolcreaterole: false,
      owned: 0,
    });
  });

  it('cannot read or write any table without switching role', async () => {
    for (const sql of [
      'SELECT 1 FROM users',
      'SELECT 1 FROM recipes',
      'SELECT 1 FROM books',
      'SELECT 1 FROM schema_migrations',
      `INSERT INTO users (tg_user_id) VALUES (1)`,
    ]) {
      await expect(db.query(sql)).rejects.toThrow(/permission denied/);
    }
  });

  it('a RESET ROLE inside a user transaction (e.g. via SQL injection) leaves it with nothing', async () => {
    const me = await insertUser(admin, 1);
    await expect(
      withUser(db, { userId: me }, async (tx) => {
        await tx.query('RESET ROLE');
        return tx.query('SELECT * FROM users');
      }),
    ).rejects.toThrow(/permission denied/);
  });

  it('cannot escalate to the owner user', async () => {
    const owner = (await admin.query<{ u: string }>('SELECT current_user AS u')).rows[0]!.u;
    await expect(db.query(`SET ROLE "${owner}"`)).rejects.toThrow(/permission denied/);
  });
});

describe('cookbook_system: only what its column grants allow', () => {
  it('cannot change identity or content columns, insert recipes, or touch the migrations table', async () => {
    const author = await insertUser(admin, 2);
    await admin.query(`INSERT INTO recipes (author_id, title) VALUES ($1, 'r')`, [author]);
    for (const sql of [
      `UPDATE users SET tg_user_id = 5`,
      `UPDATE users SET deleted_at = now()`,
      `UPDATE recipes SET title = 'x'`,
      `UPDATE recipes SET author_id = author_id`,
      `INSERT INTO recipes (author_id, title) VALUES ('${author}', 'x')`,
      `DELETE FROM recipes`,
      `DELETE FROM users`,
      `UPDATE books SET owner_id = owner_id`,
      `SELECT 1 FROM schema_migrations`,
      `DROP TABLE recipes`,
    ]) {
      await expect(
        withSystem(db, (tx) => tx.query(sql)),
        sql,
      ).rejects.toThrow(/permission denied|must be owner/);
    }
  });

  it('can do exactly the membership work the API needs', async () => {
    const u = await insertUser(admin, 3);
    await withSystem(db, async (tx) => {
      const b = await tx.query<{ id: string }>(
        `INSERT INTO books (title, owner_id, invite_code) VALUES ('t', $1, 'code-x') RETURNING id`,
        [u],
      );
      await tx.query(`INSERT INTO book_members (book_id, user_id, role) VALUES ($1, $2, 'owner')`, [
        b.rows[0]!.id,
        u,
      ]);
      await tx.query(`UPDATE books SET invite_code = 'code-y'`);
      await tx.query(
        `UPDATE recipes SET visibility = 'private', book_id = NULL, updated_at = now()`,
      );
      await tx.query(`DELETE FROM book_members`);
    });
  });
});

describe('ensureRuntimeRole', () => {
  it('refuses to make the owner user the API user', async () => {
    const ownerUrl = process.env.MIGRATION_DATABASE_URL!;
    await expect(ensureRuntimeRole(admin, ownerUrl)).rejects.toThrow(
      /same user as MIGRATION_DATABASE_URL/,
    );
  });

  it('is idempotent', async () => {
    await ensureRuntimeRole(admin, process.env.DATABASE_URL!);
    await ensureRuntimeRole(admin, process.env.DATABASE_URL!);
    expect(await verifyRuntimeRole(db)).toEqual([]);
  });
});
