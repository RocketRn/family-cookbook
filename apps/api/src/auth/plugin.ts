import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config.js';
import type { Db } from '../db/pool.js';
import { withSystem } from '../db/tx.js';
import { forbidden, unauthorized } from '../errors.js';
import { upsertFromTelegram, type User } from '../users/repo.js';
import { InitDataError, validateInitData } from './initData.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
  }
}

export type AuthDeps = {
  config: Config;
  db: Db;
  now?: () => Date;
  /** Called when initData is rejected (counts failed sign-ins; may throw 429). */
  onRejected?: (req: FastifyRequest) => Promise<void>;
};

/** Authorization: tma <initData>. Validates on every request (no sessions) and attaches req.user. */
export function createAuthenticate({ config, db, now = () => new Date(), onRejected }: AuthDeps) {
  return async function authenticate(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const header = req.headers.authorization;
    if (!header) throw unauthorized('Missing Authorization header');
    const [scheme, ...rest] = header.split(' ');
    if (scheme?.toLowerCase() !== 'tma' || rest.length === 0) {
      throw unauthorized('Authorization scheme must be "tma <initData>"');
    }

    let data;
    try {
      data = validateInitData(rest.join(' '), {
        tokens: config.initDataTokens,
        maxAgeSeconds: config.initDataMaxAgeSeconds,
        now: now(),
      });
    } catch (err) {
      if (err instanceof InitDataError) {
        // The precise reason is logged, never returned to the client.
        req.log.warn({ reason: err.reason }, 'initData rejected');
        await onRejected?.(req);
        throw unauthorized('Invalid or expired initData');
      }
      throw err;
    }

    const user = await withSystem(db, (tx) => upsertFromTelegram(tx, data.user));
    if (user.deleted_at) throw forbidden('Account deleted');
    req.user = user;
  };
}

export function currentUser(req: FastifyRequest): User {
  if (!req.user) throw unauthorized();
  return req.user;
}
