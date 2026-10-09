import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser } from '../auth/plugin.js';
import type { Db } from '../db/pool.js';
import { withUser } from '../db/tx.js';
import { AppError, notFound } from '../errors.js';

const startBody = z
  .object({
    recipe_id: z.string().uuid(),
    recipe_version: z.number().int().min(1),
    scale_factor: z.number().positive().max(20).optional(),
  })
  .strict();
const idParams = z.object({ id: z.string().uuid() });
const patchBody = z
  .object({
    max_step_index: z.number().int().min(0).max(59).optional(),
    state: z.enum(['finished', 'abandoned']).optional(),
  })
  .strict()
  .refine((b) => b.max_step_index !== undefined || b.state !== undefined, {
    message: 'Nothing to change',
  });

type SessionRow = {
  id: string;
  recipe_id: string;
  recipe_version: number;
  scale_factor: string;
  state: 'active' | 'finished' | 'abandoned';
  max_step_index: number;
  started_at: Date;
  updated_at: Date;
  finished_at: Date | null;
};

const sessionView = (s: SessionRow) => ({
  id: s.id,
  recipe_id: s.recipe_id,
  recipe_version: s.recipe_version,
  scale_factor: Number(s.scale_factor),
  state: s.state,
  max_step_index: s.max_step_index,
  started_at: s.started_at.toISOString(),
  updated_at: s.updated_at.toISOString(),
  finished_at: s.finished_at?.toISOString() ?? null,
});

const COLUMNS =
  'id, recipe_id, recipe_version, scale_factor, state, max_step_index, started_at, updated_at, finished_at';
const sessionNotFound = () => notFound('Cooking session not found');

/**
 * Cooking sessions (PRD 4.8, 3.2): for analytics and to link timers to a cooking run. The progress
 * itself (current step, ticks) stays on the device. Own sessions only, for recipes the user can read.
 */
export function registerCookSessions(app: FastifyInstance, db: Db): void {
  app.post('/cook-sessions', async (req, reply) => {
    const user = currentUser(req);
    const b = startBody.parse(req.body);
    const session = await withUser(db, { userId: user.id }, async (tx) => {
      const r = await tx.query('SELECT 1 FROM recipes WHERE id = $1', [b.recipe_id]);
      if (!r.rowCount) throw notFound('Recipe not found');
      const s = await tx.query<SessionRow>(
        `INSERT INTO cook_sessions (user_id, recipe_id, recipe_version, scale_factor)
         VALUES (app_user_id(), $1, $2, $3)
         RETURNING ${COLUMNS}`,
        [b.recipe_id, b.recipe_version, b.scale_factor ?? 1],
      );
      return s.rows[0]!;
    });
    return reply.status(201).send(sessionView(session));
  });

  // Records the furthest step reached (it never goes back) and the end of the session.
  app.patch('/cook-sessions/:id', async (req) => {
    const user = currentUser(req);
    const { id } = idParams.parse(req.params);
    const b = patchBody.parse(req.body);
    return withUser(db, { userId: user.id }, async (tx) => {
      const r = await tx.query<SessionRow>(
        `UPDATE cook_sessions
            SET max_step_index = greatest(max_step_index, coalesce($2, max_step_index)),
                state = coalesce($3::cook_session_state, state),
                finished_at = CASE WHEN $3 = 'finished' THEN now() END,
                updated_at = now()
          WHERE id = $1 AND state = 'active'
         RETURNING ${COLUMNS}`,
        [id, b.max_step_index ?? null, b.state ?? null],
      );
      if (r.rows[0]) return sessionView(r.rows[0]);
      const exists = await tx.query('SELECT 1 FROM cook_sessions WHERE id = $1', [id]);
      if (!exists.rowCount) throw sessionNotFound();
      throw new AppError(409, 'CONFLICT', 'This cooking session has already ended');
    });
  });
}
