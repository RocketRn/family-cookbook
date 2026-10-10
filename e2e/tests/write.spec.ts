import { expect, open, test } from './fixtures';
import { MEMBER, png, title } from './stack';

/** QA.md P3 (write a recipe), P4 (edit), P5 (unsaved changes), P9 (delete). */
test('write a recipe with a photo, edit it, leave unsaved changes, delete it', async ({ page }) => {
  const name = title('Шарлотка');

  await test.step('P3 write: amounts, "to taste", a linked ingredient, a timer and a big photo', async () => {
    await open(page, MEMBER);
    await page.getByRole('button', { name: 'New recipe' }).click();
    await page.getByRole('button', { name: /Write a recipe/ }).click();
    await expect(page.getByRole('heading', { name: 'New recipe' })).toBeVisible();
    await page.getByRole('button', { name: 'Русский' }).click();
    await page.getByLabel('Title').fill(name);
    await page.getByRole('button', { name: 'More servings' }).click(); // 4 -> 5

    await page.getByLabel('Ingredient', { exact: true }).fill('сахар');
    await page.getByLabel('Amount', { exact: true }).fill('1,5');
    await page.getByRole('button', { name: 'Ingredient details' }).click();
    const details = page.getByRole('dialog', { name: 'Ingredient details' });
    await details.getByRole('button', { name: 'стакан', exact: true }).click();
    await details.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Add ingredient' }).click();
    await page.getByLabel('Ingredient', { exact: true }).nth(1).fill('соль');
    await page.getByRole('button', { name: 'Ingredient details' }).nth(1).click();
    await details.getByRole('button', { name: 'To taste' }).click();
    await details.getByRole('button', { name: 'Done' }).click();

    const step = page.getByLabel('What to do in step 1');
    await step.fill('Взбейте яйца с ');
    await page.getByRole('button', { name: 'Link ingredient' }).click();
    const pick = page.getByRole('dialog', { name: 'Link ingredient' });
    await pick.getByRole('button', { name: 'сахар' }).click();
    await pick.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'сахар · All' }).click();
    await page
      .getByRole('dialog', { name: 'сахар' })
      .getByRole('button', { name: 'Insert into the text' })
      .click();
    await expect(step).toHaveValue('Взбейте яйца с сахар ([сахар])');
    await page.getByRole('button', { name: 'Add timer' }).click();
    await page.getByLabel('Timer name').fill('Взбивать');
    await page.getByLabel('Minutes').fill('5');

    // A 4000 x 3000 photo, as a phone takes it: made smaller on the phone before upload.
    const upload = page.waitForRequest((r) => r.url().endsWith('/api/media'));
    await page
      .getByTestId('photo-input')
      .first()
      .setInputFiles({
        name: 'photo.png',
        mimeType: 'image/png',
        buffer: png(4000, 3000, [200, 120, 40]),
      });
    // Redrawn on the phone as a JPEG of at most 2048 px, not sent as the original PNG.
    expect((await upload).postDataBuffer()!.toString('latin1')).toMatch(
      /Content-Type: image\/jpeg/i,
    );
    await expect(page.getByRole('img', { name: 'Recipe photo' })).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'Publish' }).click();
    await page.waitForURL(/\/recipe\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    const stepText = page.getByText(/^Взбейте яйца с сахар/);
    await expect(stepText).toHaveText('Взбейте яйца с сахар (1½ стакана)');
    await expect(page.getByRole('button', { name: '⏱ Start timer: Взбивать, 5:00' })).toBeVisible();
    await expect(page.getByText('5 servings')).toBeVisible();
    const cover = page.locator('img').first();
    await expect(cover).toBeVisible();
    const width = await cover.evaluate((img: HTMLImageElement) => img.naturalWidth);
    expect(width).toBeGreaterThan(0);
    expect(width).toBeLessThanOrEqual(2048);
  });

  await test.step('P4 edit: one more serving, saved', async () => {
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Edit recipe' })).toBeVisible();
    await page.getByRole('button', { name: 'More servings' }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('6 servings')).toBeVisible();
    await expect(page.getByText(/^Взбейте яйца с сахар/)).toHaveText(
      'Взбейте яйца с сахар (1½ стакана)',
    );
  });

  await test.step('P5 unsaved changes: Back asks; "no" stays, "yes" leaves', async () => {
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByLabel('Title').fill(`${name} (new)`);
    const back = page.getByTestId('mock-back-button');
    page.once('dialog', (d) => {
      expect(d.message()).toBe('Leave without saving? Your changes will be lost.');
      void d.dismiss();
    });
    await back.click();
    await expect(page.getByRole('heading', { name: 'Edit recipe' })).toBeVisible();
    page.once('dialog', (d) => void d.accept());
    await back.click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  });

  await test.step('P9 delete: asks first, then the recipe is gone from the book', async () => {
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Delete recipe' }).click();
    await expect(page.getByText('Recipe deleted')).toBeVisible();
    await expect(page.getByRole('button', { name: 'New recipe' })).toBeVisible();
    await page.getByRole('searchbox').fill(name);
    await expect(page.getByText('Nothing found')).toBeVisible();
  });
});
