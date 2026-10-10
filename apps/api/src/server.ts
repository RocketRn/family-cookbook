import './loadEnv.js';
import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { verifyRuntimeRole } from './db/roles.js';
import { apiTelegramTarget } from './notify/target.js';
import { S3Storage } from './storage/storage.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
  const db = createPool(config.databaseUrl);
  // Refuse to serve if the API's database user could bypass row-level security (D-013).
  const problems = await verifyRuntimeRole(db);
  if (problems.length > 0) {
    console.error(`Unsafe database user:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    await db.end();
    process.exit(1);
  }
  const storage = new S3Storage(config.storage);
  if (config.nodeEnv === 'development') {
    // Local SeaweedFS starts empty; production buckets are provisioned outside the app.
    await storage
      .ensureBucket()
      .catch((err) => console.warn('S3 bucket check failed:', err.message));
  }
  // S6-3b: the Bot API for "Share" (D-056); none without the arming switch in production.
  const telegram = apiTelegramTarget(process.env);
  const app = await buildApp({ config, db, storage, telegram });
  if (config.initDataTokens.length > 1) {
    app.log.warn('ALLOW_DEV_INIT_DATA is on: initData signed with the fake dev token is accepted');
  }
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void app
        .close()
        .then(() => db.end())
        .then(() => process.exit(0));
    });
  }
  await app.listen({ port: config.port, host: config.host });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
