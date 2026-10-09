import '../loadEnv.js';
import { createPool } from './pool.js';
import { migrateDown, migrateUp } from './migrate.js';
import { seedDev } from './seed.js';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const db = createPool(url);
  try {
    const cmd = process.argv[2];
    if (cmd === 'migrate') console.log('applied:', await migrateUp(db));
    else if (cmd === 'rollback') console.log('rolled back:', await migrateDown(db, 1));
    else if (cmd === 'reset') {
      await migrateDown(db, Infinity);
      console.log('applied:', await migrateUp(db));
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
