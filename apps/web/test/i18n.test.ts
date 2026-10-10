import { beforeAll, describe, expect, it } from 'vitest';
import i18n, { languageFromTelegram, resolveLanguage, setLanguage } from '../src/i18n';

describe('language resolution', () => {
  it('maps Telegram language_code, falling back to en', () => {
    expect(languageFromTelegram('ru')).toBe('ru');
    expect(languageFromTelegram('uk')).toBe('uk');
    expect(languageFromTelegram('sv-SE')).toBe('sv');
    expect(languageFromTelegram('EN_us')).toBe('en');
    expect(languageFromTelegram('de')).toBe('en');
    expect(languageFromTelegram(undefined)).toBe('en');
  });

  it('prefers manual choice, then server language, then Telegram code', () => {
    expect(resolveLanguage({ manual: 'sv', server: 'ru', tgCode: 'uk' })).toBe('sv');
    expect(resolveLanguage({ manual: null, server: 'ru', tgCode: 'uk' })).toBe('ru');
    expect(resolveLanguage({ manual: 'xx', server: null, tgCode: 'uk' })).toBe('uk');
    expect(resolveLanguage({})).toBe('en');
  });
});

describe('plural forms', () => {
  beforeAll(() => setLanguage('ru'));
  it('uses ru one/few/many forms', () => {
    expect(i18n.t('book.recipes_count', { count: 1 })).toBe('1 рецепт');
    expect(i18n.t('book.recipes_count', { count: 3 })).toBe('3 рецепта');
    expect(i18n.t('book.recipes_count', { count: 5 })).toBe('5 рецептов');
    expect(i18n.t('book.recipes_count', { count: 21 })).toBe('21 рецепт');
  });
  it('uses en one/other forms', async () => {
    await setLanguage('en');
    expect(i18n.t('book.recipes_count', { count: 1 })).toBe('1 recipe');
    expect(i18n.t('book.recipes_count', { count: 2 })).toBe('2 recipes');
  });
  it('falls back to English for a missing key', async () => {
    await setLanguage('sv');
    expect(i18n.t('does.not.exist', { defaultValue: 'x' })).toBe('x');
  });
});

describe('buttons shown together have different names (S6-6)', () => {
  // Found at 320 px: on the last cooking step "Stop cooking" and "Finish" were both "Завершити".
  const together: Array<[string, string, string]> = [
    ['the last cooking step', 'cook.exit', 'cook.finish'],
    ['a cooking step', 'cook.exit', 'cook.next'],
    ['a cooking step', 'cook.prev', 'cook.next'],
    ['the recipe card', 'recipe.recalculate', 'recipe.cook'],
  ];
  it.each(['ru', 'uk', 'en', 'sv'] as const)('%s', async (lang) => {
    await setLanguage(lang);
    for (const [where, a, b] of together)
      expect(i18n.t(a), `${where}: ${a} and ${b}`).not.toBe(i18n.t(b));
  });
});
