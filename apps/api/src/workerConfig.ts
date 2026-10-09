import { z } from 'zod';
import { BOT_TOKEN_SHAPE, ConfigError, KNOWN_FAKE_TOKEN } from './config.js';
import { dbUrlProblem, isPlaceholder, PLACEHOLDER_BOT } from './prodGuard.js';
import type { ClientOptions } from './notify/telegram.js';
import type { Links } from './notify/templates.js';
import {
  DEV_S3_KEYS,
  storageEnvSchema,
  toStorageConfig,
  type StorageConfig,
} from './storage/config.js';

/** The real Bot API, used only by the production worker (D-039). */
const REAL_API = 'https://api.telegram.org';

/**
 * Outside production the token may go only to a local stand-in (apps/fakebot): this computer, or
 * a container on the same Docker network (a one-word host name such as "fakebot").
 */
function isLocalStandIn(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  const host = url.hostname;
  return (
    host === '127.0.0.1' ||
    host === 'localhost' ||
    host === '[::1]' ||
    /^[a-z][a-z0-9-]{0,62}$/.test(host)
  );
}

const sameApi = (raw: string) => raw.replace(/\/+$/, '') === REAL_API;

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.string().url(),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    BOT_TOKEN: z.string().min(1).optional(),
    /** Where Bot API calls go. Production: the real API (the default). Elsewhere: a local stand-in. */
    TELEGRAM_API_BASE: z.string().min(1).optional(),
    BOT_USERNAME: z
      .string()
      .regex(/^[A-Za-z0-9_]{5,32}$/, 'must be a bot username without @')
      .optional(),
    MINI_APP_SHORT_NAME: z
      .string()
      .regex(/^[A-Za-z0-9_]{3,30}$/, 'must be the Mini App short name from BotFather')
      .default('cookbook'),
    TIMER_POLL_MS: z.coerce.number().int().min(200).max(10_000).default(1000),
    OUTBOX_POLL_MS: z.coerce.number().int().min(100).max(10_000).default(500),
    MEDIA_CLEANUP_INTERVAL_MIN: z.coerce.number().int().min(1).default(60),
  })
  .merge(storageEnvSchema)
  .superRefine((env, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (env.NODE_ENV === 'production') {
      if (
        !env.BOT_TOKEN ||
        KNOWN_FAKE_TOKEN.test(env.BOT_TOKEN) ||
        !BOT_TOKEN_SHAPE.test(env.BOT_TOKEN)
      ) {
        issue(
          'BOT_TOKEN',
          'must be the real token from @BotFather in production (missing, a placeholder or malformed)',
        );
      }
      if (env.TELEGRAM_API_BASE && !sameApi(env.TELEGRAM_API_BASE)) {
        issue('TELEGRAM_API_BASE', `must be ${REAL_API} in production (or left unset)`);
      }
      if (!env.BOT_USERNAME || env.BOT_USERNAME === PLACEHOLDER_BOT) {
        issue(
          'BOT_USERNAME',
          'must be the real bot username in production (the links in messages use it)',
        );
      }
      if (DEV_S3_KEYS.test(env.S3_ACCESS_KEY) || DEV_S3_KEYS.test(env.S3_SECRET_KEY)) {
        issue('S3_ACCESS_KEY', 'the local development S3 keys must not be used in production');
      }
      for (const key of ['S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const) {
        if (isPlaceholder(env[key])) issue(key, 'still has the placeholder value');
      }
      const db = dbUrlProblem(env.DATABASE_URL);
      if (db) issue('DATABASE_URL', db);
    } else if (env.TELEGRAM_API_BASE) {
      if (!isLocalStandIn(env.TELEGRAM_API_BASE) || sameApi(env.TELEGRAM_API_BASE)) {
        issue(
          'TELEGRAM_API_BASE',
          'outside production only a local stand-in is allowed (e.g. http://127.0.0.1:8081)',
        );
      }
      if (!env.BOT_TOKEN) issue('BOT_TOKEN', 'the stand-in needs a (fake) token');
    }
  });

export type WorkerConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  databaseUrl: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** null: no Bot API configured, messages wait in the outbox (development without the stand-in). */
  telegram: Required<Omit<ClientOptions, 'timeoutMs'>> | null;
  links: Links;
  timerPollMs: number;
  outboxPollMs: number;
  mediaCleanupMin: number;
  storage: StorageConfig;
};

export function loadWorkerConfig(
  env: Record<string, string | undefined> = process.env,
): WorkerConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(env)'}: ${i.message}`,
    );
    throw new ConfigError(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  const prod = e.NODE_ENV === 'production';
  const base = prod ? REAL_API : e.TELEGRAM_API_BASE;
  return {
    nodeEnv: e.NODE_ENV,
    databaseUrl: e.DATABASE_URL,
    logLevel: e.LOG_LEVEL,
    telegram:
      base && e.BOT_TOKEN
        ? { baseUrl: base, token: e.BOT_TOKEN, allowReal: prod, allowLocal: !prod }
        : null,
    links: { botUsername: e.BOT_USERNAME ?? PLACEHOLDER_BOT, appShortName: e.MINI_APP_SHORT_NAME },
    timerPollMs: e.TIMER_POLL_MS,
    outboxPollMs: e.OUTBOX_POLL_MS,
    mediaCleanupMin: e.MEDIA_CLEANUP_INTERVAL_MIN,
    storage: toStorageConfig(e),
  };
}
