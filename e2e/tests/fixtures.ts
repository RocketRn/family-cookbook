import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';
import { WEB, type DevUser } from './stack';

/**
 * Each test fails if the page throws, logs an error, or the API answers with a server error.
 * Telegram's script is not fetched: outside Telegram it is inert, and tests make no outside calls.
 */
const errors = new WeakMap<Page, string[]>();
export const LIMITS_HINT =
  'Start the demo for the browser tests with higher request limits: pnpm demo:stop, then ' +
  'RATE_LIMIT_PER_USER=10000 RATE_LIMIT_PER_IP=10000 pnpm demo (docs/QA.md section 4).';
export function watch(page: Page): Page {
  const list: string[] = [];
  errors.set(page, list);
  page.on('pageerror', (e) => list.push(`page error: ${e.message}`));
  page.on('console', (m) => {
    // A failed request is reported below by status; the blocked Telegram script is expected.
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource'))
      list.push(`console error: ${m.text()}`);
  });
  page.on('response', (r) => {
    if (!r.url().startsWith(`${WEB}/api/`)) return;
    if (r.status() >= 500) list.push(`API ${r.status()}: ${r.request().method()} ${r.url()}`);
    // The tests click far faster than a person, so the demo runs with higher request limits.
    if (r.status() === 429)
      list.push(`API 429 (too many requests): ${r.request().method()} ${r.url()}. ${LIMITS_HINT}`);
  });
  return page;
}

async function offline(context: BrowserContext) {
  await context.route('https://telegram.org/**', (r) => r.abort());
}

export const test = base.extend<{ newUserPage: (user: DevUser) => Promise<Page> }>({
  context: async ({ context }, use) => {
    await offline(context);
    await use(context);
  },
  page: async ({ page }, use) => {
    watch(page);
    await use(page);
    expect(errors.get(page), 'errors in the browser').toEqual([]);
  },
  /** A second person on a second "phone" (their own browser context), e.g. the recipe's author. */
  newUserPage: async ({ browser }, use) => {
    const pages: Page[] = [];
    await use(async () => {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await offline(context);
      const page = watch(await context.newPage());
      pages.push(page);
      return page;
    });
    for (const page of pages) {
      expect(errors.get(page), 'errors in the browser').toEqual([]);
      await page.context().close();
    }
  },
});
export { expect };

/** Opens the app as a dev user (the development sign-in, `?devUser=`). */
export async function open(page: Page, user: DevUser, path = '/') {
  await page.goto(`${path}${path.includes('?') ? '&' : '?'}devUser=${user.key}`);
}
