import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';

/** Browsers send at most a few KB per report; anything bigger is not a CSP report. */
export const CSP_REPORT_BODY_LIMIT = 16 * 1024;
const REPORT_TYPES = ['application/csp-report', 'application/reports+json'];

type Violation = {
  directive: string;
  blocked: string;
  document: string;
  source: string;
  line: number | null;
  disposition: string;
};

const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Both report formats browsers use (D-032):
 * - `report-uri`: `{"csp-report": {"violated-directive": …, "blocked-uri": …}}`
 * - Reporting API (`report-to`): `[{"type": "csp-violation", "body": {"effectiveDirective": …}}]`
 */
export function violationsFrom(body: unknown): Violation[] | null {
  const legacy = (body as { 'csp-report'?: Record<string, unknown> } | null)?.['csp-report'];
  if (legacy && typeof legacy === 'object') {
    return [
      {
        directive: str(legacy['effective-directive'] ?? legacy['violated-directive']),
        blocked: str(legacy['blocked-uri']),
        document: str(legacy['document-uri']),
        source: str(legacy['source-file']),
        line: num(legacy['line-number']),
        disposition: str(legacy['disposition']),
      },
    ];
  }
  if (Array.isArray(body)) {
    return body
      .filter(
        (r): r is { type: string; body: Record<string, unknown> } =>
          r?.type === 'csp-violation' && !!r.body,
      )
      .slice(0, 20)
      .map((r) => ({
        directive: str(r.body.effectiveDirective),
        blocked: str(r.body.blockedURL),
        document: str(r.body.documentURL),
        source: str(r.body.sourceFile),
        line: num(r.body.lineNumber),
        disposition: str(r.body.disposition),
      }));
  }
  return null;
}

/**
 * POST /csp-report: no sign-in (browsers send reports on their own), small bodies, its own rate
 * limit. Each violation is logged as "csp violation" for the first real Telegram test (docs/CSP.md).
 */
export function registerCspReport(app: FastifyInstance, limit: preHandlerAsyncHookHandler): void {
  app.addContentTypeParser(
    REPORT_TYPES,
    { parseAs: 'string', bodyLimit: CSP_REPORT_BODY_LIMIT },
    (_req, body, done) => {
      try {
        done(null, JSON.parse(body as string));
      } catch {
        done(Object.assign(new Error('Report is not valid JSON'), { statusCode: 400 }), undefined);
      }
    },
  );
  app.post(
    '/csp-report',
    { onRequest: limit, bodyLimit: CSP_REPORT_BODY_LIMIT },
    async (req, reply) => {
      const violations = violationsFrom(req.body);
      if (!violations)
        return reply.status(400).send({
          error: { code: 'BAD_REQUEST', message: 'Not a CSP report', request_id: req.id },
        });
      for (const v of violations) req.log.warn({ csp: v }, 'csp violation');
      return reply.status(204).send();
    },
  );
}
