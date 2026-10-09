import { describe, expect, it } from 'vitest';
import { assertSafeTestEnv } from './helpers/safeEnv.js';

/**
 * S5-2: a test run can never act as the production worker. The test setup (setupEnv.ts,
 * globalSetup.ts) stops before any test when the environment holds production settings, for
 * example a shell where NODE_ENV=production or TELEGRAM_LIVE was left set.
 */
describe('the test setup', () => {
  it.each([
    [{ NODE_ENV: 'production' }, /NODE_ENV/],
    [{ NODE_ENV: 'test', TELEGRAM_LIVE: 'yes' }, /TELEGRAM_LIVE/],
    [{ NODE_ENV: 'test', TELEGRAM_LIVE: 'no' }, /TELEGRAM_LIVE/],
    [{ NODE_ENV: 'test', TELEGRAM_API_BASE: 'https://api.telegram.org' }, /TELEGRAM_API_BASE/],
  ])('refuses to run with %j', (env, field) => {
    expect(() => assertSafeTestEnv(env)).toThrow(field);
  });

  it('runs with test settings and a local stand-in', () => {
    expect(() => assertSafeTestEnv({ NODE_ENV: 'test' })).not.toThrow();
    expect(() =>
      assertSafeTestEnv({ NODE_ENV: 'test', TELEGRAM_API_BASE: 'http://127.0.0.1:8081' }),
    ).not.toThrow();
  });

  it('this run itself has no production settings', () => {
    expect(process.env.NODE_ENV).not.toBe('production');
    expect(process.env.TELEGRAM_LIVE).toBeUndefined();
  });
});
