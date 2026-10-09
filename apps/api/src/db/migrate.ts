import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './pool.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(here, '../../../../db/migrations');
const LOCK_KEY = 727_001;

type Migration = { name: string; upPath: string; downPath: string };

async function listMigrations(dir = MIGRATIONS_DIR): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.up.sql')).sort();
  return files.map((f) => {
    const name = f.replace(/\.up\.sql$/, '');
    return { name, upPath: path.join(dir, f), downPath: path.join(dir, `${name}.down.sql`) };
  });
}

async function withLock<T>(db: Db, fn: (q: Db) => Promise<T>): Promise<T> {
  // Session-level advisory lock on a dedicated connection prevents concurrent migrators.
  const lockClient = await db.connect();
  try {
    await lockClient.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await db.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    return await fn(db);
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    lockClient.release();
  }
}

async function applied(db: Db): Promise<string[]> {
  const r = await db.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');
  return r.rows.map((x) => x.name);
}

async function execInTx(db: Db, sql: string, after: string, params: string[]): Promise<void> {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    await c.query(sql);
    await c.query(after, params);
    await c.query('COMMIT');
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

export async function migrateUp(db: Db): Promise<string[]> {
  return withLock(db, async () => {
    const done = new Set(await applied(db));
    const ran: string[] = [];
    for (const m of await listMigrations()) {
      if (done.has(m.name)) continue;
      await execInTx(
        db,
        await readFile(m.upPath, 'utf8'),
        'INSERT INTO schema_migrations (name) VALUES ($1)',
        [m.name],
      );
      ran.push(m.name);
    }
    return ran;
  });
}

/** Roll back the last `steps` migrations (default 1). Use Infinity to roll back everything. */
export async function migrateDown(db: Db, steps = 1): Promise<string[]> {
  return withLock(db, async () => {
    const done = await applied(db);
    const all = await listMigrations();
    const rolled: string[] = [];
    for (const name of done.reverse().slice(0, steps)) {
      const m = all.find((x) => x.name === name);
      if (!m) throw new Error(`Applied migration ${name} has no files on disk`);
      await execInTx(
        db,
        await readFile(m.downPath, 'utf8'),
        'DELETE FROM schema_migrations WHERE name = $1',
        [name],
      );
      rolled.push(name);
    }
    return rolled;
  });
}
