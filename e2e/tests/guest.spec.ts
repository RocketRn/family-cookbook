import { expect, open, test } from './fixtures';
import { api, botMessage, GUEST, KEEPER, lastMessageId, title } from './stack';

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
