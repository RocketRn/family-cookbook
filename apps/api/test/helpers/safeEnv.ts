import { isLocalStandIn } from '../../src/notify/telegram.js';

/**
 * A test run must never be able to act as the production worker (S5-2, after the Sprint 4 near
 * miss). The test setup calls this before any test, so a terminal where NODE_ENV=production or
 * TELEGRAM_LIVE was left set stops the run instead of carrying those settings into it.
 */
export function assertSafeTestEnv(env: Record<string, string | undefined>): void {
  const problems: string[] = [];
  if (env.NODE_ENV === 'production') problems.push('NODE_ENV=production');
  if (env.TELEGRAM_LIVE !== undefined) problems.push('TELEGRAM_LIVE is set');
  if (env.TELEGRAM_API_BASE && !isLocalStandIn(env.TELEGRAM_API_BASE)) {
    problems.push('TELEGRAM_API_BASE is not a local stand-in');
  }
  if (problems.length) {
    throw new Error(
      `Refusing to run the tests with production settings in the environment: ${problems.join(
        '; ',
      )}. Unset them in this terminal first.`,
    );
  }
}
