import { UNITS } from '@cookbook/recipe-core';
import type { Db } from './pool.js';

/**
 * Writes the unit list from packages/recipe-core (the single source of truth) into the `units`
 * table. Run by `pnpm db:migrate` and the test setup; a test checks the table equals the list (D-021).
 * Units are never deleted here: an ingredient may still reference one. Removing a unit is a
 * deliberate change that the equality test will flag.
 */
export async function syncUnits(owner: Db): Promise<number> {
  for (const u of UNITS) {
    await owner.query(
      `INSERT INTO units (code, dimension, to_base, aliases) VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO UPDATE
         SET dimension = EXCLUDED.dimension, to_base = EXCLUDED.to_base, aliases = EXCLUDED.aliases`,
      [u.code, u.dimension, u.toBase, JSON.stringify(u.aliases)],
    );
  }
  return UNITS.length;
}
