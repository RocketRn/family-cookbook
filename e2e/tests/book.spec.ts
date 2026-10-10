import { expect, open, test } from './fixtures';
import { KEEPER, MEMBER } from './stack';

/** QA.md P1 (sign-in and book), P2 (search), P10 (dark theme, languages). */

test('P1 sign-in: the book opens with its recipes, in the person’s language', async ({ page }) => {
  await open(page, KEEPER);
  await expect(page.getByRole('link', { name: /Голубцы/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Шарлотка \(демо\)/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Книга/ })).toBeVisible(); // the tab bar, in Russian
});

test('P2 search: a word narrows the book, and clearing it brings everything back', async ({
  page,
}) => {
  await open(page, KEEPER);
  const search = page.getByRole('searchbox', { name: 'Название или ингредиент' });
  await search.fill('голуб');
  await expect(page.getByText(/^Найдено: 1$/)).toBeVisible();
  await expect(page.getByRole('link', { name: /Голубцы/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Шарлотка/ })).toHaveCount(0);
  // An ingredient finds the recipe too (the demo charlotte has apples).
  await search.fill('яблок');
  await expect(page.getByRole('link', { name: /Шарлотка \(демо\)/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Голубцы/ })).toHaveCount(0);
  await search.fill('');
  await expect(page.getByRole('link', { name: /Голубцы/ })).toBeVisible();
});

test('P10 languages: the Profile switches the whole screen, and it is remembered', async ({
  page,
}) => {
  await open(page, MEMBER, '/profile');
  const tabs = page.getByRole('navigation');
  await expect(tabs.getByRole('link', { name: /Book/ })).toBeVisible();
  for (const [language, book] of [
    ['Українська', /Книга/],
    ['Svenska', /Bok/],
    ['Русский', /Книга/],
    ['English', /Book/],
  ] as const) {
    await page.getByRole('button', { name: language }).click();
    await expect(tabs.getByRole('link', { name: book })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Svenska' }).click();
  await expect(tabs.getByRole('link', { name: /Bok/ })).toBeVisible();
  await page.reload();
  await expect(tabs.getByRole('link', { name: /Bok/ })).toBeVisible();
  await page.getByRole('button', { name: 'English' }).click();
  await expect(tabs.getByRole('link', { name: /Book/ })).toBeVisible();
});

test('P10 dark theme: dark background, light text', async ({ page }) => {
  await open(page, MEMBER, '/?theme=dark');
  await expect(page.getByRole('link', { name: /Голубцы/ })).toBeVisible();
  const [bg, fg] = await page.evaluate(() => {
    const s = getComputedStyle(document.body);
    return [s.backgroundColor, s.color];
  });
  const light = (c: string) => {
    const [r, g, b] = c.match(/\d+/g)!.map(Number);
    return (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255;
  };
  expect(light(bg)).toBeLessThan(0.3);
  expect(light(fg)).toBeGreaterThan(0.7);
});
