import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  cleanupOrphanMedia,
  createPool,
  S3Storage,
  storageEnvSchema,
  toStorageConfig,
} from '@cookbook/api/jobs';

// Timer and outbox worker: a separate process from the API (PRD 4.1). Sprint 2 adds the hourly
// clean-up of orphaned photos (BE-05); the timer poller (BE-09) and outbox sender (BE-08) arrive later.
loadDotenv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env') });

const parsed = z
  .object({
    DATABASE_URL: z.string().url(),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    MEDIA_CLEANUP_INTERVAL_MIN: z.coerce.number().int().min(1).default(60),
  })
  .merge(storageEnvSchema)
  .safeParse(process.env);

const log = (level: string, msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ level, time: Date.now(), msg, ...extra }));

if (!parsed.success) {
  console.error(
    `Invalid environment configuration:\n${parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')}`,
  );
  process.exit(1);
}
const env = parsed.data;
const db = createPool(env.DATABASE_URL);
const storage = new S3Storage(toStorageConfig(env));

async function cleanup(): Promise<void> {
  try {
    const removed = await cleanupOrphanMedia(db, storage);
    log('info', 'media clean-up done', { removed });
  } catch (err) {
    log('error', 'media clean-up failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

log('info', 'worker started', { mediaCleanupEveryMin: env.MEDIA_CLEANUP_INTERVAL_MIN });
void cleanup();
const timer = setInterval(() => void cleanup(), env.MEDIA_CLEANUP_INTERVAL_MIN * 60_000);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    clearInterval(timer);
    log('info', `worker stopped on ${signal}`);
    void db.end().then(() => process.exit(0));
  });
}
