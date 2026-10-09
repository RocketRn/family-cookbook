import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
  type preHandlerAsyncHookHandler,
} from 'fastify';
import { randomUUID } from 'node:crypto';
import { createAuthenticate } from './auth/plugin.js';
import { registerBooks } from './books/routes.js';
import type { Config } from './config.js';
import type { Db } from './db/pool.js';
import { AppError, registerErrorHandling } from './errors.js';
import { MAX_UPLOAD_BYTES } from './media/process.js';
import { registerMedia } from './media/routes.js';
import { registerRecipes } from './recipes/routes.js';
import { registerCspReport } from './routes/cspReport.js';
import { registerHealth } from './routes/health.js';
import { WorkerParserPool, type ImportParser } from './import/parserPool.js';
import { registerImport } from './import/routes.js';
import { registerMe } from './routes/me.js';
import { S3Storage, type ObjectStorage } from './storage/storage.js';

export type AppDeps = {
  config: Config;
  db: Db;
  now?: () => Date;
  storage?: ObjectStorage;
  /** Recipe text parser for imports (tests may replace it); a worker pool by default. */
  importParser?: ImportParser;
  /** Where logs go (tests capture them); stdout by default. */
  logStream?: { write(line: string): void };
};

/** Honour a caller's x-request-id only if it is short and plain; otherwise generate one. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;
export function requestIdFrom(header: unknown): string {
  return typeof header === 'string' && SAFE_REQUEST_ID.test(header) ? header : randomUUID();
}

const MINUTE = 60_000;
const rateLimited = (ttlMs: number) =>
  new AppError(429, 'RATE_LIMITED', 'Too many requests, please slow down', {
    retry_after_seconds: Math.max(1, Math.ceil(ttlMs / 1000)),
  });

type Counter = ReturnType<FastifyInstance['createRateLimit']>;

/**
 * A hook that counts the request and answers 429 over the limit. Built on createRateLimit() on
 * purpose: the plugin's own rateLimit() hook marks a request as "limited once" and silently skips
 * every further limiter on the same request (found by tests; D-027).
 */
function limitHook(count: Counter): preHandlerAsyncHookHandler {
  return async (req, reply) => {
    const r = await count(req);
    if (!r.isAllowed && r.isExceeded) {
      reply.header('retry-after', String(r.ttlInSeconds));
      throw rateLimited(r.ttl);
    }
  };
}

export async function buildApp({
  config,
  db,
  now,
  storage,
  importParser,
  logStream,
}: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ['req.headers.authorization'],
      ...(logStream ? { stream: logStream } : {}),
    },
    genReqId: (req) => requestIdFrom(req.headers['x-request-id']),
    bodyLimit: 1024 * 1024,
    trustProxy: config.trustProxy,
  });
  const files = storage ?? new S3Storage(config.storage);
  const parser =
    importParser ??
    new WorkerParserPool({ size: config.importWorkers, timeoutMs: config.importTimeoutMs });
  app.addHook('onClose', () => parser.close());

  registerErrorHandling(app);
  await app.register(cors, {
    origin: config.corsOrigin,
    allowedHeaders: ['Authorization', 'Content-Type'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  });
  // Limits are attached per hook below (D-027); nothing is limited globally (e.g. /health).
  await app.register(rateLimit, { global: false });
  await app.register(multipart, {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 0, parts: 1 },
  });
  registerHealth(app, db);

  const L = config.rateLimits;
  const counter = (max: number, key: (r: FastifyRequest) => string) =>
    app.createRateLimit({ max, timeWindow: MINUTE, keyGenerator: key });
  // Failed sign-ins per IP: counted only when initData is rejected.
  const authFailures = counter(L.authFailuresPerIp, (r) => `auth-fail:${r.ip}`);
  const authenticate = createAuthenticate({
    config,
    db,
    now,
    onRejected: async (req) => {
      const r = await authFailures(req);
      if (!r.isAllowed && r.isExceeded) throw rateLimited(r.ttl);
    },
  });
  const perIp = limitHook(counter(L.perIp, (r) => `ip:${r.ip}`));
  // CSP reports come from browsers without sign-in (D-032): their own, separate limit per IP.
  registerCspReport(app, limitHook(counter(L.cspReportsPerIp, (r) => `csp:${r.ip}`)));
  const perUser = limitHook(counter(L.perUser, (r) => `user:${r.user?.id}`));
  const uploads = limitHook(counter(L.uploadsPerUser, (r) => `upload:${r.user?.id}`));
  const imports = limitHook(counter(L.importsPerUser, (r) => `import:${r.user?.id}`));

  await app.register(async (authed) => {
    // Before sign-in: per IP (stops floods before any HMAC or database work).
    authed.addHook('onRequest', perIp);
    authed.addHook('preHandler', authenticate);
    // After sign-in: per user (PRD 7.1: 60 requests per minute).
    authed.addHook('preHandler', perUser);

    registerMe(authed, db);
    registerBooks(authed, db);
    registerRecipes(authed, db, files);
    registerMedia(authed, db, files, uploads);
    registerImport(authed, db, files, parser, imports);
  });

  return app;
}
