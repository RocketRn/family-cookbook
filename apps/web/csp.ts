/**
 * Content-Security-Policy of the production web build (D-032, PRD 7.1). It ships as
 * Content-Security-Policy-Report-Only first: nothing is blocked, violations are reported to the
 * API (POST /csp-report). Enforcing comes after the first real Telegram test (docs/CSP.md).
 * Addresses come from the build environment:
 *   CSP_API_ORIGIN       API origin when it is not this site (default: same origin, reached at /api)
 *   CSP_S3_ORIGIN        where photo links point (S3_PUBLIC_ENDPOINT of the API)
 *   CSP_TELEGRAM_ORIGIN  Telegram's Mini App script (default https://telegram.org)
 *   CSP_YOUTUBE_ORIGIN   the embedded player (default https://www.youtube-nocookie.com)
 *   CSP_FRAME_ANCESTORS  who may show the app in a frame (default 'self' https://web.telegram.org)
 *   CSP_REPORT_URI       where reports go (default <API>/csp-report)
 */
export type CspEnv = Partial<
  Record<
    | 'CSP_API_ORIGIN'
    | 'CSP_S3_ORIGIN'
    | 'CSP_TELEGRAM_ORIGIN'
    | 'CSP_YOUTUBE_ORIGIN'
    | 'CSP_FRAME_ANCESTORS'
    | 'CSP_REPORT_URI',
    string | undefined
  >
>;

export const CSP_HEADER = 'Content-Security-Policy-Report-Only';

function origin(name: string, value: string | undefined): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute http(s) URL, got "${value}"`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new Error(`${name} must be an absolute http(s) URL, got "${value}"`);
  return url.origin;
}

export function buildCsp(env: CspEnv): {
  policy: string;
  reportUri: string;
  headers: Record<string, string>;
} {
  const api = origin('CSP_API_ORIGIN', env.CSP_API_ORIGIN);
  const s3 = origin('CSP_S3_ORIGIN', env.CSP_S3_ORIGIN);
  const telegram = origin(
    'CSP_TELEGRAM_ORIGIN',
    env.CSP_TELEGRAM_ORIGIN ?? 'https://telegram.org',
  )!;
  const youtube = origin(
    'CSP_YOUTUBE_ORIGIN',
    env.CSP_YOUTUBE_ORIGIN ?? 'https://www.youtube-nocookie.com',
  )!;
  const reportUri = env.CSP_REPORT_URI ?? (api ? `${api}/csp-report` : '/api/csp-report');
  const ancestors = env.CSP_FRAME_ANCESTORS ?? "'self' https://web.telegram.org";
  const list = (...xs: Array<string | null>) => xs.filter(Boolean).join(' ');

  const directives: Array<[string, string]> = [
    ['default-src', "'self'"],
    // Telegram's official script is loaded from its site (index.html); nothing else runs.
    ['script-src', list("'self'", telegram)],
    // React and Telegram set some styles at run time.
    ['style-src', "'self' 'unsafe-inline'"],
    // Photos are signed S3 links; data:/blob: for the photo preview before upload (FE-04).
    ['img-src', list("'self'", 'data:', 'blob:', s3)],
    ['font-src', "'self' data:"],
    ['connect-src', list("'self'", api, s3)],
    // The YouTube player, loaded only when the user taps play (D-030).
    ['frame-src', youtube],
    ['media-src', "'self' blob:"],
    ['object-src', "'none'"],
    ['base-uri', "'self'"],
    ['form-action', "'self'"],
    // Telegram Web shows Mini Apps in a frame; Telegram's native apps use a WebView (A-23).
    ['frame-ancestors', ancestors],
    // report-uri only: with a report-to directive present Chromium ignores report-uri, and in our
    // test Chromium did not deliver report-to reports at all (D-032). WebKit (iOS) supports report-uri.
    ['report-uri', reportUri],
  ];
  const policy = directives.map(([k, v]) => `${k} ${v}`).join('; ');
  return {
    policy,
    reportUri,
    headers: { [CSP_HEADER]: policy },
  };
}

/** `_headers` file (Netlify / Cloudflare Pages format); other hosts copy the same two headers. */
export function headersFile(headers: Record<string, string>): string {
  return `/*\n${Object.entries(headers)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n')}\n`;
}
