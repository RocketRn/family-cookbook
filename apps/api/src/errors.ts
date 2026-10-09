import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'KEEPER_CANNOT_LEAVE'
  | 'ALREADY_IN_BOOK'
  | 'NOT_IN_BOOK'
  | 'INVALID_INVITE_CODE'
  | 'NOT_PUBLISHABLE'
  | 'INTERNAL';

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const unauthorized = (message = 'Authentication required') =>
  new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Forbidden') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Not found') => new AppError(404, 'NOT_FOUND', message);

/** Every error response has this shape. */
export type ErrorBody = {
  error: { code: ErrorCode; message: string; details?: unknown; request_id: string };
};

export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((req, reply) => {
    const body: ErrorBody = {
      error: {
        code: 'NOT_FOUND',
        message: `Route ${req.method} ${req.url} not found`,
        request_id: req.id,
      },
    };
    return reply.status(404).send(body);
  });

  app.setErrorHandler((err: FastifyError | AppError | ZodError, req, reply) => {
    let status = 500;
    let code: ErrorCode = 'INTERNAL';
    let message = 'Internal server error';
    let details: unknown;

    if (err instanceof AppError) {
      status = err.statusCode;
      code = err.code;
      message = err.message;
      details = err.details;
    } else if (err instanceof ZodError) {
      status = 400;
      code = 'VALIDATION_ERROR';
      message = 'Request validation failed';
      details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    } else if ('statusCode' in err && typeof err.statusCode === 'number' && err.statusCode < 500) {
      status = err.statusCode;
      code = status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST';
      message = err.message;
    }

    if (status >= 500) req.log.error({ err }, 'unhandled error');
    else req.log.info({ code, status }, 'request rejected');

    const body: ErrorBody = {
      error: { code, message, ...(details === undefined ? {} : { details }), request_id: req.id },
    };
    return reply.status(status).send(body);
  });
}
