import type { Db } from './pool.js';

/** Group roles created by the migrations. The API login role is a NOINHERIT member of both. */
export const APP_ROLE = 'cookbook_app';
export const SYSTEM_ROLE = 'cookbook_system';

/**
 * Creates or updates the API login role named in `runtimeUrl` (DATABASE_URL), using the owner
 * connection. Idempotent; run by `pnpm db:migrate` and by the test setup.
 * The role can log in, but on its own can read nothing: NOINHERIT means it only gets privileges
 * after `SET LOCAL ROLE cookbook_app | cookbook_system` inside a transaction (see tx.ts).
 */
export async function ensureRuntimeRole(owner: Db, runtimeUrl: string): Promise<string> {
  const url = new URL(runtimeUrl);
  const role = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (!role) throw new Error('DATABASE_URL must name the API database user');

  const ownerName = (await owner.query<{ u: string }>('SELECT current_user AS u')).rows[0]!.u;
  if (role === ownerName) {
    throw new Error(
      `DATABASE_URL uses "${role}", the same user as MIGRATION_DATABASE_URL. The API must log in as ` +
        'its own restricted user (for example cookbook_api); see .env.example.',
    );
  }

  const exists = (await owner.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])).rowCount;
  // Only attributes a non-superuser owner may set. SUPERUSER, BYPASSRLS, CREATEDB and CREATEROLE
  // default to off on CREATE; verifyRuntimeRole() refuses to start the API if any is on.
  const attrs = 'LOGIN NOINHERIT';
  // format() quotes the identifier and the password literal on the server side.
  const stmt = (
    await owner.query<{ sql: string }>(
      password
        ? `SELECT format('${exists ? 'ALTER' : 'CREATE'} ROLE %I ${attrs} PASSWORD %L', $1::text, $2::text) AS sql`
        : `SELECT format('${exists ? 'ALTER' : 'CREATE'} ROLE %I ${attrs}', $1::text) AS sql`,
      password ? [role, password] : [role],
    )
  ).rows[0]!.sql;
  await owner.query(stmt);
  const grant = (
    await owner.query<{ sql: string }>(
      `SELECT format('GRANT %I, %I TO %I', $1::text, $2::text, $3::text) AS sql`,
      [APP_ROLE, SYSTEM_ROLE, role],
    )
  ).rows[0]!.sql;
  await owner.query(grant);
  return role;
}

/**
 * Startup safety check for the API's own connection (PRD 7.1 security; docs/DECISIONS.md D-013).
 * Returns human-readable problems; empty means safe.
 */
export async function verifyRuntimeRole(db: Db): Promise<string[]> {
  const roles = await db.query<{ rolname: string }>(
    'SELECT rolname FROM pg_roles WHERE rolname = ANY($1)',
    [[APP_ROLE, SYSTEM_ROLE]],
  );
  if (roles.rowCount !== 2) {
    return [
      'Database roles cookbook_app / cookbook_system are missing: run `pnpm db:migrate` first',
    ];
  }
  const r = (
    await db.query<{
      name: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolinherit: boolean;
      owns: boolean;
      app: boolean;
      system: boolean;
    }>(
      `SELECT r.rolname AS name, r.rolsuper, r.rolbypassrls, r.rolinherit,
              EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                       WHERE n.nspname = 'public' AND c.relowner = r.oid) AS owns,
              pg_has_role(r.oid, $1, 'MEMBER') AS app,
              pg_has_role(r.oid, $2, 'MEMBER') AS system
         FROM pg_roles r WHERE r.rolname = current_user`,
      [APP_ROLE, SYSTEM_ROLE],
    )
  ).rows[0]!;
  const problems: string[] = [];
  const who = `Database user "${r.name}"`;
  if (r.rolsuper) problems.push(`${who} is a superuser`);
  if (r.rolbypassrls) problems.push(`${who} has BYPASSRLS`);
  if (r.owns) problems.push(`${who} owns tables (it must not be the migration/owner user)`);
  if (r.rolinherit) problems.push(`${who} must be NOINHERIT`);
  if (!r.app || !r.system)
    problems.push(`${who} is not a member of ${APP_ROLE} and ${SYSTEM_ROLE}`);
  return problems.map(
    (p) => `${p}. Fix DATABASE_URL (see .env.example) and run \`pnpm db:migrate\`.`,
  );
}
