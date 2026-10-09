import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/pool.js';

export function registerHealth(app: FastifyInstance, db: Db): void {
  app.get('/health', async (_req, reply) => {
    try {
      await db.query('SELECT 1');
      return { status: 'ok', db: 'ok' };
    } catch (err) {
      app.log.error({ err }, 'health check: database unreachable');
      return reply.status(503).send({ status: 'degraded', db: 'down' });
    }
  });
}
