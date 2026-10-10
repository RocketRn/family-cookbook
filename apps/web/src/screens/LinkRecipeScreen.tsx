import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Navigate, useParams } from 'react-router-dom';
import type { Me } from '../api/endpoints';
import { recipeApi } from '../api/recipeApi';
import { EmptyState, ErrorState, Loading } from '../design/Feedback';
import { RecipeView } from './RecipeScreen';

/**
 * FE-11 / S6-3 (PRD UC-08, 4.7 `r_<share_token>`; owner's Sprint 6 answer 2; D-055): a recipe
 * shared by link. Someone who may open it anyway (its author, a member of its book) gets the usual
 * card; anyone else reads it as a guest: recalculate and cook with timers, no saving or reactions.
 */
export function LinkRecipeScreen({ me }: { me?: Me }) {
  const { t } = useTranslation();
  const { token = '' } = useParams();
  const shared = useQuery({
    queryKey: ['recipe-link', token],
    queryFn: () => recipeApi.getByLink(token),
  });
  const id = shared.data?.id;
  const usual = useQuery({
    queryKey: ['recipe', id],
    queryFn: () => recipeApi.get(id!),
    enabled: !!id,
    retry: false,
  });

  if (shared.isLoading || (id && usual.isLoading)) return <Loading />;
  if (shared.isError)
    return <ErrorState error={shared.error} onRetry={() => void shared.refetch()} />;
  if (!shared.data)
    return (
      <EmptyState
        icon={'🔗'}
        title={t('link_recipe.gone_title')}
        text={t('link_recipe.gone_text')}
      />
    );
  if (usual.data) return <Navigate to={`/recipe/${usual.data.id}`} replace />;
  return (
    <RecipeView
      key={shared.data.id}
      r={shared.data}
      botStarted={me?.bot_started ?? false}
      guest={token}
    />
  );
}
