import { describe, expect, it } from 'vitest';
import { buildCsp, CSP_HEADER, headersFile } from '../csp';

const directive = (policy: string, name: string) =>
  policy
    .split('; ')
    .find((d) => d.startsWith(`${name} `))
    ?.slice(name.length + 1);

describe('production CSP (Report-Only, D-032)', () => {
  it('defaults: same-origin API, Telegram script and YouTube player allowed, reports to /api', () => {
    const { policy, headers } = buildCsp({});
    expect(directive(policy, 'script-src')).toBe("'self' https://telegram.org");
    expect(directive(policy, 'frame-src')).toBe('https://www.youtube-nocookie.com');
    expect(directive(policy, 'connect-src')).toBe("'self'");
    expect(directive(policy, 'object-src')).toBe("'none'");
    expect(directive(policy, 'frame-ancestors')).toBe("'self' https://web.telegram.org");
    expect(directive(policy, 'report-uri')).toBe('/api/csp-report');
    expect(Object.keys(headers)).toEqual([CSP_HEADER]);
    expect(policy).not.toContain('report-to'); // it would make Chromium ignore report-uri
    expect(CSP_HEADER).toBe('Content-Security-Policy-Report-Only');
    expect(policy).not.toContain('unsafe-eval');
  });

  it('takes the API, S3, Telegram and YouTube addresses from env (origins only)', () => {
    const { policy, headers } = buildCsp({
      CSP_API_ORIGIN: 'https://api.cookbook.example/v1',
      CSP_S3_ORIGIN: 'https://media.cookbook.example/bucket',
      CSP_TELEGRAM_ORIGIN: 'https://telegram.org',
      CSP_YOUTUBE_ORIGIN: 'https://www.youtube-nocookie.com',
    });
    expect(directive(policy, 'connect-src')).toBe(
      "'self' https://api.cookbook.example https://media.cookbook.example",
    );
    expect(directive(policy, 'img-src')).toBe("'self' data: blob: https://media.cookbook.example");
    expect(directive(policy, 'report-uri')).toBe('https://api.cookbook.example/csp-report');
    expect(Object.keys(headers)).toEqual([CSP_HEADER]);
  });

  it('refuses a malformed address instead of shipping a broken policy', () => {
    expect(() => buildCsp({ CSP_S3_ORIGIN: 'media.example' })).toThrow(/CSP_S3_ORIGIN/);
    expect(() => buildCsp({ CSP_API_ORIGIN: 'javascript:alert(1)' })).toThrow(/CSP_API_ORIGIN/);
  });

  it('writes a _headers file for static hosting', () => {
    expect(headersFile({ A: '1', B: '2' })).toBe('/*\n  A: 1\n  B: 2\n');
  });
});
