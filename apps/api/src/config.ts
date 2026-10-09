import { z } from 'zod';

const boolFlag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

/** Values that ship in .env.example or tests and must never be accepted as the real token. */
const KNOWN_FAKE_TOKEN = /placeholder|fake|dev-only|test|example/i;
/** Telegram bot token shape: `<bot id>:<secret>` (docs/ASSUMPTIONS.md A-18). */
const BOT_TOKEN_SHAPE = /^\d+:[A-Za-z0-9_-]{30,}$/;

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z.string().url(),
    BOT_TOKEN: z.string().min(1),
    BOT_USERNAME: z.string().min(1).default('your_cookbook_bot'),
    MINI_APP_SHORT_NAME: z.string().min(1).default('cookbook'),
    INIT_DATA_MAX_AGE_SECONDS: z.coerce.number().int().min(60).default(86400),
    ALLOW_DEV_INIT_DATA: boolFlag,
    DEV_BOT_TOKEN: z.string().min(1).optional(),
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
  })
  .superRefine((env, ctx) => {
    // A placeholder token in production would let anyone who read .env.example forge initData.
    if (
      env.NODE_ENV === 'production' &&
      (KNOWN_FAKE_TOKEN.test(env.BOT_TOKEN) || !BOT_TOKEN_SHAPE.test(env.BOT_TOKEN))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BOT_TOKEN'],
        message:
          'BOT_TOKEN must be the real token from @BotFather in production (a placeholder or malformed value was given)',
      });
    }
    if (env.DEV_BOT_TOKEN && env.DEV_BOT_TOKEN === env.BOT_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DEV_BOT_TOKEN'],
        message: 'DEV_BOT_TOKEN must differ from BOT_TOKEN',
      });
    }
    if (env.ALLOW_DEV_INIT_DATA && env.NODE_ENV !== 'development') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ALLOW_DEV_INIT_DATA'],
        message: 'ALLOW_DEV_INIT_DATA=true is only permitted when NODE_ENV=development',
      });
    }
    if (env.ALLOW_DEV_INIT_DATA && !env.DEV_BOT_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DEV_BOT_TOKEN'],
        message: 'DEV_BOT_TOKEN is required when ALLOW_DEV_INIT_DATA=true',
      });
    }
  });

export type Config = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  logLevel: string;
  databaseUrl: string;
  botUsername: string;
  miniAppShortName: string;
  initDataMaxAgeSeconds: number;
  corsOrigin: string;
  /** Tokens initData may be signed with. The dev token is present only in development with the flag. */
  initDataTokens: string[];
};

export class ConfigError extends Error {}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(env)'}: ${i.message}`,
    );
    throw new ConfigError(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  const initDataTokens = [e.BOT_TOKEN];
  if (e.ALLOW_DEV_INIT_DATA && e.NODE_ENV === 'development' && e.DEV_BOT_TOKEN) {
    initDataTokens.push(e.DEV_BOT_TOKEN);
  }
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    botUsername: e.BOT_USERNAME,
    miniAppShortName: e.MINI_APP_SHORT_NAME,
    initDataMaxAgeSeconds: e.INIT_DATA_MAX_AGE_SECONDS,
    corsOrigin: e.CORS_ORIGIN,
    initDataTokens,
  };
}
