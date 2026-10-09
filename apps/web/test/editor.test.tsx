import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../src/i18n';
import { __resetTelegramRuntime, getRuntime } from '../src/telegram/sdk';
import { BOOK_PAGE, GOLUBTSY, GOLUBTSY_ID } from './fixtures';
import { BOOK, BOOK_LIST, json, ME, renderApp, stubApi, type Handler } from './harness';

/** FE-04 editor and the recipe card actions (PRD 2.2 steps 7-10, 3.3, 4.9; D-035). */
const NEW_ID = '00000000-0000-4000-8000-0000000000d1';
const PHOTO = {
  id: '00000000-0000-4000-8000-0000000000a9',
  width: 2048,
  height: 1536,
  url: 'https://media.test/media/a9/full.jpg?signed=1',
  thumb_url: 'https://media.test/media/a9/thumb.jpg?signed=1',
};
const err = (status: number, code: string, details?: unknown) =>
  json(status, { error: { code, message: 'x', request_id: 'r', details } });

function api(extra: Record<string, Handler> = {}) {
  return stubApi({
    'GET /api/me': () => json(200, { ...ME, ui_lang: 'en' }),
    'GET /api/books/current': () => json(200, BOOK),
    [BOOK_LIST]: () => json(200, BOOK_PAGE),
    [`GET /api/recipes/${GOLUBTSY_ID}`]: () => json(200, GOLUBTSY),
    ...extra,
  });
}
const bodyOf = (calls: ReturnType<typeof api>, key: string) =>
  JSON.parse(calls.find((c) => `${c.method} ${c.url}` === key)!.body!);
const change = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

beforeEach(async () => {
  __resetTelegramRuntime();
  await setLanguage('en');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('recipe editor: a new recipe', () => {
  it('"＋" opens the editor; the author writes a recipe and publishes it', async () => {
    const calls = api({
      'POST /api/recipes': () => json(201, { ...GOLUBTSY, id: NEW_ID, title: 'Шарлотка' }),
      [`GET /api/recipes/${NEW_ID}`]: () =>
        json(200, { ...GOLUBTSY, id: NEW_ID, title: 'Шарлотка' }),
    });
    renderApp('/');
    fireEvent.click(await screen.findByRole('button', { name: 'New recipe' }));
    fireEvent.click(screen.getByRole('button', { name: /Write a recipe/ }));
    expect(await screen.findByRole('heading', { name: 'New recipe' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Русский' }));
    change(screen.getByLabelText('Title'), 'Шарлотка');
    fireEvent.click(screen.getByRole('button', { name: 'More servings' }));
    change(screen.getByLabelText('Ingredient'), 'сахар');
    change(screen.getByLabelText('Amount'), '1');
    fireEvent.click(screen.getByRole('button', { name: 'Ingredient details' }));
    const details = screen.getByRole('dialog', { name: 'Ingredient details' });
    // Unit names come from recipe-core, in the recipe's language (D-021).
    fireEvent.click(within(details).getByRole('button', { name: 'стакан' }));
    fireEvent.click(within(details).getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: 'Ingredient details' }).textContent).toBe('стакан');

    const text = screen.getByLabelText('What to do in step 1') as HTMLTextAreaElement;
    change(text, 'Взбейте яйца с ');
    fireEvent.click(screen.getByRole('button', { name: 'Link ingredient' }));
    const pick = screen.getByRole('dialog', { name: 'Link ingredient' });
    fireEvent.click(within(pick).getByRole('button', { name: 'сахар' }));
    fireEvent.click(within(pick).getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: 'сахар · All' }));
    const link = screen.getByRole('dialog', { name: 'сахар' });
    expect(within(link).getByText('In this step: 1 стакан')).toBeTruthy();
    fireEvent.click(within(link).getByRole('button', { name: 'Insert into the text' }));
    // Owner decision: "name (amount)"; the author may change the word, the amount follows k.
    expect(text.value).toBe('Взбейте яйца с сахар ([сахар])');
    change(text, 'Взбейте яйца с сахаром ([сахар])');
    expect(screen.getByTestId('step-preview').textContent).toBe(
      'In the recipe: Взбейте яйца с сахаром (1 стакан)',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByRole('heading', { name: 'Шарлотка' })).toBeTruthy();
    const body = bodyOf(calls, 'POST /api/recipes');
    const sugar = body.ingredients[0];
    expect(body).toMatchObject({
      title: 'Шарлотка',
      servings: 5,
      language: 'ru',
      status: 'published',
      visibility: 'book',
      videos: [],
    });
    expect(sugar).toMatchObject({
      name: 'сахар',
      qty_kind: 'exact',
      amount_min: 1,
      unit_code: 'cup',
    });
    expect(body.steps).toEqual([
      expect.objectContaining({
        body: `Взбейте яйца с сахаром ({ing:${sugar.ref}})`,
        ingredients: [{ ref: sugar.ref, portion_fraction: 1 }],
      }),
    ]);
  });

  it('publishing with parts missing says what is missing and sends nothing', async () => {
    const calls = api();
    renderApp('/recipe/new');
    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }));
    expect(
      screen.getByText('To publish, add a title, at least one ingredient, and at least one step.'),
    ).toBeTruthy();
    expect(screen.getByText('Enter a title.')).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    // A draft needs only a title.
    change(screen.getByLabelText('Title'), 'Чай');
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeTruthy();
  });

  it('an amount it cannot read is marked on the line', async () => {
    api();
    renderApp('/recipe/new');
    change(await screen.findByLabelText('Title'), 'Суп');
    change(screen.getByLabelText('Ingredient'), 'мука');
    change(screen.getByLabelText('Amount'), 'много');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(screen.getByText(/Enter an amount like 2, 1.5/)).toBeTruthy();
    expect(screen.getByLabelText('Amount').getAttribute('aria-invalid')).toBe('true');
  });

  it('a server answer NOT_PUBLISHABLE is shown the same way', async () => {
    api({ 'POST /api/recipes': () => err(409, 'NOT_PUBLISHABLE', { missing: ['steps'] }) });
    renderApp('/recipe/new');
    change(await screen.findByLabelText('Title'), 'Чай');
    change(screen.getByLabelText('Ingredient'), 'чай');
    change(screen.getByLabelText('Amount'), '1');
    change(screen.getByLabelText('What to do in step 1'), 'Заварите.');
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText('To publish, add at least one step.')).toBeTruthy();
  });

  it('photos: only JPEG, PNG and WebP; HEIC is refused before upload; the cover is saved', async () => {
    const calls = api({
      'POST /api/media': () => json(201, PHOTO),
      'POST /api/recipes': () => json(201, { ...GOLUBTSY, id: NEW_ID }),
      [`GET /api/recipes/${NEW_ID}`]: () => json(200, { ...GOLUBTSY, id: NEW_ID }),
    });
    renderApp('/recipe/new');
    const [cover] = await screen.findAllByTestId('photo-input');
    expect(cover!.getAttribute('accept')).toBe('image/jpeg,image/png,image/webp');
    fireEvent.change(cover!, {
      target: { files: [new File(['x'], 'IMG_0001.HEIC', { type: 'image/heic' })] },
    });
    expect(await screen.findByText(/HEIC photos \(the iPhone format\)/)).toBeTruthy();
    expect(calls.some((c) => c.url === '/api/media')).toBe(false);

    fireEvent.change(cover!, {
      target: { files: [new File(['x'], 'pie.jpg', { type: 'image/jpeg' })] },
    });
    const img = (await screen.findByRole('img', { name: 'Recipe photo' })) as HTMLImageElement;
    expect(img.src).toBe(PHOTO.thumb_url);
    change(screen.getByLabelText('Title'), 'Пирог');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/recipes')).toBe(true));
    expect(bodyOf(calls, 'POST /api/recipes')).toMatchObject({
      cover_media_id: PHOTO.id,
      status: 'draft',
    });
  });
});

describe('recipe editor: editing', () => {
  it('opens a saved recipe with its tokens and sends it back with its ids', async () => {
    const calls = api({ [`PATCH /api/recipes/${GOLUBTSY_ID}`]: () => json(200, GOLUBTSY) });
    renderApp(`/recipe/${GOLUBTSY_ID}/edit`);
    expect(await screen.findByRole('heading', { name: 'Edit recipe' })).toBeTruthy();
    const step = screen.getByLabelText('What to do in step 1') as HTMLTextAreaElement;
    expect(step.value).toBe('Смешайте [Говяжий фарш] фарша и [Рис] риса. <b>не HTML</b>');
    // Rice: ½ cup, half of it in this step.
    expect(screen.getAllByTestId('step-preview')[0]!.textContent).toBe(
      'In the recipe: Смешайте 800 г фарша и ¼ стакана риса. <b>не HTML</b>',
    );
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull(); // already published
    fireEvent.click(screen.getByRole('button', { name: 'More servings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const body = bodyOf(calls, `PATCH /api/recipes/${GOLUBTSY_ID}`);
    expect(body.servings).toBe(5);
    expect(body.status).toBe('published');
    expect(body.ingredients.map((i: { id: string }) => i.id)).toEqual(
      GOLUBTSY.ingredients.map((i) => i.id),
    );
    expect(body.steps[0].body).toBe(GOLUBTSY.steps[0]!.body);
  });

  it('unit names follow the recipe language (ru), not the interface (en)', async () => {
    api();
    renderApp(`/recipe/${GOLUBTSY_ID}/edit`);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Ingredient details' }))[0]!);
    const sheet = screen.getByRole('dialog', { name: 'Ingredient details' });
    expect(within(sheet).getByRole('button', { name: 'ст. л.' })).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'To taste' })).toBeTruthy();
  });

  it('unsaved changes: Back asks first, and Telegram asks before closing', async () => {
    api();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderApp(`/recipe/${GOLUBTSY_ID}/edit`);
    const title = await screen.findByLabelText('Title');
    const webApp = getRuntime().webApp as { isClosingConfirmationEnabled?: boolean };
    expect(webApp.isClosingConfirmationEnabled).toBe(false);
    change(title, 'Голубцы ленивые');
    expect(webApp.isClosingConfirmationEnabled).toBe(true);

    fireEvent.click(screen.getByTestId('mock-back-button'));
    expect(confirm).toHaveBeenCalledWith('Leave without saving? Your changes will be lost.');
    expect(screen.getByRole('heading', { name: 'Edit recipe' })).toBeTruthy();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByTestId('mock-back-button'));
    expect(await screen.findByRole('button', { name: 'New recipe' })).toBeTruthy(); // the book
    expect(webApp.isClosingConfirmationEnabled).toBe(false);
  });

  it('only the author can edit', async () => {
    api({
      [`GET /api/recipes/${GOLUBTSY_ID}`]: () =>
        json(200, { ...GOLUBTSY, is_mine: false, can_edit: false }),
    });
    renderApp(`/recipe/${GOLUBTSY_ID}/edit`);
    expect(await screen.findByText('Only the author can edit this recipe.')).toBeTruthy();
  });
});

describe('recipe card actions', () => {
  it('the author: Edit opens the editor', async () => {
    api();
    renderApp(`/recipe/${GOLUBTSY_ID}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(await screen.findByRole('heading', { name: 'Edit recipe' })).toBeTruthy();
  });

  it('the author: Delete asks, deletes and goes back to the book', async () => {
    const calls = api({
      [`DELETE /api/recipes/${GOLUBTSY_ID}`]: () => new Response(null, { status: 204 }),
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    renderApp(`/recipe/${GOLUBTSY_ID}`);
    const del = await screen.findByRole('button', { name: 'Delete recipe' });
    fireEvent.click(del);
    expect(confirm).toHaveBeenCalledWith('Delete this recipe? This cannot be undone.');
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false); // "no" keeps it
    fireEvent.click(del);
    expect(await screen.findByText('Recipe deleted')).toBeTruthy();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
    expect(await screen.findByRole('button', { name: 'New recipe' })).toBeTruthy(); // the book
  });

  it('the book keeper (not the author) may only unpublish', async () => {
    let unpublished = false;
    const calls = api({
      [`GET /api/recipes/${GOLUBTSY_ID}`]: () =>
        json(200, {
          ...GOLUBTSY,
          is_mine: false,
          can_edit: false,
          can_unpublish: !unpublished,
          visibility: unpublished ? 'private' : 'book',
        }),
      [`POST /api/recipes/${GOLUBTSY_ID}/unpublish`]: () => {
        unpublished = true;
        return new Response(null, { status: 204 });
      },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderApp(`/recipe/${GOLUBTSY_ID}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Unpublish' }));
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete recipe' })).toBeNull();
    expect(await screen.findByText('Recipe unpublished')).toBeTruthy();
    expect(calls.some((c) => c.url === `/api/recipes/${GOLUBTSY_ID}/unpublish`)).toBe(true);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Unpublish' })).toBeNull());
  });

  it('a member who is neither sees no actions', async () => {
    api({
      [`GET /api/recipes/${GOLUBTSY_ID}`]: () =>
        json(200, { ...GOLUBTSY, is_mine: false, can_edit: false, can_unpublish: false }),
    });
    renderApp(`/recipe/${GOLUBTSY_ID}`);
    expect(await screen.findByRole('heading', { name: 'Голубцы' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Recipe actions' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Unpublish' })).toBeNull();
  });
});
