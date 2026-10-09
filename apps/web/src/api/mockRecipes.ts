import { filterRecipes, type RecipeApi, type RecipeSummary } from './recipes';

/** Recipe texts stay in their original language and are never translated (PRD 1.5 #5). */
const DATA: RecipeSummary[] = [
  {
    id: '00000000-0000-4000-8000-0000000000c1',
    title: 'Голубцы',
    emoji: '🥬',
    authorName: 'Dev Keeper',
    isMine: true,
    difficulty: 'medium',
    totalMin: 120,
    servings: 4,
    tags: ['main'],
    visibility: 'book',
    ingredientNames: ['капуста', 'говяжий фарш', 'рис', 'лавровый лист'],
    saved: false,
  },
  {
    id: '00000000-0000-4000-8000-0000000000c2',
    title: 'Syrniki',
    emoji: '🥞',
    authorName: 'Dev Member',
    isMine: false,
    difficulty: 'easy',
    totalMin: 30,
    servings: 4,
    tags: ['breakfast', 'dessert'],
    visibility: 'link',
    ingredientNames: ['творог', 'яйца', 'мука', 'сахар'],
    saved: true,
  },
  {
    id: 'mock-borsch',
    title: 'Борщ по-мамински',
    emoji: '🍲',
    authorName: 'Anna',
    isMine: false,
    difficulty: 'medium',
    totalMin: 90,
    servings: 6,
    tags: ['soup', 'main'],
    visibility: 'book',
    ingredientNames: ['свёкла', 'капуста', 'говядина', 'картофель'],
    saved: true,
  },
  {
    id: 'mock-pannkakor',
    title: 'Pannkakor',
    emoji: '🥞',
    authorName: 'Lena',
    isMine: false,
    difficulty: 'easy',
    totalMin: 25,
    servings: 4,
    tags: ['breakfast'],
    visibility: 'book',
    ingredientNames: ['mjöl', 'mjölk', 'ägg', 'smör'],
    saved: false,
  },
  {
    id: 'mock-pie',
    title: 'Apple pie',
    emoji: '🥧',
    authorName: 'Olya',
    isMine: false,
    difficulty: 'hard',
    totalMin: 150,
    servings: 8,
    tags: ['baking', 'dessert'],
    visibility: 'book',
    ingredientNames: ['apples', 'flour', 'butter', 'cinnamon'],
    saved: false,
  },
  {
    id: 'mock-varenyky',
    title: 'Вареники з вишнею',
    emoji: '🥟',
    authorName: 'Oksana',
    isMine: false,
    difficulty: 'medium',
    totalMin: 80,
    servings: 4,
    tags: ['main', 'dessert'],
    visibility: 'book',
    ingredientNames: ['борошно', 'вишня', 'цукор'],
    saved: false,
  },
  {
    id: 'mock-salad',
    title: 'Греческий салат',
    emoji: '🥗',
    authorName: 'Dev Keeper',
    isMine: true,
    difficulty: 'easy',
    totalMin: 15,
    servings: 2,
    tags: ['salad', 'vegan'],
    visibility: 'book',
    ingredientNames: ['помидоры', 'огурцы', 'маслины', 'сыр фета'],
    saved: false,
  },
  {
    id: 'mock-private',
    title: 'Личная заметка (черновик)',
    emoji: '📝',
    authorName: 'Dev Keeper',
    isMine: true,
    difficulty: null,
    totalMin: null,
    servings: 4,
    tags: [],
    visibility: 'private',
    ingredientNames: [],
    saved: false,
  },
];

export function createMockRecipeApi(): RecipeApi {
  const rows = DATA.map((r) => ({ ...r }));
  const delay = () => new Promise((res) => setTimeout(res, 120));
  return {
    async list(filters) {
      await delay();
      return filterRecipes(rows, filters).map((r) => ({ ...r }));
    },
    async get(id) {
      await delay();
      const r = rows.find((x) => x.id === id);
      return r ? { ...r } : null;
    },
    async setSaved(id, saved) {
      await delay();
      const r = rows.find((x) => x.id === id);
      if (r) r.saved = saved;
    },
  };
}
