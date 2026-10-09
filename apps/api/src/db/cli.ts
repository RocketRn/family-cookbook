import '../loadEnv.js';
import { createPool } from './pool.js';
import { migrateDown, migrateUp } from './migrate.js';
import { ensureRuntimeRole } from './roles.js';
import { seedDev } from './seed.js';

/**
 * Schema commands run as the owner (MIGRATION_DATABASE_URL). `migrate` and `reset` also create or
 * update the API's restricted login user named in DATABASE_URL (docs/DECISIONS.md D-013).
 */
async function main(): Promise<void> {
  const ownerUrl = process.env.MIGRATION_DATABASE_URL;
  const runtimeUrl = process.env.DATABASE_URL;
  if (!ownerUrl)
    throw new Error('MIGRATION_DATABASE_URL is required (the owner user; see .env.example)');
  const db = createPool(ownerUrl);
  const ensureRole = async () => {
    if (!runtimeUrl) throw new Error('DATABASE_URL is required (the API user; see .env.example)');
    console.log('API database user ready:', await ensureRuntimeRole(db, runtimeUrl));
  };
  try {
    const cmd = process.argv[2];
    if (cmd === 'migrate') {
      console.log('applied:', await migrateUp(db));
      await ensureRole();
    } else if (cmd === 'rollback') console.log('rolled back:', await migrateDown(db, 1));
    else if (cmd === 'reset') {
      if (process.env.NODE_ENV === 'production') throw new Error('Refusing to reset production');
      await migrateDown(db, Infinity);
      console.log('applied:', await migrateUp(db));
      await ensureRole();
    } else if (cmd === 'seed') {
      if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed production');
      await seedDev(db);
      console.log('seeded');
    } else throw new Error('Usage: cli.ts migrate | rollback | reset | seed');
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
