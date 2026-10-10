import { errorsOf, expect, test, watch } from './fixtures';
import { api, BOT, botMessage, KEEPER, lastMessageId, MEMBER, title } from './stack';

/**
 * S6-2 (PRD 2.2 variant B, UC-02; D-054): a recipe forwarded to the bot becomes a private draft,
 * and the button in the bot's answer opens "Check the recipe" on it.
 */
test('a recipe forwarded to the bot becomes a private draft; its button opens the review', async ({
  page,
}) => {
  const name = title('Оладьи');
  const after = await lastMessageId();

  await test.step('the keeper forwards a recipe text to the bot (the stand-in page)', async () => {
    await page.goto(BOT);
    const form = page.locator('form[action="/__forward"]');
    await form.locator('select').selectOption(KEEPER.chat);
    await form
      .getByRole('textbox', { name: 'Текст рецепта' })
      .fill(
        [
          name,
          '',
          'Ингредиенты:',
          'Кефир — 500 мл',
          'Мука — 2 стакана',
          '',
          'Приготовление:',
          '1. Смешайте кефир с мукой.',
          '2. Жарьте по 2 минуты с каждой стороны.',
        ].join('\n'),
      );
    await form.getByRole('button', { name: 'Переслать боту' }).click();
  });

  let draftId = '';
  await test.step('the bot answers: saved to the drafts, with "Check the recipe"', async () => {
    const msg = await botMessage(KEEPER.chat, after, name);
    expect(msg.plain).toContain('черновики');
    expect(msg.reply_markup?.inline_keyboard[0]?.[0]?.text).toBe('Проверить рецепт');
    const start = new URL(msg.reply_markup!.inline_keyboard[0]![0]!.url).searchParams.get(
      'startapp',
    );
    expect(start).toMatch(/^draft_[0-9a-f]{32}$/);
    draftId = start!.slice(6).replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
    // Private: the member does not see it.
    const book = await api<{ items: Array<{ id: string }> }>(
      MEMBER,
      'GET',
      '/recipes?scope=book&limit=50',
    );
    expect(book.items.map((i) => i.id)).not.toContain(draftId);
  });

  await test.step('the button opens the review of that draft; publishing puts it in the book', async () => {
    await page.reload();
    const [app] = await Promise.all([
      page.context().waitForEvent('page'),
      page.getByRole('link', { name: 'Проверить рецепт' }).first().click(),
    ]);
    watch(app);
    await expect(app.getByRole('heading', { name: 'Проверьте рецепт' })).toBeVisible();
    await expect(app.getByText('Исходный текст')).toBeVisible();
    await app.getByRole('button', { name: 'Опубликовать' }).click();
    await app.waitForURL(new RegExp(`/recipe/${draftId}$`));
    await expect(app.getByRole('heading', { level: 1, name })).toBeVisible();
    expect(errorsOf(app), 'errors in the browser').toEqual([]);
    await app.close();
  });
});
