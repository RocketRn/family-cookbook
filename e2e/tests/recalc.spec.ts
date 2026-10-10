import { expect, open, test } from './fixtures';
import { api, KEEPER, MEMBER, title } from './stack';

/** QA.md P7 (recalculate, remembered after a reload) and P8 (whole-item hints, PRD 5.3). */
const GOLUBTSY = '/recipe/00000000-0000-4000-8000-0000000000c1'; // seeded: 4 servings, 800 г фарша

test('P7 from one product: amounts follow, the choice survives a reload, and it can be undone', async ({
  page,
}) => {
  await open(page, MEMBER, GOLUBTSY);
  await page.getByRole('button', { name: 'Recalculate', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Recalculate the recipe' });
  await sheet.getByRole('button', { name: 'From one product' }).click();
  await sheet.getByRole('button', { name: 'Говяжий фарш' }).click();
  await expect(sheet.getByText('In the recipe: 800 г')).toBeVisible();
  await sheet.getByLabel('How much you have').fill('400');
  await expect(sheet.getByText('Servings after recalculation: 2')).toBeVisible();
  await sheet.getByRole('button', { name: 'Recalculate', exact: true }).click();

  const ingredient = (name: string) => page.getByRole('listitem').filter({ hasText: name }).first();
  await expect(page.getByText('Recalculated · servings: 2')).toBeVisible();
  await expect(page.getByText('From what you have: Говяжий фарш, 400 г')).toBeVisible();
  await expect(ingredient('Говяжий фарш')).toContainText('400 г');
  await expect(page.getByText(/time may differ/).first()).toBeVisible();

  await page.reload();
  await expect(page.getByText('Recalculated · servings: 2')).toBeVisible();
  await expect(ingredient('Говяжий фарш')).toContainText('400 г');

  await page.getByRole('button', { name: 'Back to the original' }).click();
  await expect(page.getByText('4 servings')).toBeVisible();
  await expect(ingredient('Говяжий фарш')).toContainText('800 г');
});

test('P8 one egg and one garlic clove for 3 servings, made for 4: how to measure them', async ({
  page,
}) => {
  const recipe = await api<{ id: string }>(MEMBER, 'POST', '/recipes', {
    title: title('Омлет'),
    servings: 3,
    language: 'ru',
    status: 'published',
    visibility: 'book',
    ingredients: [
      { ref: 'a', name: 'Яйцо', qty_kind: 'exact', amount_min: 1, unit_code: 'pcs' },
      { ref: 'b', name: 'Чеснок', qty_kind: 'exact', amount_min: 1, unit_code: 'clove' },
    ],
    steps: [{ body: 'Взбейте и пожарьте.' }],
  });
  await open(page, KEEPER, `/recipe/${recipe.id}`); // in Russian, as QA.md P8 expects
  await page.getByRole('button', { name: 'Пересчитать', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Пересчитать рецепт' });
  await sheet.getByRole('button', { name: 'Больше порций' }).click();
  await sheet.getByRole('button', { name: 'Пересчитать', exact: true }).click();
  // One egg cannot be split, so the servings are approximate (PRD 5.3).
  await expect(page.getByText('Пересчитано · порций: ≈ 4')).toBeVisible();
  const ingredient = (name: string) => page.getByRole('listitem').filter({ hasText: name }).first();
  await expect(ingredient('Яйцо')).toContainText('или взбить 2 шт. и взять ⅔');
  await expect(ingredient('Чеснок')).toContainText('или взять 2 зубчика и использовать ⅔');
});
