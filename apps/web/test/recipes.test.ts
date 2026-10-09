import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { recipeApi } from '../src/api/recipeApi';
import { EMPTY_FILTERS, emojiFor, filterRecipes, toSummary } from '../src/api/recipes';
import {
  amountText,
  groupIngredients,
  photoSrcSet,
  recipeLangOf,
  stepBodyParts,
} from '../src/recipe/amounts';
import { youtubeEmbedUrl, youtubeWatchUrl } from '../src/recipe/VideoPlayer';
import { initTelegram } from '../src/telegram/sdk';
import { BOOK_PAGE, GOLUBTSY } from './fixtures';

const all = BOOK_PAGE.items.map(toSummary);
const titles = (patch: Partial<typeof EMPTY_FILTERS>) =>
  filterRecipes(all, { ...EMPTY_FILTERS, ...patch }).map((r) => r.title);

describe('client-side search and filters over loaded recipes (owner decision 6)', () => {
  it('searches title and ingredient names, case-insensitively', () => {
    expect(titles({ q: 'сыр' })).toEqual(['Сырники']);
    expect(titles({ q: 'MJÖLK' })).toEqual(['Pannkakor']);
    expect(titles({ q: '  фарш ' })).toEqual(['Голубцы']);
    expect(titles({ q: 'zzz' })).toEqual([]);
  });

  it('filters by difficulty, total time and system tags together', () => {
    expect(titles({ difficulty: 'easy', maxMin: 25 })).toEqual(['Pannkakor']);
    expect(titles({ tags: ['breakfast'] })).toEqual(['Сырники', 'Pannkakor']);
    expect(titles({ tags: ['breakfast', 'main'] })).toEqual([]);
    expect(titles({ maxMin: 120 })).toEqual(['Сырники', 'Pannkakor']);
  });

  it('maps API list items for the list (cover thumbnail, emoji from tags, former member)', () => {
    const [g, s] = all;
    expect(g!.thumbUrl).toBe('https://media.test/media/a1/thumb.jpg?signed=1');
    expect(s!.thumbUrl).toBeNull();
    expect(s!.emoji).toBe('🍳');
    expect(emojiFor([{ slug: 'c:x', custom_name: 'x' }])).toBe('🍽️');
    expect(toSummary({ ...BOOK_PAGE.items[1]!, author: { id: 'x', name: null } }).authorName).toBe(
      '',
    );
  });
});

describe('recipe card helpers (recipe-core at k = 1)', () => {
  const langs = { recipeLang: 'ru' as const, uiLang: 'en' as const };
  const byName = (n: string) => GOLUBTSY.ingredients.find((i) => i.name === n)!;

  it('formats amounts in the recipe language, exactly as written', () => {
    expect(amountText(byName('Говяжий фарш'), langs)).toBe('800 г');
    expect(amountText(byName('Капуста'), langs)).toBe('1 кочан');
    expect(amountText(byName('Соль'), langs)).toBe('по вкусу');
    expect(amountText(byName('Лавровый лист'), langs)).toBe('2 шт.');
    expect(amountText(byName('щепотка любви'), langs)).toBeNull(); // unparsed: the line is shown
    // The same line in an English UI with a Swedish recipe: units follow the recipe.
    expect(amountText(byName('Говяжий фарш'), { recipeLang: 'sv', uiLang: 'en' })).toBe('800 g');
  });

  it("a step's share of an ingredient goes through the engine's rounding", () => {
    const rice = byName('Рис');
    expect(amountText(rice, langs)).toMatch(/^½ /);
    expect(amountText(rice, langs, 0.5)).toMatch(/^¼ /);
  });

  it('uses the recipe language when it is one of the four, else the UI language', () => {
    expect(recipeLangOf({ language: 'sv' }, 'ru')).toBe('sv');
    expect(recipeLangOf({ language: null }, 'uk')).toBe('uk');
    expect(recipeLangOf({ language: 'de' }, 'en')).toBe('en');
  });

  it('groups ingredients by section in order; lines before the first heading have none', () => {
    expect(groupIngredients(GOLUBTSY.ingredients).map((g) => [g.label, g.items.length])).toEqual([
      [null, 1],
      ['Для начинки', 3],
      ['Для соуса', 2],
    ]);
  });

  it('finds {ing:<id>} placeholders and keeps HTML as text', () => {
    const byId = new Map(GOLUBTSY.ingredients.map((i) => [i.id, i]));
    const parts = stepBodyParts(GOLUBTSY.steps[0]!.body, byId);
    expect(parts.map((p) => (p.kind === 'text' ? p.text : `[${p.ingredient.name}]`)).join('')).toBe(
      'Смешайте [Говяжий фарш] фарша и [Рис] риса. <b>не HTML</b>',
    );
    expect(stepBodyParts('a {ing:00000000-0000-4000-8000-999999999999} b', byId)).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'text', text: ' b' },
    ]);
  });

  it('srcset states the real widths of the stored versions', () => {
    const p = { id: 'p', url: 'F', thumb_url: 'T' };
    expect(photoSrcSet({ ...p, width: 1600, height: 1067 })).toBe('T 512w, F 1600w');
    expect(photoSrcSet({ ...p, width: 1536, height: 2048 })).toBe('T 384w, F 1536w');
    expect(photoSrcSet({ ...p, width: 300, height: 200 })).toBe('T 300w, F 300w');
  });

  it('builds YouTube links that start at the step second', () => {
    expect(youtubeEmbedUrl('dQw4w9WgXcQ', 95)).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&playsinline=1&rel=0&start=95',
    );
    expect(youtubeWatchUrl('dQw4w9WgXcQ', 95)).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=95s',
    );
    expect(youtubeWatchUrl('dQw4w9WgXcQ', 0)).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });
});

describe('recipeApi against the BE-04 contract', () => {
  beforeAll(async () => {
    await initTelegram(); // dev mock: signs initData for the Authorization header
  });
  afterEach(() => vi.unstubAllGlobals());

  const stubFetch = (res: () => Response) => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => res());
    vi.stubGlobal('fetch', fetch);
    return fetch;
  };

  it('asks for pages of 50 and passes the cursor on', async () => {
    const fetch = stubFetch(() => new Response(JSON.stringify(BOOK_PAGE), { status: 200 }));
    await recipeApi.listPage('book', null);
    await recipeApi.listPage('mine', 'abc');
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([
      '/api/recipes?scope=book&limit=50',
      '/api/recipes?scope=mine&limit=50&cursor=abc',
    ]);
  });

  it('get: "not found" and "not a recipe id" are null; other failures are errors', async () => {
    const err = (status: number, code: string) => () =>
      new Response(JSON.stringify({ error: { code, message: 'x', request_id: 'r' } }), { status });
    stubFetch(err(404, 'NOT_FOUND'));
    expect(await recipeApi.get('x')).toBeNull();
    stubFetch(err(400, 'VALIDATION_ERROR'));
    expect(await recipeApi.get('mock-pie')).toBeNull();
    stubFetch(err(500, 'INTERNAL'));
    await expect(recipeApi.get('x')).rejects.toMatchObject({ code: 'INTERNAL' });
  });
});
