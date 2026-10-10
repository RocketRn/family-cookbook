import { expect, open, test } from './fixtures';
import { api, BOT, botMessage, KEEPER, lastMessageId, MEMBER, title } from './stack';

/** Sprint 5: reactions, the "Saved" shelf, notification settings, and the bot's /start answer. */
async function keepersRecipe() {
  const name = title('Борщ');
  const r = await api<{ id: string }>(KEEPER, 'POST', '/recipes', {
    title: name,
    servings: 4,
    language: 'ru',
    status: 'published',
    visibility: 'book',
    ingredients: [{ ref: 'a', name: 'Свёкла', qty_kind: 'exact', amount_min: 300, unit_code: 'g' }],
    steps: [{ body: 'Варите.' }],
  });
  return { id: r.id, name };
}

test('reactions: one tap adds, the author sees it, a second tap takes it back', async ({
  page,
  newUserPage,
}) => {
  const { id } = await keepersRecipe();
  await open(page, MEMBER, `/recipe/${id}`);
  const mine = page.getByRole('region', { name: 'Reactions' });
  await mine.getByRole('button', { name: 'Love it: 0' }).click();
  await expect(mine.getByRole('button', { name: 'Love it: 1' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const author = await newUserPage(KEEPER);
  await open(author, KEEPER, `/recipe/${id}`);
  await expect(
    author.getByRole('region', { name: 'Реакции' }).getByRole('button', { name: 'Нравится: 1' }),
  ).toBeVisible();
  await page.reload();
  await mine.getByRole('button', { name: 'Love it: 1' }).click();
  await expect(mine.getByRole('button', { name: 'Love it: 0' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

test('Saved: keep someone else’s recipe on your shelf, find it there, remove it', async ({
  page,
}) => {
  const { id, name } = await keepersRecipe();
  await open(page, MEMBER, `/recipe/${id}`);
  await page.getByRole('button', { name: '🔖 Save' }).click();
  await expect(page.getByRole('button', { name: '🔖 Saved' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await open(page, MEMBER, '/saved');
  await expect(page.getByRole('heading', { name: 'Saved' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Title or ingredient' }).fill(name);
  await page.getByRole('link', { name: new RegExp(name) }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await page.getByRole('button', { name: '🔖 Saved' }).click();
  await expect(page.getByRole('button', { name: '🔖 Save' })).toBeVisible();
  await open(page, MEMBER, '/saved');
  await page.getByRole('searchbox', { name: 'Title or ingredient' }).fill(name);
  await expect(page.getByRole('link', { name: new RegExp(name) })).toHaveCount(0);
});

test('notification settings: a switch is kept, and quiet mode greys out the others', async ({
  page,
}) => {
  await open(page, MEMBER, '/profile');
  const settings = page.getByRole('region', { name: 'Notifications' });
  const newRecipe = settings.getByRole('checkbox', { name: 'A new recipe in the book' });
  await expect(settings.getByRole('checkbox', { name: 'Someone cooked my recipe' })).toBeChecked();
  await expect(newRecipe).not.toBeChecked();
  try {
    // A switch changes once its saving starts (a moment after the tap), hence click, then wait.
    await newRecipe.click();
    await expect(newRecipe).toBeChecked();
    await page.reload();
    await expect(newRecipe).toBeChecked();
    const quiet = settings.getByRole('checkbox', { name: 'Quiet mode' });
    await quiet.click();
    await expect(quiet).toBeChecked();
    await expect(newRecipe).toBeDisabled();
    await expect(
      settings.getByRole('checkbox', { name: 'Someone cooked my recipe' }),
    ).toBeDisabled();
  } finally {
    await api(MEMBER, 'PATCH', '/me', { notify_prefs: { new_recipe: false, mute_social: false } });
  }
});

test('the bot answers /start in the person’s language, with a button into the app', async ({
  page,
}) => {
  const after = await lastMessageId();
  // As the person would in Telegram: press /start (the stand-in page's button).
  await page.goto(BOT);
  const form = page.locator('form[action="/__start"]');
  await form.locator('select').selectOption(MEMBER.chat);
  await form.getByRole('button', { name: 'Нажать /start' }).click();
  // The answer goes out through the outbox, like every bot message; the page shows it.
  const msg = await botMessage(MEMBER.chat, after, '👋 Hello! This is your family cookbook');
  expect(msg.reply_markup?.inline_keyboard[0]?.[0]?.text).toBe('Open the cookbook');
  await page.reload();
  const answer = page.getByRole('listitem').filter({ hasText: `#${msg.message_id} · chat` });
  await expect(answer).toContainText(`chat ${MEMBER.chat}`);
  await expect(answer).toContainText('Open the cookbook');
});
