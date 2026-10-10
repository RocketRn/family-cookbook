import { errorsOf, expect, open, test, watch } from './fixtures';
import { api, BOT, botMessage, GUEST, KEEPER, lastMessageId, title } from './stack';

/**
 * FE-11 / S6-3 (PRD UC-08; owner's Sprint 6 answer 2; D-055): someone outside the book opens a
 * recipe shared by link. They read it and cook it with timers; no saving and no reactions.
 */
test('a guest opens a recipe shared by link: reads it, starts a timer, gets the bot’s message', async ({
  page,
}) => {
  const book = await api<{ id: string } | null>(GUEST, 'GET', '/books/current').catch(() => null);
  test.skip(
    !!book,
    'Dev user 3 has joined the demo book (RUN-LOCALLY 5.8); the guest test needs a fresh demo.',
  );
  const name = title('Яйца пашот');
  const label = `Варить ${Date.now().toString(36).slice(-4)}`;
  const r = await api<{ id: string; share_token: string }>(KEEPER, 'POST', '/recipes', {
    title: name,
    servings: 2,
    language: 'ru',
    status: 'published',
    visibility: 'link',
    ingredients: [{ ref: 'a', name: 'Яйца', qty_kind: 'exact', amount_min: 2, unit_code: 'pcs' }],
    steps: [{ body: 'Варите яйца.', timers: [{ label, duration_sec: 3 }] }],
  });
  expect(r.share_token).toBeTruthy();

  await open(page, GUEST, `/r/${r.share_token}`);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(page.getByText(/delats med dig via länk/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Räkna om', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Laga', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '🔖 Spara' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Reaktioner' })).toHaveCount(0);

  const after = await lastMessageId();
  await page.getByRole('button', { name: `⏱ Starta timer: ${label}, 0:03` }).click();
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 });
  const msg = await botMessage(GUEST.chat, after, label);
  expect(msg.plain).toContain(name);
});

test('the author shares a recipe by link; the shared message’s button opens it for a guest', async ({
  page,
}) => {
  const book = await api<{ id: string } | null>(GUEST, 'GET', '/books/current').catch(() => null);
  test.skip(!!book, 'Dev user 3 has joined the demo book; the guest test needs a fresh demo.');
  const name = title('Сырники по ссылке');
  const r = await api<{ id: string }>(KEEPER, 'POST', '/recipes', {
    title: name,
    servings: 2,
    language: 'ru',
    status: 'published',
    visibility: 'link',
    ingredients: [{ ref: 'a', name: 'Творог', qty_kind: 'exact', amount_min: 500, unit_code: 'g' }],
    steps: [{ body: 'Смешайте и обжарьте.' }],
  });

  await open(page, KEEPER, `/recipe/${r.id}`);
  await page.getByRole('button', { name: 'Поделиться', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Поделиться рецептом' });
  await expect(sheet.getByText(/кто угодно/)).toBeVisible();
  await sheet.getByRole('button', { name: 'Отправить в чат' }).click();
  await expect(page.getByText('Отправлено')).toBeVisible();

  // The stand-in shows the prepared message as the chat would; its button opens it as user 3.
  await page.goto(BOT);
  const shared = page.getByRole('listitem').filter({ hasText: name }).first();
  await expect(shared).toContainText(name);
  const [guest] = await Promise.all([
    page.context().waitForEvent('page'),
    shared.getByRole('link', { name: 'Открыть рецепт' }).click(),
  ]);
  watch(guest);
  await expect(guest.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(guest.getByText(/delats med dig via länk/)).toBeVisible();
  expect(errorsOf(guest), 'errors in the browser').toEqual([]);
  await guest.close();
});
