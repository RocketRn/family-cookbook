import type pg from 'pg';
import type { Db } from './pool.js';

export type Tx = pg.PoolClient;

/** Identity applied to a row-level-security-enforced transaction. */
export type RlsContext = { userId: string; shareToken?: string | null };

async function run<T>(
  db: Db,
  setup: (c: Tx) => Promise<void>,
  fn: (c: Tx) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await setup(client);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * System transaction: switches to the restricted `cookbook_system` role. It is not filtered by row
 * but can only do what its column-level GRANTs allow (migration 0003). Only for work that has no
 * user identity yet (sign-in upsert) or that is authorised in application code (membership
 * management). Never for reading recipes on behalf of a user.
 */
export function withSystem<T>(db: Db, fn: (c: Tx) => Promise<T>): Promise<T> {
  return run(
    db,
    async (c) => {
      await c.query('SET LOCAL ROLE cookbook_system');
    },
    fn,
  );
}

/**
 * User transaction: drops to the restricted `cookbook_app` role and sets the per-request
 * identity. SET LOCAL / set_config(..., true) are transaction-scoped, so they never leak
 * across pooled connections (works with transaction-mode poolers).
 */
export function withUser<T>(db: Db, ctx: RlsContext, fn: (c: Tx) => Promise<T>): Promise<T> {
  return run(
    db,
    async (c) => {
      await c.query('SET LOCAL ROLE cookbook_app');
      await c.query(
        `SELECT set_config('app.user_id', $1, true), set_config('app.share_token', $2, true)`,
        [ctx.userId, ctx.shareToken ?? ''],
      );
    },
    fn,
  );
}

/**
 * Worker transaction (timers and outbox, migration 0007): the `cookbook_worker` role. Its column
 * GRANTs are the limit: timers, the outbox, and only the user columns needed to send a message.
 */
export function withWorker<T>(db: Db, fn: (c: Tx) => Promise<T>): Promise<T> {
  return run(
    db,
    async (c) => {
      await c.query('SET LOCAL ROLE cookbook_worker');
    },
    fn,
  );
}
