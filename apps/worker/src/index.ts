import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cleanupFinished,
  cleanupOrphanMedia,
  ConfigError,
  createPool,
  createTelegramClient,
  fireDueTimers,
  loadWorkerConfig,
  objectKeys,
  S3Storage,
  sendDueMessages,
} from '@cookbook/api/jobs';

// The worker: a separate process from the API (PRD 4.1). It fires due timers (BE-09), sends the
// bot's messages from the outbox (BE-08), and cleans up (orphaned photos, old timers and messages).
// Any number of workers may run at once: the database makes every step happen exactly once.
loadDotenv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env') });

const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
let minLevel = 1;
const log = (level: (typeof LEVELS)[number], msg: string, extra: Record<string, unknown> = {}) => {
  if (LEVELS.indexOf(level) >= minLevel) {
    console.log(JSON.stringify({ level, time: Date.now(), msg, ...extra }));
  }
};
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const config = (() => {
  try {
    return loadWorkerConfig();
  } catch (err) {
    console.error(err instanceof ConfigError ? err.message : errorText(err));
    return process.exit(1);
  }
})();
minLevel = LEVELS.indexOf(config.logLevel);
const db = createPool(config.databaseUrl);
const storage = new S3Storage(config.storage);
const telegram = config.telegram ? createTelegramClient(config.telegram) : null;

/** Runs `job` every `everyMs`, never two at once; an error is logged and the loop goes on. */
function loop(name: string, everyMs: number, job: () => Promise<void>): () => Promise<void> {
  let stopped = false;
  let running: Promise<void> = Promise.resolve();
  let timer: NodeJS.Timeout | undefined;
  const tick = () => {
    running = job()
      .catch((err) => log('error', `${name} failed`, { error: errorText(err) }))
      .finally(() => {
        if (!stopped) timer = setTimeout(tick, everyMs);
      });
  };
  tick();
  return async () => {
    stopped = true;
    clearTimeout(timer);
    await running;
  };
}

const stops = [
  loop('timers', config.timerPollMs, async () => {
    const { fired } = await fireDueTimers(db);
    for (const t of fired) {
      // A timer that ended while the worker was down fires now, once; the delay is logged.
      log(t.lateSec > 5 ? 'warn' : 'debug', 'timer fired', {
        id: t.id,
        lateSec: Math.round(t.lateSec),
      });
    }
  }),
  loop('outbox', config.outboxPollMs, async () => {
    if (!telegram) return; // no Bot API configured: messages wait in the outbox
    const s = await sendDueMessages(db, telegram, {
      links: config.links,
      log,
      // BE-10: "I cooked it" photos: Telegram fetches the full copy by a signed link.
      photoUrl: (key) => storage.url(objectKeys(key).full),
    });
    if (s.sent || s.failed || s.blocked || s.retried) log('info', 'outbox', s);
  }),
  loop('timers clean-up', 60 * 60_000, async () => {
    const removed = await cleanupFinished(db);
    if (removed.timers || removed.outbox || removed.abandoned || removed.updates)
      log('info', 'timers clean-up done', removed);
  }),
  loop('media clean-up', config.mediaCleanupMin * 60_000, async () => {
    const removed = await cleanupOrphanMedia(db, storage);
    log('info', 'media clean-up done', { removed });
  }),
];

log('info', 'worker started', {
  telegram: config.telegram
    ? config.telegram.allowReal
      ? 'api.telegram.org'
      : `local stand-in ${new URL(config.telegram.baseUrl).host}`
    : 'off (no TELEGRAM_API_BASE: messages wait in the outbox)',
  timerPollMs: config.timerPollMs,
  mediaCleanupEveryMin: config.mediaCleanupMin,
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    log('info', `worker stopping on ${signal}`);
    // Finish the step in progress; a message mid-send is reclaimed by the next worker anyway.
    void Promise.all(stops.map((stop) => stop()))
      .then(() => db.end())
      .then(() => process.exit(0));
  });
}
