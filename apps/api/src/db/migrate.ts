import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './pool.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(here, '../../../../db/migrations');
const LOCK_KEY = 727_001;

type Migration = { name: string; upPath: string; downPath: string };

export type MigrateOptions = { dir?: string };

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

async function listMigrations(dir = MIGRATIONS_DIR): Promise<Migration[]> {
  const all = await readdir(dir);
  const files = all.filter((f) => f.endsWith('.up.sql')).sort();
  return files.map((f) => {
    const name = f.replace(/\.up\.sql$/, '');
    // Every migration must be reversible: fail before applying anything, not at rollback time.
    if (!all.includes(`${name}.down.sql`))
      throw new Error(`Migration ${name} has no .down.sql file`);
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
    await db.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text');
    return await fn(db);
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    lockClient.release();
  }
}

async function applied(db: Db): Promise<Array<{ name: string; checksum: string | null }>> {
  const r = await db.query<{ name: string; checksum: string | null }>(
    'SELECT name, checksum FROM schema_migrations ORDER BY name',
  );
  return r.rows;
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

export async function migrateUp(db: Db, opts: MigrateOptions = {}): Promise<string[]> {
  return withLock(db, async () => {
    const done = new Map((await applied(db)).map((m) => [m.name, m.checksum]));
    const ran: string[] = [];
    for (const m of await listMigrations(opts.dir)) {
      const sql = await readFile(m.upPath, 'utf8');
      const checksum = sha256(sql);
      if (done.has(m.name)) {
        const stored = done.get(m.name);
        // An applied migration must never change: add a new migration instead.
        if (stored && stored !== checksum) {
          throw new Error(`Migration ${m.name} was modified after it was applied`);
        }
        if (!stored) {
          await db.query('UPDATE schema_migrations SET checksum = $2 WHERE name = $1', [
            m.name,
            checksum,
          ]);
        }
        continue;
      }
      await execInTx(db, sql, 'INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
        m.name,
        checksum,
      ]);
      ran.push(m.name);
    }
    return ran;
  });
}

/** Roll back the last `steps` migrations (default 1). Use Infinity to roll back everything. */
export async function migrateDown(db: Db, steps = 1, opts: MigrateOptions = {}): Promise<string[]> {
  return withLock(db, async () => {
    const done = (await applied(db)).map((m) => m.name);
    const all = await listMigrations(opts.dir);
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
