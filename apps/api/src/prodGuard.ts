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
