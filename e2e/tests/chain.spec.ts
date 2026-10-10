import { expect, open, test } from './fixtures';
import { botMessage, KEEPER, lastMessageId, MEMBER, title } from './stack';

/**
 * PRD QA-01's critical path, "import → recalculation → cooking → reaction", by two people of one
 * book: the keeper (Russian) pastes a recipe text, checks it and publishes it; a member (English)
 * doubles it, cooks it with a timer (the bot's message arrives and opens that step), marks
 * "I cooked it" with a few words, and the author gets the bot's message and sees it on the card.
 * QA.md P6, P7, P11 and the Sprint 5 reactions.
 */
test('import → recalculation → cooking → reaction', async ({ page, newUserPage }) => {
  const name = title('Сырники');
  let recipeUrl = '';

  await test.step('the keeper pastes a recipe text, keeps the found timer (3 s) and publishes', async () => {
    await open(page, KEEPER);
    await page.getByRole('button', { name: 'Новый рецепт' }).click();
    await page.getByRole('button', { name: /Вставить текст рецепта/ }).click();
    await page
      .getByRole('textbox')
      .first()
      .fill(
        [
          name,
          '',
          'Ингредиенты:',
          'Творог — 500 г',
          'Яйца — 2 шт.',
          'Сахар — 2 ст. л.',
          'Мука — 4 ст. л.',
          '',
          'Приготовление:',
          '1. Смешайте творог с яйцами и сахаром.',
          '2. Добавьте муку и вымесите тесто.',
          '3. Обжаривайте сырники на сковороде по 3 минуты с каждой стороны.',
        ].join('\n'),
      );
    await page.getByRole('button', { name: 'Разобрать' }).click();
    await expect(page.getByRole('heading', { name: 'Проверьте рецепт' })).toBeVisible();
    const found = page.getByRole('group', { name: /Найден таймер: 3 мин/ });
    await found.getByRole('button', { name: 'Оставить таймер' }).click();
    // 3 seconds instead of 3 minutes, so the test does not wait.
    await page.getByLabel('Минут').fill('0,05');
    await page.getByRole('button', { name: 'Опубликовать' }).click();
    await page.waitForURL(/\/recipe\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    recipeUrl = new URL(page.url()).pathname;
  });

  const cook = await newUserPage(MEMBER);
  await test.step('a member opens it and doubles it', async () => {
    await open(cook, MEMBER, recipeUrl);
    await expect(cook.getByRole('heading', { level: 1, name })).toBeVisible();
    await cook.getByRole('button', { name: 'Recalculate' }).click();
    const sheet = cook.getByRole('dialog', { name: 'Recalculate the recipe' });
    await expect(sheet.getByText('In the recipe: 4')).toBeVisible();
    for (let i = 0; i < 4; i++) await sheet.getByRole('button', { name: 'More servings' }).click();
    await sheet.getByRole('button', { name: 'Recalculate' }).click();
    await expect(cook.getByText('Recalculated · servings: 8')).toBeVisible();
    const line = (n: string) => cook.getByRole('listitem').filter({ hasText: n }).first();
    await expect(line('Творог')).toContainText('1000 г');
    await expect(line('Яйца')).toContainText('4 шт.');
  });

  let after = 0;
  await test.step('cooks it: the timer rings on screen and the bot writes', async () => {
    await cook.getByRole('button', { name: 'Cook', exact: true }).click();
    await expect(cook.getByRole('heading', { name: 'Do you have everything?' })).toBeVisible();
    await cook.getByRole('checkbox').first().check();
    await cook.getByRole('button', { name: 'Start cooking', exact: true }).click();
    await expect(cook.getByText('Step 1 of 3')).toBeVisible();
    await cook.getByRole('button', { name: 'Next step', exact: true }).click();
    await cook.getByRole('button', { name: 'Next step', exact: true }).click();
    await expect(cook.getByText('Step 3 of 3')).toBeVisible();
    after = await lastMessageId();
    await cook.getByRole('button', { name: /^⏱ Start timer: .*, 0:03$/ }).click();
    await expect(cook.getByRole('alert')).toBeVisible({ timeout: 15_000 });
    const msg = await botMessage(MEMBER.chat, after, name);
    expect(msg.reply_markup?.inline_keyboard[0]?.[0]?.text).toBe('Open the step');
    await cook.getByRole('alert').getByRole('button').first().click();
    // The message's button opens cooking at that step.
    const startapp = new URL(msg.reply_markup!.inline_keyboard[0]![0]!.url).searchParams.get(
      'startapp',
    );
    await open(cook, MEMBER, `/?startapp=${startapp}`);
    await expect(cook.getByText('Step 3 of 3')).toBeVisible();
  });

  await test.step('finishes and marks "I cooked it" with a few words', async () => {
    await cook.getByRole('button', { name: 'Finish', exact: true }).click();
    await expect(cook.getByRole('heading', { name: 'Done!' })).toBeVisible();
    await cook.getByRole('button', { name: '👨‍🍳 I cooked it' }).click();
    await expect(cook.getByRole('heading', { name: /You cooked/ })).toBeVisible();
    await cook.getByRole('textbox', { name: 'A few words for the author' }).fill('Very tasty!');
    after = await lastMessageId();
    await cook.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(cook.getByRole('heading', { name: 'Sent!' })).toBeVisible();
  });

  await test.step('the author gets the bot’s message and sees it on the card', async () => {
    const msg = await botMessage(KEEPER.chat, after, name);
    expect(msg.plain).toContain('Dev Member');
    expect(msg.plain).toContain('Very tasty!');
    await page.reload();
    const who = page.getByRole('list', { name: 'Кто приготовил' });
    await expect(who).toContainText('Dev Member');
    await expect(who).toContainText('Very tasty!');
    await expect(page.getByRole('region', { name: 'Реакции' })).toContainText(/Приготовили 1 раз/);
  });
});
