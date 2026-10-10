/**
 * What production refuses to start with (owner's Sprint 4 rule; D-045): the local demo's fake
 * secrets, the placeholders of deploy/gcp/.env.example, and passwords too short to be random.
 * The messages name the setting, never its value.
 */
const DEMO_DB_PASSWORDS = new Set(['cookbook', 'cookbook_api', 'postgres', 'password']);
const PLACEHOLDER = /change.?me|placeholder|example|your[_-]/i;
export const MIN_DB_PASSWORD = 16;
/** BOT_USERNAME in .env.example: the links in messages and invitations would lead nowhere. */
export const PLACEHOLDER_BOT = 'your_cookbook_bot';

export const isPlaceholder = (value: string): boolean => PLACEHOLDER.test(value);

/** Telegram's alphabet for the webhook secret token (setWebhook secret_token: 1-256 characters). */
const WEBHOOK_SECRET = /^[A-Za-z0-9_-]{16,256}$/;
export const MIN_WEBHOOK_SECRET_PROD = 32;
const DEV_SECRET = /dev-only|test|fake|local/i;

/**
 * Why BOT_WEBHOOK_SECRET is not fit (BE-07, D-047), or null. Telegram sends it with every update;
 * anyone who knows it could post fake updates (/start as someone else), so production needs a
 * random value: `openssl rand -hex 32`, made by the guide's command.
 */
export function webhookSecretProblem(secret: string | undefined, prod: boolean): string | null {
  if (secret === undefined)
    return prod ? 'is required in production (docs/DEPLOY-GCP.ru.md, 9.5)' : null;
  if (!WEBHOOK_SECRET.test(secret))
    return 'must be 16-256 characters from A-Z, a-z, 0-9, _ and - (Telegram’s rule)';
  if (!prod) return null;
  if (isPlaceholder(secret) || DEV_SECRET.test(secret))
    return 'still has a placeholder or test value';
  if (secret.length < MIN_WEBHOOK_SECRET_PROD)
    return `needs a random value of at least ${MIN_WEBHOOK_SECRET_PROD} characters`;
  return null;
}

/** Why a database URL is not fit for production, or null. */
export function dbUrlProblem(url: string): string | null {
  let password: string;
  try {
    password = decodeURIComponent(new URL(url).password);
  } catch {
    return 'is not a valid URL';
  }
  if (!password) return 'has no password';
  if (DEMO_DB_PASSWORDS.has(password)) return 'uses the local demo password';
  if (isPlaceholder(password)) return 'still has the placeholder password';
  if (password.length < MIN_DB_PASSWORD)
    return `needs a random password of at least ${MIN_DB_PASSWORD} characters`;
  return null;
}

/** `db:migrate` in production: two different users, both with real passwords. */
export function migrateEnvProblems(env: Record<string, string | undefined>): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const problems: string[] = [];
  for (const name of ['MIGRATION_DATABASE_URL', 'DATABASE_URL'] as const) {
    const url = env[name];
    if (!url) continue; // reported by the tool itself
    const p = dbUrlProblem(url);
    if (p) problems.push(`${name} ${p}`);
  }
  if (
    env.MIGRATION_DATABASE_URL &&
    env.DATABASE_URL &&
    env.MIGRATION_DATABASE_URL === env.DATABASE_URL
  )
    problems.push('MIGRATION_DATABASE_URL and DATABASE_URL must be two different users (D-013)');
  return problems;
}
