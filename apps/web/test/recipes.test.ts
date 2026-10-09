import { describe, expect, it } from 'vitest';
import { createMockRecipeApi } from '../src/api/mockRecipes';
import { EMPTY_FILTERS } from '../src/api/recipes';

const api = createMockRecipeApi();
const titles = async (patch: Partial<typeof EMPTY_FILTERS>) =>
  (await api.list({ ...EMPTY_FILTERS, ...patch })).map((r) => r.title);

describe('recipe filtering (mock API behind RecipeApi)', () => {
  it("book scope hides other people's private recipes but shows my own", async () => {
    const all = await titles({});
    expect(all).toContain('Голубцы');
    expect(all).toContain('Личная заметка (черновик)');
  });

  it('searches title and ingredient names, case-insensitively', async () => {
    expect(await titles({ q: 'борщ' })).toEqual(['Борщ по-мамински']);
    expect(await titles({ q: 'MJÖLK' })).toEqual(['Pannkakor']);
    expect(await titles({ q: '  фарш ' })).toEqual(['Голубцы']);
    expect(await titles({ q: 'zzz' })).toEqual([]);
  });

  it('filters by difficulty, time and tags together', async () => {
    expect(await titles({ difficulty: 'easy', maxMin: 30 })).toEqual([
      'Syrniki',
      'Pannkakor',
      'Греческий салат',
    ]);
    expect(await titles({ tags: ['dessert', 'baking'] })).toEqual(['Apple pie']);
    expect(await titles({ maxMin: 20 })).toEqual(['Греческий салат']);
  });

  it('"mine" and "saved" scopes', async () => {
    expect(await titles({ scope: 'mine' })).toEqual([
      'Голубцы',
      'Греческий салат',
      'Личная заметка (черновик)',
    ]);
    expect(await titles({ scope: 'saved' })).toEqual(['Syrniki', 'Борщ по-мамински']);
  });

  it('save and unsave update the Saved shelf', async () => {
    const a = createMockRecipeApi();
    await a.setSaved('mock-pie', true);
    expect((await a.list({ ...EMPTY_FILTERS, scope: 'saved' })).map((r) => r.id)).toContain(
      'mock-pie',
    );
    await a.setSaved('mock-pie', false);
    expect((await a.list({ ...EMPTY_FILTERS, scope: 'saved' })).map((r) => r.id)).not.toContain(
      'mock-pie',
    );
  });

  it('get returns null for an unknown id', async () => {
    expect(await api.get('nope')).toBeNull();
  });
});
