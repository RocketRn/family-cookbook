import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { createAuthenticate } from './auth/plugin.js';
import { registerBooks } from './books/routes.js';
import type { Config } from './config.js';
import type { Db } from './db/pool.js';
import { registerErrorHandling } from './errors.js';
import { registerHealth } from './routes/health.js';
import { registerMe } from './routes/me.js';

export type AppDeps = { config: Config; db: Db; now?: () => Date };

export async function buildApp({ config, db, now }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ['req.headers.authorization'],
    },
    genReqId: (req) =>
      typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : randomUUID(),
    bodyLimit: 1024 * 1024,
  });

  registerErrorHandling(app);
  await app.register(cors, {
    origin: config.corsOrigin,
    allowedHeaders: ['Authorization', 'Content-Type'],
  });
  registerHealth(app, db);

  const authenticate = createAuthenticate({ config, db, now });
  await app.register(async (authed) => {
    authed.addHook('preHandler', authenticate);
    registerMe(authed);
    registerBooks(authed, db);
  });

  return app;
}
