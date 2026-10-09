import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './pool.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SEED_FILE = path.resolve(here, '../../../../db/seeds/dev.sql');

export async function seedDev(db: Db): Promise<void> {
  await db.query(await readFile(SEED_FILE, 'utf8'));
}
