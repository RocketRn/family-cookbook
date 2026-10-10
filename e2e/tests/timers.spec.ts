import { expect, open, test } from './fixtures';
import { api, BOT, botAction, botMessage, lastMessageId, MEMBER, title } from './stack';

/**
 * Timers outside cooking mode and when things go wrong (QA.md P11, P12; D-050): a timer started
 * from the recipe card, a timer started without a connection, and one the bot cannot announce.
 */
async function recipeWithTimer(seconds: number) {
  const name = title('Яйца всмятку');
  // Unique, so timers of earlier runs (listed for 15 minutes after they end) are not mistaken for it.
  const label = `Варить ${Date.now().toString(36).slice(-4)}`;
  const r = await api<{ id: string }>(MEMBER, 'POST', '/recipes', {
    title: name,
    servings: 2,
    language: 'ru',
    status: 'published',
    visibility: 'book',
    ingredients: [{ ref: 'a', name: 'Яйца', qty_kind: 'exact', amount_min: 2, unit_code: 'pcs' }],
    steps: [{ body: 'Варите яйца.', timers: [{ label, duration_sec: seconds }] }],
  });
  return { id: r.id, name, label };
}

test('a timer from the recipe card: counts down, rings, and the bot writes', async ({ page }) => {
  const { id, name, label } = await recipeWithTimer(3);
  await open(page, MEMBER, `/recipe/${id}`);
  const after = await lastMessageId();
  await page.getByRole('button', { name: `⏱ Start timer: ${label}, 0:03` }).click();
  const panel = page.getByRole('region', { name: 'Timers' });
  await expect(
    panel.getByRole('button', { name: new RegExp(`^⏱ ${label} · 0:0\\d$`) }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 });
  const msg = await botMessage(MEMBER.chat, after, name);
  expect(msg.plain).toContain(label);
});

test('P12 no connection: the timer runs on the screen, then syncs once (no second timer)', async ({
  page,
  context,
}) => {
  const { id, label } = await recipeWithTimer(600);
  await open(page, MEMBER, `/recipe/${id}`);
  await expect(page.getByRole('button', { name: `⏱ Start timer: ${label}, 10:00` })).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('button', { name: `⏱ Start timer: ${label}, 10:00` }).click();
  await expect(page.getByText(/^No connection: this timer runs only on this screen/)).toBeVisible();
  const panel = page.getByRole('region', { name: 'Timers' });
  await expect(
    panel.getByRole('button', { name: new RegExp(`^⏱ ${label} · (10:00|9:5\\d)$`) }),
  ).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText(/^No connection/)).toBeHidden({ timeout: 15_000 });
  const timers = async () =>
    (
      await api<{ timers: Array<{ recipe_id: string; status: string; id: string }> }>(
        MEMBER,
        'GET',
        '/timers?active=1',
      )
    ).timers.filter((t) => t.recipe_id === id && t.status === 'running');
  await expect.poll(async () => (await timers()).length).toBe(1);
  // Tidy: cancel it from the card.
  await panel.getByRole('button', { name: new RegExp(`^⏱ ${label}`) }).click();
  await page.getByRole('button', { name: 'Cancel timer' }).click();
  await expect.poll(async () => (await timers()).length).toBe(0);
});

test('the bot is blocked: the timer still rings, and says its message was not delivered', async ({
  page,
}) => {
  const { id, label } = await recipeWithTimer(3);
  // As the person would in Telegram: block the bot (the stand-in page's button).
  const bot = await page.context().newPage();
  await bot.goto(BOT);
  const form = bot.locator('form[action="/__block"]');
  await form.locator('select').selectOption(MEMBER.chat);
  await form.getByRole('button', { name: 'Заблокировать бота' }).click();
  await expect(bot.getByText(`Заблокировали бота: ${MEMBER.chat}`)).toBeVisible();
  await bot.close();
  try {
    await open(page, MEMBER, `/recipe/${id}`);
    await page.getByRole('button', { name: `⏱ Start timer: ${label}, 0:03` }).click();
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('alert').getByRole('button').first().click();
    const panel = page.getByRole('region', { name: 'Timers' });
    await expect(
      panel.getByRole('button', { name: `⚠️ ${label} · message not delivered` }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(panel.getByRole('button', { name: 'Open the bot' })).toBeVisible();
  } finally {
    await botAction('unblock', MEMBER.chat);
    await botAction('start', MEMBER.chat);
  }
});
