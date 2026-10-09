import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/pool.js';
import { testApp, testPool } from './helpers/db.js';

/** D-032: the production web build sends CSP violation reports (Report-Only) here. */
let db: Db;
let app: FastifyInstance;
let lines: string[];
beforeAll(() => {
  db = testPool();
});
afterAll(() => db.end());
afterEach(() => app?.close());

const build = async (env: Record<string, string> = {}) => {
  lines = [];
  app = await testApp(db, {
    env: { LOG_LEVEL: 'info', ...env },
    logStream: { write: (l: string) => void lines.push(l) },
  });
};
const logged = () =>
  lines
    .map((l) => JSON.parse(l) as { msg: string; csp?: Record<string, unknown> })
    .filter((l) => l.msg === 'csp violation');
const post = (body: string, contentType: string, ip = '10.0.0.9') =>
  app.inject({
    method: 'POST',
    url: '/csp-report',
    payload: body,
    headers: { 'content-type': contentType },
    remoteAddress: ip,
  });

describe('POST /csp-report', () => {
  it('accepts the report-uri format without sign-in and logs the violation', async () => {
    await build();
    const res = await post(
      JSON.stringify({
        'csp-report': {
          'document-uri': 'https://cookbook.example/recipe/1',
          'violated-directive': 'img-src',
          'effective-directive': 'img-src',
          'blocked-uri': 'https://evil.example/x.png',
          'source-file': 'https://cookbook.example/assets/index.js',
          'line-number': 12,
          disposition: 'report',
        },
      }),
      'application/csp-report',
    );
    expect(res.statusCode).toBe(204);
    expect(logged()).toEqual([
      expect.objectContaining({
        csp: {
          directive: 'img-src',
          blocked: 'https://evil.example/x.png',
          document: 'https://cookbook.example/recipe/1',
          source: 'https://cookbook.example/assets/index.js',
          line: 12,
          disposition: 'report',
        },
      }),
    ]);
  });

  it('accepts the Reporting API format (report-to) and ignores other report types', async () => {
    await build();
    const res = await post(
      JSON.stringify([
        {
          type: 'csp-violation',
          body: {
            effectiveDirective: 'frame-src',
            blockedURL: 'https://other.example/',
            documentURL: 'https://cookbook.example/',
            disposition: 'report',
          },
        },
        { type: 'deprecation', body: { id: 'x' } },
      ]),
      'application/reports+json',
    );
    expect(res.statusCode).toBe(204);
    expect(logged().map((l) => l.csp?.directive)).toEqual(['frame-src']);
  });

  it('refuses what is not a report: bad JSON, other shapes, oversized bodies', async () => {
    await build();
    expect((await post('{not json', 'application/csp-report')).statusCode).toBe(400);
    expect((await post(JSON.stringify({ hello: 1 }), 'application/csp-report')).statusCode).toBe(
      400,
    );
    const big = JSON.stringify({ 'csp-report': { 'blocked-uri': 'x'.repeat(20_000) } });
    expect((await post(big, 'application/csp-report')).statusCode).toBe(413);
    expect(logged()).toEqual([]);
  });

  it('long values are cut in the log', async () => {
    await build();
    await post(
      JSON.stringify({ 'csp-report': { 'blocked-uri': 'https://x.example/' + 'a'.repeat(5000) } }),
      'application/csp-report',
    );
    expect(String(logged()[0]!.csp!.blocked).length).toBe(300);
  });

  it('has its own rate limit per IP', async () => {
    await build({ RATE_LIMIT_CSP_REPORTS_PER_IP: '2' });
    const report = JSON.stringify({ 'csp-report': { 'violated-directive': 'img-src' } });
    expect((await post(report, 'application/csp-report')).statusCode).toBe(204);
    expect((await post(report, 'application/csp-report')).statusCode).toBe(204);
    const third = await post(report, 'application/csp-report');
    expect(third.statusCode).toBe(429);
    expect(third.json().error.code).toBe('RATE_LIMITED');
    expect((await post(report, 'application/csp-report', '10.0.0.10')).statusCode).toBe(204);
  });
});
