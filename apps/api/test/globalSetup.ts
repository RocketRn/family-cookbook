import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool } from '../src/db/pool.js';
import { migrateDown, migrateUp } from '../src/db/migrate.js';

export default async function setup(): Promise<void> {
  config({
    path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env.test'),
  });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required to run the API tests');
  const dbName = new URL(url).pathname.slice(1);
  // The suite resets the schema: never let it touch a development database.
  if (!dbName.includes('test')) {
    throw new Error(
      `Refusing to run tests against database "${dbName}": its name must contain "test"`,
    );
  }
  const db = createPool(url);
  try {
    await migrateDown(db, Infinity);
    await migrateUp(db);
  } finally {
    await db.end();
  }
}
