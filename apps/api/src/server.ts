import './loadEnv.js';
import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { createPool } from './db/pool.js';

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
  const app = await buildApp({ config, db });
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
  await app.listen({ port: config.port, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
