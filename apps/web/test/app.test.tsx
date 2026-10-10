import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/client';
import { recipeApi } from '../src/api/recipeApi';
import { setLanguage } from '../src/i18n';
import { __resetTelegramRuntime } from '../src/telegram/sdk';
import { BOOK_PAGE, GOLUBTSY, GOLUBTSY_ID, SYRNIKI_ID, listItem } from './fixtures';
import { BOOK, BOOK_LIST, json, ME, renderApp, stubApi } from './harness';

beforeEach(() => {
  __resetTelegramRuntime();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('demo: sign-in through Telegram (dev mock) against the API contract', () => {
  it('signs in with a freshly signed initData, applies the profile language and lists the book', async () => {
    const calls = stubApi({
      'GET /api/me': () => json(200, ME),
      'GET /api/books/current': () => json(200, BOOK),
      [BOOK_LIST]: () => json(200, BOOK_PAGE),
    });
    renderApp();

    expect(await screen.findByRole('heading', { name: 'Семья' })).toBeTruthy();
    expect(await screen.findByText('Голубцы')).toBeTruthy();
    expect(screen.getByText('Сырники')).toBeTruthy();
    expect(calls.some((c) => `${c.method} ${c.url}` === BOOK_LIST)).toBe(true);

    const me = calls.find((c) => c.url === '/api/me')!;
    expect(me.auth).toMatch(/^tma .*hash=[0-9a-f]{64}$/);
    expect(document.documentElement.lang).toBe('ru'); // ui_lang from /me
  });

  it('search asks the server once the user stops typing, and shows what it found', async () => {
    const calls = stubApi({
      'GET /api/me': () => json(200, ME),
      'GET /api/books/current': () => json(200, BOOK),
      [BOOK_LIST]: () => json(200, BOOK_PAGE),
      [`${BOOK_LIST}&q=${encodeURIComponent('фарш')}`]: () =>
        json(200, { items: [BOOK_PAGE.items[0]], next_cursor: null }),
    });
    renderApp();
    await screen.findByText('Голубцы');
    const box = screen.getByRole('searchbox');
    fireEvent.change(box, { target: { value: 'ф' } });
    fireEvent.change(box, { target: { value: 'фар' } });
    fireEvent.change(box, { target: { value: 'фарш' } });
    await waitFor(() => expect(screen.queryByText('Сырники')).toBeNull());
    expect(screen.getByText('Голубцы')).toBeTruthy();
    expect(screen.getByText('Найдено: 1')).toBeTruthy();
    // Only the finished word went to the server, not every keystroke.
    expect(calls.filter((c) => c.url.includes('&q=')).map((c) => c.url)).toEqual([
      `/api/recipes?scope=book&limit=50&q=${encodeURIComponent('фарш')}`,
    ]);
  });

  it('shows onboarding when the user is not in a book, and creates one', async () => {
    await setLanguage('en');
    let created = false;
    stubApi({
      'GET /api/me': () => json(200, { ...ME, ui_lang: 'en' }),
      'GET /api/books/current': () =>
        created
          ? json(200, { ...BOOK, title: 'Family' })
          : json(404, { error: { code: 'NOT_IN_BOOK', message: 'n', request_id: 'r' } }),
      'POST /api/books': () => {
        created = true;
        return json(201, { id: 'b1', title: 'Family', role: 'owner', invite_code: 'c' });
      },
    });
    renderApp();
    fireEvent.change(await screen.findByLabelText('Book name'), { target: { value: 'Family' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create book' }));
    expect(await screen.findByRole('heading', { name: 'Family' })).toBeTruthy();
  });

  it('shows a retryable error when sign-in fails', async () => {
    await setLanguage('en');
    stubApi({
      'GET /api/me': () =>
        json(401, { error: { code: 'UNAUTHORIZED', message: 'x', request_id: 'r' } }),
    });
    renderApp();
    expect(await screen.findByText("Couldn't sign in")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('boots once: navigating between tabs does not sign in again or restart the app', async () => {
    await setLanguage('en');
    const calls = stubApi({
      'GET /api/me': () => json(200, { ...ME, ui_lang: 'en' }),
      'GET /api/books/current': () => json(200, BOOK),
      [BOOK_LIST]: () => json(200, BOOK_PAGE),
    });
    renderApp();
    await screen.findByRole('heading', { name: 'Семья' });
    fireEvent.click(screen.getByRole('link', { name: /Saved/ }));
    await screen.findByRole('heading', { name: 'Saved' });
    fireEvent.click(screen.getByRole('link', { name: /Profile/ }));
    await screen.findByRole('heading', { name: 'Profile' });
    expect(calls.filter((c) => c.url === '/api/me')).toHaveLength(1);
    expect(screen.queryByText('Signing in…')).toBeNull();
  });

  it('after joining through a deep link the user lands on the book (start_param is not replayed)', async () => {
    await setLanguage('en');
    window.history.replaceState({}, '', '/?startapp=join_devinvitecode');
    let joined = false;
    stubApi({
      'GET /api/me': () => json(200, { ...ME, ui_lang: 'en' }),
      'GET /api/books/current': () =>
        joined
          ? json(200, BOOK)
          : json(404, { error: { code: 'NOT_IN_BOOK', message: 'n', request_id: 'r' } }),
      'POST /api/books/join': () => {
        joined = true;
        return json(201, { id: 'b1', title: 'Семья', role: 'member' });
      },
    });
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: 'Join the book' }));
    expect(await screen.findByRole('heading', { name: 'Семья' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Join this book?' })).toBeNull();
  });

  it('follows a join_ deep link from start_param', async () => {
    await setLanguage('en');
    window.history.replaceState({}, '', '/?startapp=join_devinvitecode');
    stubApi({
      'GET /api/me': () => json(200, { ...ME, ui_lang: 'en' }),
      'GET /api/books/current': () =>
        json(404, { error: { code: 'NOT_IN_BOOK', message: 'n', request_id: 'r' } }),
    });
    renderApp();
    expect(await screen.findByRole('heading', { name: 'Join this book?' })).toBeTruthy();
  });

  it('sets the document title from the UI language', async () => {
    stubApi({
      'GET /api/me': () => json(200, ME),
      'GET /api/books/current': () => json(200, BOOK),
      [BOOK_LIST]: () => json(200, BOOK_PAGE),
    });
    renderApp();
    await screen.findByRole('heading', { name: 'Семья' });
    expect(document.title).toBe('Семейная кулинарная книга');
  });
});

describe('error states (review round 2)', () => {
  const serverError = () =>
    json(500, { error: { code: 'INTERNAL', message: 'x', request_id: 'r' } });

  it('Profile shows the error and a retry when the book fails to load, not "not in a book"', async () => {
    await setLanguage('en');
    stubApi({
      'GET /api/me': () => json(200, { ...ME, ui_lang: 'en' }),
      'GET /api/books/current': serverError,
    });
    renderApp('/profile');
    expect(await screen.findByText('Something went wrong. Try again.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByText('You are not in a book yet.')).toBeNull();
  });

  it('Book tab shows the error message, not a bare button', async () => {
    await setLanguage('en');
    stubApi({
      'GET /api/me': () => json(200, { ...ME, ui_lang: 'en' }),
      'GET /api/books/current': serverError,
    });
    renderApp('/');
    expect(await screen.findByText('Something went wrong. Try again.')).toBeTruthy();
  });

  it('a failed recipe load is not reported as "Recipe not found"', async () => {
    await setLanguage('en');
    const spy = vi
      .spyOn(recipeApi, 'get')
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK', 'offline'));
    stubApi({
      'GET /api/me': () => json(200, { ...ME, ui_lang: 'en' }),
      'GET /api/books/current': () => json(200, BOOK),
      [BOOK_LIST]: () => json(200, BOOK_PAGE),
    });
    renderApp(`/recipe/${GOLUBTSY_ID}`);
    expect(await screen.findByText('No connection. Check your network.')).toBeTruthy();
    expect(screen.queryByText('Recipe not found')).toBeNull();
    spy.mockRestore();
  });
});

describe('Telegram BackButton (review round 2)', () => {
  it('on the first screen of the session it goes to the book, never out of the app', async () => {
    // Browser history from before the Mini App opened (window.history.length > 1).
    window.history.pushState({}, '', '/somewhere-before-the-app');
    stubApi({
      'GET /api/me': () => json(200, ME),
      'GET /api/books/current': () => json(200, BOOK),
      [BOOK_LIST]: () => json(200, BOOK_PAGE),
      [`GET /api/recipes/${GOLUBTSY_ID}`]: () => json(200, GOLUBTSY),
    });
    renderApp(`/recipe/${GOLUBTSY_ID}`);
    await screen.findByRole('heading', { name: 'Голубцы' });
    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-testid=mock-back-button]')!);
    expect(await screen.findByRole('heading', { name: 'Семья' })).toBeTruthy();
  });

  it('after in-app navigation it goes back one step', async () => {
    stubApi({
      'GET /api/me': () => json(200, ME),
      'GET /api/books/current': () => json(200, BOOK),
      [BOOK_LIST]: () => json(200, BOOK_PAGE),
      'GET /api/recipes?scope=saved&limit=50': () =>
        json(200, {
          items: [listItem({ id: SYRNIKI_ID, title: 'Сырники' })],
          next_cursor: null,
        }),
      [`GET /api/recipes/${SYRNIKI_ID}`]: () =>
        json(200, { ...GOLUBTSY, id: SYRNIKI_ID, title: 'Сырники', is_mine: false }),
    });
    // Saved -> recipe -> back lands on Saved, not on the first tab.
    renderApp('/saved');
    fireEvent.click(await screen.findByText('Сырники'));
    await screen.findByRole('heading', { name: 'Сырники' });
    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-testid=mock-back-button]')!);
    expect(await screen.findByRole('heading', { name: 'Сохранённое' })).toBeTruthy();
  });
});

describe('FE-03 recipe card', () => {
  const card = () =>
    stubApi({
      'GET /api/me': () => json(200, { ...ME, ui_lang: 'en' }),
      'GET /api/books/current': () => json(200, BOOK),
      [`GET /api/recipes/${GOLUBTSY_ID}`]: () => json(200, GOLUBTSY),
    });

  it('shows photos, meta, tags, grouped ingredients in the recipe language, and notes', async () => {
    await setLanguage('en');
    card();
    renderApp(`/recipe/${GOLUBTSY_ID}`);
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Голубцы' });
    expect(h1.getAttribute('lang')).toBe('ru');
    expect(screen.getByText('by Dev Keeper')).toBeTruthy();
    // Gallery: cover + the step photo; the browser may pick the 512 px version.
    const gallery = screen.getByRole('list', { name: 'Photos' });
    const imgs = gallery.querySelectorAll('img');
    expect(imgs).toHaveLength(2);
    expect(imgs[0]!.getAttribute('srcset')).toBe(
      'https://media.test/media/a1/thumb.jpg?signed=1 512w, https://media.test/media/a1/full.jpg?signed=1 2048w',
    );
    // A smaller photo declares its real widths (1024x768 -> thumbnail 512 px).
    expect(imgs[1]!.getAttribute('srcset')).toBe(
      'https://media.test/media/a2/thumb.jpg?signed=1 512w, https://media.test/media/a2/full.jpg?signed=1 1024w',
    );
    // Meta: difficulty, total time, prep/cook, system and free-form tags.
    expect(screen.getByText('Medium')).toBeTruthy();
    expect(screen.getByText('130 min')).toBeTruthy();
    expect(screen.getByText('Prep 40 min · Cooking 90 min')).toBeTruthy();
    expect(screen.getByText('Main course')).toBeTruthy();
    expect(screen.getByText('бабушкин рецепт')).toBeTruthy();
    // Ingredients: grouped, amounts formatted by recipe-core in Russian although the UI is English.
    const ings = screen.getByRole('region', { name: 'Ingredients' });
    expect(ings.textContent).toContain('Для начинки');
    expect(ings.textContent).toContain('Для соуса');
    expect(ings.textContent).toContain('800 г');
    expect(ings.textContent).toContain('по вкусу');
    expect(ings.textContent).toContain('(optional)');
    expect(ings.textContent).toContain('немного любви и терпения');
    expect(screen.getByText('Вкуснее на следующий день.')).toBeTruthy();
  });

  it('renders steps as text: placeholders become amounts, HTML stays text; timers', async () => {
    await setLanguage('en');
    card();
    renderApp(`/recipe/${GOLUBTSY_ID}`);
    const steps = await screen.findByRole('region', { name: 'Steps' });
    expect(steps.textContent).toContain('Step 1 · Начинка');
    // PRD 2.3: {ing:<id>} is the amount; this step uses half the rice, so it shows its share.
    expect(steps.textContent).toMatch(/Смешайте 800 г фарша и ¼ \S+ риса\. <b>не HTML<\/b>/);
    expect(steps.querySelector('b')).toBeNull(); // PRD 7.1: recipe text is never HTML
    expect(steps.querySelector('strong')?.getAttribute('title')).toBe('Говяжий фарш');
    // The step uses half the rice: the engine rounds that share; the section is named.
    const stepIngs = screen.getByRole('list', { name: 'Ingredients for this step' });
    expect(stepIngs.textContent).toMatch(/Рис · Для начинки¼ /);
    expect(steps.textContent).toContain('Тушить · 1 h 30 min');
  });

  it('loads YouTube only on tap, at the step second; "Open in YouTube" uses Telegram openLink', async () => {
    await setLanguage('en');
    card();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderApp(`/recipe/${GOLUBTSY_ID}`);
    const play = await screen.findByRole('button', { name: /Как заворачивать/ });
    expect(play.textContent).toContain('from 1:35');
    expect(document.querySelector('iframe')).toBeNull();
    fireEvent.click(play);
    const frame = document.querySelector('iframe')!;
    expect(frame.getAttribute('src')).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&playsinline=1&rel=0&start=95',
    );
    expect(frame.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');
    fireEvent.click(screen.getAllByRole('button', { name: 'Open in YouTube' })[0]!);
    expect(open).toHaveBeenCalledWith(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=95s',
      '_blank',
      'noopener',
    );
    // A video not tied to a step is listed under Videos.
    expect(screen.getByRole('region', { name: 'Videos' }).textContent).toContain('Video');
    open.mockRestore();
  });

  it('shows the reactions block with live counts (FE-10; the details: reactions.test.tsx)', async () => {
    await setLanguage('en');
    const zero = { heart: 0, yum: 0, fire: 0, idea: 0, curious: 0, cook_again: 0 };
    stubApi({
      'GET /api/me': () => json(200, { ...ME, ui_lang: 'en' }),
      'GET /api/books/current': () => json(200, BOOK),
      [`GET /api/recipes/${GOLUBTSY_ID}`]: () => json(200, GOLUBTSY),
      [`GET /api/recipes/${GOLUBTSY_ID}/reactions`]: () =>
        json(200, {
          counts: { ...zero, heart: 1, cooked: 0 },
          mine: { ...zero, heart: null, cooked: 0 },
          cooked: [],
        }),
    });
    renderApp(`/recipe/${GOLUBTSY_ID}`);
    const block = await screen.findByRole('region', { name: 'Reactions' });
    expect(await within(block).findByRole('button', { name: 'Love it: 1' })).toBeTruthy();
    // Six one-of reactions and "I cooked it"; "My version" is hidden (owner, Sprint 4).
    const buttons = block.querySelectorAll('button');
    expect(buttons).toHaveLength(7);
    buttons.forEach((b) => expect(b.disabled).toBe(false));
  });

  it('a recipe the API does not show is "not found"', async () => {
    await setLanguage('en');
    stubApi({
      'GET /api/me': () => json(200, { ...ME, ui_lang: 'en' }),
      'GET /api/books/current': () => json(200, BOOK),
    });
    renderApp(`/recipe/${GOLUBTSY_ID}`);
    expect(await screen.findByText('Recipe not found')).toBeTruthy();
  });
});

describe('book list: pages of 50, search and filters on the server (BE-11)', () => {
  it('loads the next page on "Load more", for the same search and filters', async () => {
    await setLanguage('en');
    const filtered = `${BOOK_LIST}&q=${encodeURIComponent('борщ')}&tag=soup&max_min=60`;
    const calls = stubApi({
      'GET /api/me': () => json(200, { ...ME, ui_lang: 'en' }),
      'GET /api/books/current': () => json(200, BOOK),
      [BOOK_LIST]: () => json(200, { ...BOOK_PAGE, next_cursor: 'page-2' }),
      [`${BOOK_LIST}&tag=soup`]: () => json(200, { items: [], next_cursor: null }),
      [`${BOOK_LIST}&tag=soup&max_min=60`]: () => json(200, { items: [], next_cursor: null }),
      [filtered]: () =>
        json(200, {
          items: [listItem({ id: '00000000-0000-4000-8000-0000000000c8', title: 'Борщ' })],
          next_cursor: 'page-2',
        }),
      [`${filtered}&cursor=page-2`]: () =>
        json(200, {
          items: [listItem({ id: '00000000-0000-4000-8000-0000000000c9', title: 'Зелёный борщ' })],
          next_cursor: null,
        }),
    });
    renderApp('/');
    expect(await screen.findByText('Recipes loaded: 3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    fireEvent.click(screen.getByRole('button', { name: 'Soup' }));
    fireEvent.click(screen.getByRole('button', { name: 'Up to 60 min' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show recipes' }));
    expect(await screen.findByText('Nothing found')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'борщ' } });
    expect(await screen.findByText('Борщ')).toBeTruthy();
    expect(screen.getByText('Found: 1 so far (load more below)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Зелёный борщ')).toBeTruthy();
    expect(screen.getByText('Found: 2')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    expect(calls.map((c) => c.url)).toContain(`${filtered.slice(4)}&cursor=page-2`);
  });

  it('"Mine" asks the API for my recipes, drafts included', async () => {
    await setLanguage('en');
    const calls = stubApi({
      'GET /api/me': () => json(200, { ...ME, ui_lang: 'en' }),
      'GET /api/books/current': () => json(200, BOOK),
      [BOOK_LIST]: () => json(200, BOOK_PAGE),
      'GET /api/recipes?scope=mine&limit=50': () =>
        json(200, {
          items: [listItem({ id: GOLUBTSY_ID, title: 'Черновик', is_mine: true, status: 'draft' })],
          next_cursor: null,
        }),
    });
    renderApp('/');
    await screen.findByText('Голубцы');
    fireEvent.click(screen.getByRole('button', { name: 'Mine' }));
    expect(await screen.findByText('Черновик')).toBeTruthy();
    expect(screen.getByText(/^Draft · /)).toBeTruthy();
    expect(calls.map((c) => c.url)).toContain('/api/recipes?scope=mine&limit=50');
  });
});

// The "Saved" tab is real since Sprint 5 (D-051): saved.test.tsx. The development sample shelf of
// owner decision 5 is gone.

describe('PATCH /me: the interface language is saved to the profile', () => {
  it('sends the chosen language; a failure keeps the choice and says so', async () => {
    await setLanguage('en');
    let fail = false;
    const calls = stubApi({
      'GET /api/me': () => json(200, { ...ME, ui_lang: 'en' }),
      'GET /api/books/current': () => json(200, BOOK),
      'PATCH /api/me': (init) =>
        fail
          ? json(500, { error: { code: 'INTERNAL', message: 'x', request_id: 'r' } })
          : json(200, { ...ME, ui_lang: JSON.parse(String(init.body)).ui_lang }),
    });
    renderApp('/profile');
    fireEvent.click(await screen.findByRole('button', { name: 'Svenska' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toBe('{"ui_lang":"sv"}'),
    );
    expect(document.documentElement.lang).toBe('sv');

    fail = true;
    fireEvent.click(screen.getByRole('button', { name: 'Українська' }));
    expect(
      await screen.findByText('Мову вибрано на цьому пристрої, але не збережено в профілі.'),
    ).toBeTruthy();
    expect(document.documentElement.lang).toBe('uk');
    expect(localStorage.getItem('ui_lang')).toBe('uk');
  });
});

describe('UX-03 design screens (development build only)', () => {
  const boot = () =>
    stubApi({
      'GET /api/me': () => json(200, { ...ME, ui_lang: 'en' }),
      'GET /api/books/current': () => json(200, BOOK),
    });

  it('import review highlights lines below confidence 0.7 with the PRD 5.1.3 reasons', async () => {
    await setLanguage('en');
    boot();
    renderApp('/dev/review');
    expect(await screen.findByRole('heading', { name: 'Check the recipe' })).toBeTruthy();
    expect(screen.getByText('Lines to check: 2')).toBeTruthy();
    const low = document.querySelectorAll('[data-low]');
    expect(low).toHaveLength(2);
    expect(low[0]!.textContent).toContain('No unit: check the amount');
    expect(low[0]!.textContent).toContain('A number in brackets was moved to the note');
    expect(low[1]!.textContent).toContain('Not recognized');
    // A suggested timer is accepted or skipped; suggested ingredient links can be toggled.
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.getByText('Timer skipped')).toBeTruthy();
    const [firstStepLinks] = screen.getAllByRole('group', {
      name: 'Ingredients used in this step',
    });
    const eggs = within(firstStepLinks!).getByRole('button', { name: 'яйца' });
    expect(eggs.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(eggs);
    expect(eggs.getAttribute('aria-pressed')).toBe('false');
  });

  it('is reachable from Profile in development', async () => {
    await setLanguage('en');
    boot();
    renderApp('/profile');
    fireEvent.click(await screen.findByRole('link', { name: 'Design previews' }));
    expect(await screen.findByRole('link', { name: 'Import review' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Recipe editor' })).toBeNull(); // the real one exists
    fireEvent.click(screen.getByRole('link', { name: 'Cooking mode' }));
    expect(await screen.findByRole('heading', { name: 'Cooking: Шарлотка' })).toBeTruthy();
  });

  it('"I cooked it" design (UX-05): the form, sent, what the author sees, and your own recipe', async () => {
    await setLanguage('en');
    boot();
    renderApp('/dev/cooked');
    expect(await screen.findByRole('heading', { name: 'You cooked “Шарлотка”' })).toBeTruthy();
    expect(screen.getByText('Add a photo of your dish')).toBeTruthy();
    expect(screen.getByLabelText('A few words for the author')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByRole('heading', { name: 'Sent!' })).toBeTruthy();
    expect(
      screen.getByText(
        'Dev Keeper will get a message with your photo and your words, unless they have turned these messages off.',
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'What the author sees' }));
    expect(screen.getByText('👨‍🍳 Dev Member cooked your “Шарлотка”!')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Your own recipe' }));
    expect(screen.getByText(/nobody gets a message/)).toBeTruthy();
  });

  it('cooking mode design (UX-04): preparation, step, timers, done and the problem states', async () => {
    await setLanguage('en');
    boot();
    renderApp('/dev/cook');
    expect(await screen.findByText('You stopped at step 2 of 3.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start cooking' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Step' }));
    expect(screen.getByText('Step 2 of 3')).toBeTruthy();
    // Desktop has no gestures: Back / Next are always there (PRD 7.3 compatibility).
    expect(screen.getByRole('button', { name: 'Next step' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Timers' }));
    fireEvent.click(screen.getByRole('button', { name: '⏱ Выпекайте · 38:12' }));
    expect(screen.getByRole('button', { name: '+1 min' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: '👨‍🍳 I cooked it' }));
    expect(screen.getByText('Add a photo of your dish')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Problems' }));
    expect(screen.getByText(/no Telegram message will arrive/)).toBeTruthy();
    expect(screen.getByText(/Turn off auto-lock/)).toBeTruthy();
  });
});
