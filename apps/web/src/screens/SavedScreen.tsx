import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { recipeApi } from '../api/recipeApi';
import { EMPTY_FILTERS } from '../api/recipes';
import { EmptyState, ErrorState, Loading } from '../design/Feedback';
import { RecipeListItem } from './RecipeCard';

const SAVED = { ...EMPTY_FILTERS, scope: 'saved' as const };

export function SavedScreen() {
  const { t } = useTranslation();
  const list = useQuery({ queryKey: ['recipes', SAVED], queryFn: () => recipeApi.list(SAVED) });
  return (
    <div className="stack">
      <h1>{t('saved.title')}</h1>
      {list.isLoading && <Loading />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data?.length === 0 && (
        <EmptyState icon={'🔖'} title={t('saved.empty_title')} text={t('saved.empty_text')} />
      )}
      <div className="stack stack--tight">
        {list.data?.map((r) => (
          <RecipeListItem key={r.id} recipe={r} />
        ))}
      </div>
    </div>
  );
}
