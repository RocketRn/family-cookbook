import type { Db } from '../db/pool.js';
import { withWorker } from '../db/tx.js';

/**
 * BE-09 poller tick (PRD 4.6; D-040): due timers become "fired" and queue their message, in one
 * statement. Exactly once is guaranteed by the database, not by timing:
 *   - FOR UPDATE SKIP LOCKED: two workers never take the same timer;
 *   - the UPDATE only moves a timer that is still "running", and a trigger forbids any other
 *     transition (a fired timer can never run or fire again);
 *   - the message's dedupe_key `timer:<id>` is UNIQUE, so it can be queued only once.
 * A timer that ended while the worker was down fires on the first tick after the restart; its
 * lateness is returned for the log.
 */
export async function fireDueTimers(
  db: Db,
  opts: { limit?: number } = {},
): Promise<{ fired: Array<{ id: string; lateSec: number }> }> {
  const r = await withWorker(db, (tx) =>
    tx.query<{ id: string; late: number }>(
      `WITH due AS (
         SELECT id FROM timers
          WHERE status = 'running' AND ends_at <= now()
          ORDER BY ends_at
          LIMIT $1
            FOR UPDATE SKIP LOCKED
       ), fired AS (
         UPDATE timers t SET status = 'fired', fired_at = now()
           FROM due WHERE t.id = due.id AND t.status = 'running'
         RETURNING t.id, t.user_id, t.label, t.recipe_id, t.recipe_title, t.step_number, t.ends_at
       ), queued AS (
         INSERT INTO notification_outbox (type, recipient_user_id, payload, dedupe_key, priority)
         SELECT 'timer_fired', f.user_id,
                jsonb_build_object('timer_id', f.id, 'label', f.label, 'recipe_id', f.recipe_id,
                                   'recipe_title', f.recipe_title, 'step_number', f.step_number,
                                   -- S6-4: how late the message is, measured from here (D-057).
                                   'ends_at', f.ends_at),
                'timer:' || f.id, 0
           FROM fired f JOIN users u ON u.id = f.user_id
          -- Muted in the profile (notify_prefs.timers = false): fired, but no message.
          WHERE coalesce(u.notify_prefs ->> 'timers', 'true') <> 'false' AND u.deleted_at IS NULL
         ON CONFLICT (dedupe_key) DO NOTHING
         RETURNING 1
       )
       SELECT id, extract(epoch FROM now() - ends_at)::float8 AS late FROM fired ORDER BY ends_at`,
      [opts.limit ?? 100],
    ),
  );
  return { fired: r.rows.map((x) => ({ id: x.id, lateSec: x.late })) };
}

/**
 * Housekeeping (hourly): finished timers go after 7 days (PRD 4.6), delivered or abandoned outbox
 * rows after 30, a cooking session idle for 24 hours becomes "abandoned" (PRD 3.2), and the ids
 * of Telegram updates already handled are forgotten after 7 days (BE-07).
 */
export async function cleanupFinished(
  db: Db,
): Promise<{ timers: number; outbox: number; abandoned: number; updates: number }> {
  return withWorker(db, async (tx) => {
    const timers = await tx.query(
      `DELETE FROM timers
        WHERE status <> 'running' AND coalesce(fired_at, cancelled_at, created_at) < now() - interval '7 days'`,
    );
    const outbox = await tx.query(
      `DELETE FROM notification_outbox
        WHERE status IN ('sent', 'failed', 'blocked') AND created_at < now() - interval '30 days'`,
    );
    const abandoned = await tx.query(
      `UPDATE cook_sessions SET state = 'abandoned', updated_at = now()
        WHERE state = 'active' AND updated_at < now() - interval '24 hours'`,
    );
    // BE-07: Telegram re-delivers an update for at most a day; a week of update ids is plenty.
    const updates = await tx.query(
      `DELETE FROM tg_updates WHERE received_at < now() - interval '7 days'`,
    );
    return {
      timers: timers.rowCount ?? 0,
      outbox: outbox.rowCount ?? 0,
      abandoned: abandoned.rowCount ?? 0,
      updates: updates.rowCount ?? 0,
    };
  });
}
