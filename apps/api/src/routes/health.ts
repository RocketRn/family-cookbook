import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import type { Db } from '../db/pool.js';
import { withSystem } from '../db/tx.js';

type Delivery = {
  overdue_messages: number;
  sent: number;
  late: number;
  failed: number;
  p50_ms: number | null;
  p95_ms: number | null;
  max_ms: number | null;
};

/**
 * GET /health: is the API up and can it reach the database (Docker's check). GET /health/full
 * (BE-14, S6-4; D-057): also whether the worker keeps up, and how late the last hour's timer
 * messages were; 503 when something is wrong, so a free uptime check can e-mail the owner. Only
 * counts and times: nothing about people or recipes. Limited per address like any request.
 */
export function registerHealth(
  app: FastifyInstance,
  db: Db,
  limit: preHandlerAsyncHookHandler,
): void {
  app.get('/health', async (_req, reply) => {
    try {
      await db.query('SELECT 1');
      return { status: 'ok', db: 'ok' };
    } catch (err) {
      app.log.error({ err }, 'health check: database unreachable');
      return reply.status(503).send({ status: 'degraded', db: 'down' });
    }
  });

  app.get('/health/full', { preHandler: limit }, async (_req, reply) => {
    let d: Delivery;
    try {
      d = await withSystem(db, async (tx) => {
        const r = await tx.query<{ h: Delivery }>('SELECT delivery_health() AS h');
        return r.rows[0]!.h;
      });
    } catch (err) {
      app.log.error({ err }, 'health check: database unreachable');
      return reply.status(503).send({ status: 'degraded', db: 'down' });
    }
    const ok = d.overdue_messages === 0;
    if (!ok) app.log.warn({ overdue: d.overdue_messages }, 'health check: the worker is behind');
    return reply.status(ok ? 200 : 503).send({
      status: ok ? 'ok' : 'degraded',
      db: 'ok',
      worker: { overdue_messages: d.overdue_messages },
      timer_messages_last_hour: {
        sent: d.sent,
        late: d.late,
        failed: d.failed,
        p50_ms: d.p50_ms,
        p95_ms: d.p95_ms,
        max_ms: d.max_ms,
      },
    });
  });
}
