import { useTranslation } from 'react-i18next';
import type { RecipeSummary } from '../api/recipes';
import { RecipeListItem } from '../screens/RecipeCard';

/**
 * DEVELOPMENT ONLY (owner decision 5). Saving recipes is BE-10 (Sprint 5); until then the dev build
 * shows two recipes from db/seeds/dev.sql here so the shelf can be designed and tested. Imported
 * only behind import.meta.env.DEV; `pnpm check:bundle` fails if it reaches a production build.
 */
const SAMPLE: RecipeSummary[] = [
  {
    id: '00000000-0000-4000-8000-0000000000c2',
    title: 'Сырники',
    emoji: '🍳',
    authorName: 'Dev Member',
    isMine: false,
    isDraft: false,
    difficulty: 'easy',
    totalMin: 30,
    servings: 4,
    tags: [{ slug: 'breakfast', custom_name: null }],
    ingredientNames: [],
    thumbUrl: null,
  },
  {
    id: '00000000-0000-4000-8000-0000000000c4',
    title: 'Pannkakor',
    emoji: '🍳',
    authorName: 'Dev Member',
    isMine: false,
    isDraft: false,
    difficulty: 'easy',
    totalMin: 25,
    servings: 4,
    tags: [{ slug: 'breakfast', custom_name: null }],
    ingredientNames: [],
    thumbUrl: null,
  },
];

export default function DevSavedShelf() {
  const { t } = useTranslation();
  return (
    <div className="stack stack--tight" data-testid="dev-saved-shelf">
      <p className="dev-badge" role="note">
        {t('saved.dev_sample')}
      </p>
      {SAMPLE.map((r) => (
        <RecipeListItem key={r.id} recipe={r} />
      ))}
    </div>
  );
}
