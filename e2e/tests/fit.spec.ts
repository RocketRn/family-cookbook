import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, open, test } from './fixtures';
import { api, GUEST, MEMBER, title, type DevUser } from './stack';

/**
 * UX-06 / S6-6 (PRD 6.4: "string-length check, uk and sv are longer"): every main screen and
 * sheet at 320 px, the narrowest phone Telegram runs on, in Ukrainian and Swedish (and Russian,
 * the family's language). Nothing may stick out of the screen or be cut off: no sideways
 * scrolling, no button or label wider than its box. Only the photo gallery scrolls sideways.
 * Found by it: the editor's unit chip ("ingen enhet") and a step's timer on a recalculated card
 * ("tiden kan skilja sig") did not fit in Swedish.
 */
const GOLUBTSY = '00000000-0000-4000-8000-0000000000c1'; // seeded, in the demo book

/** The longest things a person writes: a title with a long compound word, a long tag, a long timer label. */
const LONG_TAG = 'Праздничные блюда для большой семьи на выходные дни'.slice(0, 50);
const LONG_LABEL =
  'Тушите голубцы под крышкой на медленном огне, пока капуста не станет совсем мягкой и нежной'.slice(
    0,
    100,
  );
async function longestRecipe() {
  const r = await api<{ id: string; steps: Array<{ id: string }> }>(MEMBER, 'POST', '/recipes', {
    title: title('Smörgåstårtsförberedelseinstruktioner и голубцы по-полтавски'),
    servings: 4,
    language: 'ru',
    status: 'published',
    visibility: 'book',
    tags: [LONG_TAG],
    ingredients: [
      {
        ref: 'a',
        name: 'Капуста белокочанная молодая',
        qty_kind: 'exact',
        amount_min: 1,
        unit_code: 'pcs',
      },
    ],
    steps: [
      { body: 'Сверните голубцы и тушите.', timers: [{ label: LONG_LABEL, duration_sec: 5400 }] },
    ],
  });
  return { id: r.id, stepId: r.steps[0]!.id };
}
/** A running timer with that label: its chip shows on the card and in cooking mode. */
async function longTimer(recipe: { id: string; stepId: string }) {
  const t = await api<{ timer: { id: string } }>(MEMBER, 'POST', '/timers', {
    client_timer_id: crypto.randomUUID(),
    recipe_id: recipe.id,
    step_id: recipe.stepId,
    label: LONG_LABEL,
    duration_sec: 3600,
  });
  return t.timer.id;
}

type Dict = Record<string, unknown>;
const locale = (lang: string): Dict =>
  JSON.parse(
    readFileSync(new URL(`../../apps/web/src/i18n/locales/${lang}.json`, import.meta.url), 'utf8'),
  ) as Dict;
/** A text from the app's own translations; `{{…}}` parts match anything. */
function text(dict: Dict, key: string): RegExp {
  const v = key.split('.').reduce<unknown>((o, k) => (o as Dict)[k], dict);
  if (typeof v !== 'string') throw new Error(`no text ${key}`);
  const parts = v.split(/\{\{[^}]+\}\}/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^\\s*${parts.join('.*')}\\s*$`);
}

/** What does not fit, in words a person can act on. Runs in the page. */
function misfits(): string[] {
  const vw = document.documentElement.clientWidth;
  const out: string[] = [];
  const name = (el: Element) =>
    `<${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : ''}> "${((el as HTMLElement).innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 50)}"`;
  const scrolls = (el: Element) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowX);
  // A row meant to scroll sideways (the photo gallery): a flex row that does not wrap. The main
  // area and the sheets scroll up and down (their overflow-x is "auto" only by CSS's rules).
  const sideways = (el: Element) => {
    const c = getComputedStyle(el);
    return (
      scrolls(el) &&
      c.display.includes('flex') &&
      !c.flexDirection.startsWith('column') &&
      c.flexWrap === 'nowrap'
    );
  };
  const inSideways = (el: Element) => {
    for (let p = el.parentElement; p; p = p.parentElement) if (sideways(p)) return true;
    return false;
  };
  if (document.documentElement.scrollWidth > vw + 1)
    out.push(`the page scrolls sideways (${document.documentElement.scrollWidth} px wide)`);
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    if (el.closest('[aria-hidden="true"], svg, input, textarea, select, iframe')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.position === 'fixed' || inSideways(el)) continue;
    if (scrolls(el)) {
      if (!sideways(el) && el.scrollWidth > el.clientWidth + 1)
        out.push(
          `${name(el).slice(0, 40)}…> scrolls sideways (${el.scrollWidth} px in ${el.clientWidth} px)`,
        );
      continue;
    }
    // Cut on purpose, with "…" (a long title in a one-line list row).
    if (cs.textOverflow === 'ellipsis') continue;
    if (r.right > vw + 1 || r.left < -1)
      out.push(`${name(el)} sticks out (${Math.round(r.left)}…${Math.round(r.right)} px)`);
    else if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0)
      out.push(`${name(el)} is cut off (${el.scrollWidth} px of text in ${el.clientWidth} px)`);
  }
  return [...new Set(out)];
}

test('the check itself finds a cut-off button and a block wider than the screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await open(page, MEMBER, '/');
  await expect(page.locator('h1').first()).toBeVisible();
  expect(await page.evaluate(misfits)).toEqual([]);
  await page.evaluate(() => {
    const b = document.createElement('button');
    b.style.cssText = 'width: 80px; flex: none; white-space: nowrap; overflow: hidden';
    b.textContent = 'Перерахувати рецепт';
    const d = document.createElement('div');
    d.style.cssText = 'width: 400px; flex: none';
    d.textContent = 'x';
    document.querySelector('.shell__content')!.append(b, d);
  });
  const found = await page.evaluate(misfits);
  expect(found).toContainEqual(expect.stringMatching(/scrolls sideways/));
  expect(found).toContainEqual(expect.stringMatching(/<button> "Перерахувати рецепт" is cut off/));
  expect(found).toContainEqual(expect.stringMatching(/<div> "x" sticks out/));
});

for (const lang of ['uk', 'sv', 'ru'] as const) {
  test.describe(`${lang} at 320 px`, () => {
    const t = (key: string) => text(locale(lang), key);
    test.use({ viewport: { width: 320, height: 640 } });
    test.beforeEach(async ({ context }) => {
      await context.addInitScript((l) => localStorage.setItem('ui_lang', l), lang);
    });

    const found: string[] = [];
    async function check(page: Page, where: string) {
      await page.waitForLoadState('networkidle');
      await page.evaluate(() => document.fonts.ready);
      for (const m of await page.evaluate(misfits)) found.push(`${where}: ${m}`);
    }
    async function visit(page: Page, user: DevUser, path: string, where: string) {
      await open(page, user, path);
      await expect(page.locator('h1').first()).toBeVisible();
      await check(page, where);
    }

    test('every main screen and sheet fits', async ({ page, newUserPage }) => {
      found.length = 0;
      const long = await longestRecipe();
      await visit(page, MEMBER, '/', 'book');
      await page.getByRole('button', { name: t('book.filters') }).click();
      await check(page, 'book → filters');

      await visit(page, MEMBER, '/', 'book');
      await page.getByRole('button', { name: t('book.new_recipe') }).click();
      await check(page, 'book → new recipe');

      await visit(page, MEMBER, '/saved', 'saved');
      await page.getByRole('button', { name: t('book.filters') }).click();
      await check(page, 'saved → filters');
      await visit(page, MEMBER, '/profile', 'profile');

      await visit(page, MEMBER, `/recipe/${GOLUBTSY}`, 'recipe card');
      await page.getByRole('button', { name: t('recipe.recalculate') }).click();
      await check(page, 'recipe card → recalculate');
      await page.getByRole('button', { name: t('recalc.mode_product') }).click();
      await page.getByRole('button', { name: 'Говяжий фарш' }).click();
      await check(page, 'recipe card → recalculate from one product');
      await page.getByLabel(t('recalc.have')).fill('300');
      await page
        .getByRole('dialog', { name: t('recalc.title') })
        .getByRole('button', { name: t('recalc.apply') })
        .click();
      await check(page, 'recipe card, recalculated (with its notes)');
      await visit(page, MEMBER, `/recipe/${GOLUBTSY}`, 'recipe card');
      await page.getByRole('button', { name: t('common.share') }).click();
      await check(page, 'recipe card → share');
      await visit(page, MEMBER, `/recipe/${GOLUBTSY}/cooked`, 'I cooked it');

      await visit(page, MEMBER, `/cook/${GOLUBTSY}`, 'cooking: before the start');
      await page.getByRole('button', { name: t('cook.start') }).click();
      await check(page, 'cooking: step 1');
      await page.getByRole('button', { name: t('cook.next') }).click();
      await check(page, 'cooking: step 2');
      const next = page.getByRole('button', { name: t('cook.next') });
      while (await next.isVisible()) await next.click();
      await check(page, 'cooking: the last step');
      await page.getByRole('button', { name: t('cook.finish') }).click();
      await expect(page.getByRole('heading', { name: t('cook.done_title') })).toBeVisible();
      await check(page, 'cooking: done');

      const timer = await longTimer(long);
      try {
        await visit(page, MEMBER, `/recipe/${long.id}`, 'the longest texts: card');
        await visit(page, MEMBER, `/cook/${long.id}`, 'the longest texts: cooking');
        await page.getByRole('button', { name: t('cook.start') }).click();
        await check(page, 'the longest texts: cooking, the step with its timer');
      } finally {
        // Its chip would cover the buttons of the next screens and tests.
        await api(MEMBER, 'DELETE', `/timers/${timer}`);
      }

      await visit(page, MEMBER, '/recipe/new', 'editor');
      await page
        .getByRole('button', { name: t('editor.ingredient_details') })
        .first()
        .click();
      await check(page, 'editor → ingredient details');
      await visit(page, MEMBER, '/import', 'paste recipe text');

      // Someone not in a book yet: the first screen.
      const guest = await newUserPage(GUEST);
      await guest.context().addInitScript((l) => localStorage.setItem('ui_lang', l), lang);
      await visit(guest, GUEST, '/', 'first screen (no book yet)');

      expect(found, `texts that do not fit at 320 px in ${lang}`).toEqual([]);
    });
  });
}
