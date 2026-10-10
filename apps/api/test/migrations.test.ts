import { cp, mkdtemp, rm, unlink, appendFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, migrateDown, migrateUp } from '../src/db/migrate.js';
import type { Db } from '../src/db/pool.js';
import { ensureRuntimeRole } from '../src/db/roles.js';
import { syncUnits } from '../src/db/units.js';
import { adminPool } from './helpers/db.js';

const ALL = [
  '0001_users',
  '0002_books_recipes_rls',
  '0003_runtime_roles_users_rls',
  '0004_recipe_content',
  '0005_media',
  '0006_search',
  '0007_timers_outbox',
  '0008_bot_updates',
  '0009_reactions',
];
const TABLES = [
  'book_members',
  'books',
  'cook_sessions',
  'media',
  'notification_outbox',
  'outbox_gates',
  'reactions',
  'recipe_ingredients',
  'recipe_steps',
  'recipe_tags',
  'recipe_videos',
  'recipes',
  'step_ingredients',
  'step_timers',
  'tags',
  'tg_updates',
  'timers',
  'units',
  'users',
];

let admin: Db;
beforeAll(() => {
  admin = adminPool();
});
afterAll(async () => {
  // leave the schema and the API user in place for the other test files
  await migrateUp(admin);
  await syncUnits(admin);
  await ensureRuntimeRole(admin, process.env.DATABASE_URL!);
  await admin.end();
});

const tables = async (): Promise<string[]> =>
  (
    await admin.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations' ORDER BY 1`,
    )
  ).rows.map((r) => r.tablename);

describe('migrations', () => {
  it('roll back to an empty database and apply again to an empty database', async () => {
    await migrateDown(admin, Infinity);
    expect(await tables()).toEqual([]);
    const leftovers = await admin.query(
      `SELECT typname FROM pg_type WHERE typname IN ('ui_lang','book_role','recipe_status','recipe_visibility')
       UNION ALL
       SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace`,
    );
    expect(leftovers.rows).toEqual([]);

    expect(await migrateUp(admin)).toEqual(ALL);
    expect(await migrateUp(admin)).toEqual([]); // idempotent
  });

  it('rolls back one step at a time and re-applies (each down file is the inverse of its up)', async () => {
    for (let i = ALL.length - 1; i >= 0; i--) {
      expect(await migrateDown(admin, 1)).toEqual([ALL[i]]);
    }
    expect(await migrateUp(admin)).toEqual(ALL);
  });

  it('creates only the tables of the sprints so far (no Stage 2-4 or later-sprint tables)', async () => {
    expect(await tables()).toEqual(TABLES);
  });

  it('has row-level security enabled on every application table', async () => {
    const r = await admin.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT c.relname, c.relrowsecurity FROM pg_class c
        WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname <> 'schema_migrations'
        ORDER BY 1`,
    );
    expect(r.rows.filter((x) => !x.relrowsecurity)).toEqual([]);
    expect(r.rows.map((x) => x.relname)).toEqual(TABLES);
  });

  it('stores a checksum and refuses to run if an applied migration file was edited', async () => {
    const rows = await admin.query<{ checksum: string | null }>(
      'SELECT checksum FROM schema_migrations',
    );
    expect(rows.rows.every((r) => r.checksum && r.checksum.length === 64)).toBe(true);

    const dir = await mkdtemp(path.join(os.tmpdir(), 'migrations-'));
    try {
      await cp(MIGRATIONS_DIR, dir, { recursive: true });
      await appendFile(path.join(dir, '0001_users.up.sql'), '\n-- edited after being applied\n');
      await expect(migrateUp(admin, { dir })).rejects.toThrow(
        /0001_users was modified after it was applied/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses a migration without a .down.sql before applying anything', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'migrations-'));
    try {
      await cp(MIGRATIONS_DIR, dir, { recursive: true });
      await unlink(path.join(dir, '0004_recipe_content.down.sql'));
      await expect(migrateUp(admin, { dir })).rejects.toThrow(
        /0004_recipe_content has no \.down\.sql/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('enforces one book per user and one owner per book', async () => {
    await admin.query('TRUNCATE recipes, book_members, books, users CASCADE');
    await syncUnits(admin);
    const u = (
      await admin.query<{ id: string }>(
        `INSERT INTO users (tg_user_id) VALUES (1), (2) RETURNING id`,
      )
    ).rows;
    const [u1, u2] = [u[0]!.id, u[1]!.id];
    const book = async (title: string, owner: string, code: string) =>
      (
        await admin.query<{ id: string }>(
          `INSERT INTO books (title, owner_id, invite_code) VALUES ($1, $2, $3) RETURNING id`,
          [title, owner, code],
        )
      ).rows[0]!.id;
    const b1 = await book('a', u1, 'c1');
    const b2 = await book('b', u2, 'c2');
    await admin.query(
      `INSERT INTO book_members (book_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [b1, u1],
    );
    await expect(
      admin.query(`INSERT INTO book_members (book_id, user_id, role) VALUES ($1, $2, 'member')`, [
        b2,
        u1,
      ]),
    ).rejects.toThrow(/book_members_one_book_per_user/);
    await expect(
      admin.query(`INSERT INTO book_members (book_id, user_id, role) VALUES ($1, $2, 'owner')`, [
        b1,
        u2,
      ]),
    ).rejects.toThrow(/book_members_one_owner/);
  });
});
