import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser } from '../auth/plugin.js';
import type { Db } from '../db/pool.js';
import { withUser, type Tx } from '../db/tx.js';
import { AppError, notFound } from '../errors.js';

/** PRD 4.6: at most 10 running timers per person, each from 1 second to 24 hours. */
export const MAX_RUNNING_TIMERS = 10;
export const MAX_TIMER_SEC = 86_400;
/** A finished timer stays in GET /timers?active=1 this long, so the app can show "done". */
const JUST_ENDED = '15 minutes';

const startBody = z
  .object({
    client_timer_id: z.string().uuid(),
    duration_sec: z.number().int().min(1).max(MAX_TIMER_SEC),
    label: z.string().trim().min(1).max(100),
    recipe_id: z.string().uuid().optional(),
    step_id: z.string().uuid().optional(),
    cook_session_id: z.string().uuid().optional(),
    /** When the timer really started on the device (it may have been offline). */
    started_at: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .refine((b) => !b.step_id || b.recipe_id, {
    message: 'step_id needs recipe_id',
    path: ['step_id'],
  });
const idParams = z.object({ id: z.string().uuid() });
const extendBody = z.object({ seconds: z.number().int().min(1).max(3600) }).strict();
const listQuery = z.object({ active: z.enum(['0', '1']).optional() }).strict();

type TimerRow = {
  id: string;
  client_timer_id: string;
  recipe_id: string | null;
  step_id: string | null;
  cook_session_id: string | null;
  label: string;
  recipe_title: string | null;
  step_number: number | null;
  duration_sec: number;
  started_at: Date;
  ends_at: Date;
  status: 'running' | 'fired' | 'cancelled' | 'failed';
  fired_at: Date | null;
  cancelled_at: Date | null;
};

const timerView = (t: TimerRow) => ({
  id: t.id,
  client_timer_id: t.client_timer_id,
  recipe_id: t.recipe_id,
  step_id: t.step_id,
  cook_session_id: t.cook_session_id,
  label: t.label,
  recipe_title: t.recipe_title,
  step_number: t.step_number,
  duration_sec: t.duration_sec,
  started_at: t.started_at.toISOString(),
  ends_at: t.ends_at.toISOString(),
  status: t.status,
  fired_at: t.fired_at?.toISOString() ?? null,
  cancelled_at: t.cancelled_at?.toISOString() ?? null,
});

const COLUMNS = `id, client_timer_id, recipe_id, step_id, cook_session_id, label, recipe_title, step_number,
  duration_sec, started_at, ends_at, status, fired_at, cancelled_at`;
const timerNotFound = () => notFound('Timer not found');

/** The database clock: the app corrects its countdown by it (PRD 4.6). */
const serverNow = async (tx: Tx) =>
  (await tx.query<{ now: Date }>('SELECT now()')).rows[0]!.now.toISOString();

/** Why a cancel or +N failed: not mine (404), or mine but no longer running / too long (409). */
async function whyNot(tx: Tx, id: string, extending: boolean): Promise<AppError> {
  const r = await tx.query<{ status: string }>('SELECT status FROM timers WHERE id = $1', [id]);
  if (!r.rows[0]) return timerNotFound();
  if (r.rows[0].status !== 'running') {
    return new AppError(409, 'TIMER_NOT_RUNNING', 'This timer is no longer running');
  }
  return extending
    ? new AppError(409, 'TIMER_TOO_LONG', 'A timer can last at most 24 hours')
    : new AppError(409, 'TIMER_NOT_RUNNING', 'This timer is no longer running');
}

/**
 * BE-09 server timers (PRD 4.6; D-040). Everything runs as the user under row-level security: a
 * person sees, cancels and extends only their own timers, and starts one only for a recipe they
 * can read. The worker fires them (timers/fire.ts).
 */
export function registerTimers(app: FastifyInstance, db: Db): void {
  app.post('/timers', async (req, reply) => {
    const user = currentUser(req);
    const b = startBody.parse(req.body);
    const { timer, created, now } = await withUser(db, { userId: user.id }, async (tx) => {
      // One person's starts run one at a time, so ten at once cannot make an eleventh timer.
      await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('timers:' || $1, 0))`, [
        user.id,
      ]);
      const now = await serverNow(tx);
      const same = await tx.query<TimerRow>(
        `SELECT ${COLUMNS} FROM timers WHERE client_timer_id = $1`,
        [b.client_timer_id],
      );
      if (same.rows[0]) return { timer: same.rows[0], created: false, now }; // a retried request

      const running = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM timers WHERE status = 'running'`,
      );
      if (running.rows[0]!.n >= MAX_RUNNING_TIMERS) {
        throw new AppError(
          409,
          'TOO_MANY_TIMERS',
          `At most ${MAX_RUNNING_TIMERS} timers can run at once`,
          { max: MAX_RUNNING_TIMERS },
        );
      }

      // Snapshot for the message (the worker never reads recipes). Row-level security decides
      // what the user can read: someone else's recipe looks exactly like a missing one.
      let title: string | null = null;
      let stepNumber: number | null = null;
      if (b.recipe_id) {
        const r = await tx.query<{ title: string }>('SELECT title FROM recipes WHERE id = $1', [
          b.recipe_id,
        ]);
        if (!r.rows[0]) throw notFound('Recipe not found');
        title = r.rows[0].title;
      }
      if (b.step_id) {
        const s = await tx.query<{ position: number }>(
          'SELECT position FROM recipe_steps WHERE id = $1 AND recipe_id = $2',
          [b.step_id, b.recipe_id],
        );
        if (!s.rows[0]) throw notFound('Step not found');
        stepNumber = Math.min(s.rows[0].position + 1, 60);
      }
      if (b.cook_session_id) {
        const s = await tx.query('SELECT 1 FROM cook_sessions WHERE id = $1', [b.cook_session_id]);
        if (!s.rowCount) throw notFound('Cooking session not found');
      }

      // An offline start counts from when it really started; a device clock ahead of ours
      // cannot make a timer longer than asked.
      const inserted = await tx.query<TimerRow>(
        `WITH t AS (SELECT least(coalesce($9::timestamptz, now()), now()) AS started_at)
         INSERT INTO timers (user_id, client_timer_id, recipe_id, step_id, cook_session_id, label,
                             recipe_title, step_number, duration_sec, started_at, ends_at)
         SELECT app_user_id(), $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::text, $7::int,
                $8::int, t.started_at, t.started_at + make_interval(secs => $8::int)
           FROM t
          WHERE t.started_at + make_interval(secs => $8::int) > now()
         RETURNING ${COLUMNS}`,
        [
          b.client_timer_id,
          b.recipe_id ?? null,
          b.step_id ?? null,
          b.cook_session_id ?? null,
          b.label,
          title,
          stepNumber,
          b.duration_sec,
          b.started_at ?? null,
        ],
      );
      if (!inserted.rows[0]) {
        throw new AppError(422, 'TIMER_EXPIRED', 'This timer has already ended');
      }
      return { timer: inserted.rows[0], created: true, now };
    });
    return reply.status(created ? 201 : 200).send({ timer: timerView(timer), server_now: now });
  });

  app.get('/timers', async (req) => {
    const user = currentUser(req);
    const { active } = listQuery.parse(req.query);
    return withUser(db, { userId: user.id }, async (tx) => {
      const r = await tx.query<TimerRow>(
        active === '0'
          ? `SELECT ${COLUMNS} FROM timers ORDER BY created_at DESC LIMIT 50`
          : `SELECT ${COLUMNS} FROM timers
              WHERE status = 'running'
                 OR (status IN ('fired', 'failed') AND fired_at > now() - interval '${JUST_ENDED}')
              ORDER BY ends_at`,
      );
      return { timers: r.rows.map(timerView), server_now: await serverNow(tx) };
    });
  });

  app.delete('/timers/:id', async (req, reply) => {
    const user = currentUser(req);
    const { id } = idParams.parse(req.params);
    await withUser(db, { userId: user.id }, async (tx) => {
      const r = await tx.query('SELECT id FROM cancel_timer($1)', [id]);
      if (!r.rowCount) throw await whyNot(tx, id, false);
    });
    return reply.status(204).send();
  });

  app.post('/timers/:id/extend', async (req) => {
    const user = currentUser(req);
    const { id } = idParams.parse(req.params);
    const { seconds } = extendBody.parse(req.body);
    return withUser(db, { userId: user.id }, async (tx) => {
      const r = await tx.query<TimerRow>(`SELECT ${COLUMNS} FROM extend_timer($1, $2)`, [
        id,
        seconds,
      ]);
      if (!r.rows[0]) throw await whyNot(tx, id, true);
      return { timer: timerView(r.rows[0]), server_now: await serverNow(tx) };
    });
  });
}
