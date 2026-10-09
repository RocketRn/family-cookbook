import { z } from 'zod';

// Timer and outbox worker. Runs as a separate process from the API.
// Sprint 1 ships only the process skeleton with env validation; the timer poller (BE-09) and
// the outbox sender (BE-08) arrive in Sprint 4.
const env = z
  .object({
    DATABASE_URL: z.string().url(),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  })
  .safeParse(process.env);

const log = (level: string, msg: string) =>
  console.log(JSON.stringify({ level, time: Date.now(), msg }));

if (!env.success) {
  console.error(
    `Invalid environment configuration:\n${env.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')}`,
  );
  process.exit(1);
}

log('info', 'worker started (no jobs registered in Sprint 1)');
const heartbeat = setInterval(() => log('debug', 'worker heartbeat'), 30_000);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    clearInterval(heartbeat);
    log('info', `worker stopped on ${signal}`);
    process.exit(0);
  });
}
