import type { Ingredient, Recipe, RecipeListItem, RecipePage } from '../src/api/types';

/** Recipe API fixtures in the wire shape of apps/api/src/recipes/view.ts. */
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
export const KEEPER = { id: id(1), name: 'Dev Keeper' };
export const MEMBER = { id: id(2), name: 'Dev Member' };

export function listItem(
  over: Partial<RecipeListItem> & { id: string; title: string },
): RecipeListItem {
  return {
    author: MEMBER,
    is_mine: false,
    difficulty: null,
    prep_min: null,
    cook_min: null,
    total_min: null,
    servings: 4,
    visibility: 'book',
    status: 'published',
    language: 'ru',
    cover: null,
    tags: [],
    ingredient_names: [],
    published_at: '2026-10-08T10:00:00Z',
    updated_at: '2026-10-08T10:00:00Z',
    ...over,
  };
}

export const GOLUBTSY_ID = id(0xc1);
export const SYRNIKI_ID = id(0xc2);
export const BOOK_PAGE: RecipePage = {
  items: [
    listItem({
      id: GOLUBTSY_ID,
      title: 'Голубцы',
      author: KEEPER,
      is_mine: true,
      difficulty: 'medium',
      prep_min: 40,
      cook_min: 90,
      total_min: 130,
      tags: [{ slug: 'main', custom_name: null }],
      ingredient_names: ['Капуста', 'Говяжий фарш', 'Рис'],
      cover: {
        id: id(0xa1),
        width: 2048,
        height: 1365,
        url: 'https://media.test/media/a1/full.jpg?signed=1',
        thumb_url: 'https://media.test/media/a1/thumb.jpg?signed=1',
      },
    }),
    listItem({
      id: SYRNIKI_ID,
      title: 'Сырники',
      difficulty: 'easy',
      prep_min: 10,
      cook_min: 20,
      total_min: 30,
      visibility: 'link',
      tags: [{ slug: 'breakfast', custom_name: null }],
      ingredient_names: ['Творог', 'Яйцо', 'Мука'],
    }),
    listItem({
      id: id(0xc4),
      title: 'Pannkakor',
      language: 'sv',
      difficulty: 'easy',
      total_min: 25,
      tags: [{ slug: 'breakfast', custom_name: null }],
      ingredient_names: ['Vetemjöl', 'Mjölk', 'Ägg'],
    }),
  ],
  next_cursor: null,
};

const ing = (n: number, over: Partial<Ingredient> & { name: string }): Ingredient => ({
  id: id(0x100 + n),
  position: n,
  group_label: null,
  qty_kind: 'exact',
  amount_min: null,
  amount_max: null,
  unit_code: null,
  unit_raw: null,
  round_class: 'continuous',
  min_piece: null,
  optional: false,
  note: null,
  raw_line: null,
  parse_confidence: null,
  ...over,
});

const MINCE = ing(2, {
  name: 'Говяжий фарш',
  amount_min: 800,
  unit_code: 'g',
  group_label: 'Для начинки',
});
const RICE = ing(3, { name: 'Рис', amount_min: 0.5, unit_code: 'cup', group_label: 'Для начинки' });

/** PRD 5.4's recipe: two sections, step links with a portion, a placeholder, a timer, a video. */
export const GOLUBTSY: Recipe = {
  id: GOLUBTSY_ID,
  title: 'Голубцы',
  author: KEEPER,
  is_mine: true,
  book_id: id(0xb1),
  status: 'published',
  visibility: 'book',
  share_token: null,
  servings: 4,
  difficulty: 'medium',
  prep_min: 40,
  cook_min: 90,
  language: 'ru',
  author_notes: 'Вкуснее на следующий день.',
  cover: BOOK_PAGE.items[0]!.cover,
  version: 1,
  can_edit: true,
  can_unpublish: true,
  tags: [
    { slug: 'main', custom_name: null },
    { slug: 'c:0123456789abcdef01234567', custom_name: 'бабушкин рецепт' },
  ],
  ingredients: [
    ing(1, {
      name: 'Капуста',
      amount_min: 1,
      unit_raw: 'кочан',
      round_class: 'whole_item',
      min_piece: 1,
    }),
    MINCE,
    RICE,
    ing(4, {
      name: 'Соль',
      qty_kind: 'to_taste',
      round_class: 'spice_item',
      group_label: 'Для начинки',
    }),
    ing(5, {
      name: 'Лавровый лист',
      amount_min: 2,
      unit_code: 'pcs',
      round_class: 'spice_item',
      optional: true,
      group_label: 'Для соуса',
    }),
    ing(6, {
      name: 'щепотка любви',
      qty_kind: 'unparsed',
      raw_line: 'немного любви и терпения',
      group_label: 'Для соуса',
    }),
  ],
  videos: [
    { id: id(0x201), position: 0, youtube_id: 'dQw4w9WgXcQ', title: 'Как заворачивать' },
    { id: id(0x202), position: 1, youtube_id: 'aqz-KE-bpKQ', title: null },
  ],
  steps: [
    {
      id: id(0x301),
      position: 0,
      title: 'Начинка',
      body: 'Смешайте {ing:' + MINCE.id + '} фарша и {ing:' + RICE.id + '} риса. <b>не HTML</b>',
      photo: null,
      video_id: null,
      video_start_sec: null,
      ingredients: [
        { ingredient_id: MINCE.id, portion_fraction: 1 },
        { ingredient_id: RICE.id, portion_fraction: 0.5 },
      ],
      timers: [],
    },
    {
      id: id(0x302),
      position: 1,
      title: null,
      body: 'Заверните и тушите.',
      photo: {
        id: id(0xa2),
        width: 1024,
        height: 768,
        url: 'https://media.test/media/a2/full.jpg?signed=1',
        thumb_url: 'https://media.test/media/a2/thumb.jpg?signed=1',
      },
      video_id: id(0x201),
      video_start_sec: 95,
      ingredients: [],
      timers: [{ id: id(0x401), position: 0, label: 'Тушить', duration_sec: 5400 }],
    },
  ],
};
