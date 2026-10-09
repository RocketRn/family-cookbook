import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool } from '../src/db/pool.js';
import { migrateDown, migrateUp } from '../src/db/migrate.js';
import { ensureRuntimeRole } from '../src/db/roles.js';
import { syncUnits } from '../src/db/units.js';
import { assertSafeTestEnv } from './helpers/safeEnv.js';

export function testUrls(): { runtime: string; owner: string } {
  const runtime = process.env.DATABASE_URL;
  const owner = process.env.MIGRATION_DATABASE_URL;
  if (!runtime || !owner) {
    throw new Error('DATABASE_URL and MIGRATION_DATABASE_URL are required to run the API tests');
  }
  for (const url of [runtime, owner]) {
    const dbName = new URL(url).pathname.slice(1);
    // The suite resets the schema: never let it touch a development database.
    if (!dbName.includes('test')) {
      throw new Error(
        `Refusing to run tests against database "${dbName}": its name must contain "test"`,
      );
    }
  }
  if (new URL(runtime).pathname !== new URL(owner).pathname) {
    throw new Error('DATABASE_URL and MIGRATION_DATABASE_URL must point at the same test database');
  }
  return { runtime, owner };
}

export default async function setup(): Promise<void> {
  config({
    path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env.test'),
  });
  assertSafeTestEnv(process.env);
  const { runtime, owner } = testUrls();
  const db = createPool(owner);
  try {
    await migrateDown(db, Infinity);
    await migrateUp(db);
    await syncUnits(db);
    await ensureRuntimeRole(db, runtime);
  } finally {
    await db.end();
  }
}
