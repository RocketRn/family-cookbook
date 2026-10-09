import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { recipeApi } from '../api/recipeApi';
import { Button } from '../design/Button';
import { Tag } from '../design/Chip';
import { EmptyState } from '../design/Feedback';
import { haptic } from '../telegram/sdk';

/** Placeholder card: the real recipe card (FE-03) and recalculation/cooking arrive in later sprints. */
export function RecipeScreen() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const recipe = useQuery({ queryKey: ['recipe', id], queryFn: () => recipeApi.get(id) });
  const toggleSaved = useMutation({
    mutationFn: (saved: boolean) => recipeApi.setSaved(id, saved),
    onSuccess: () => {
      haptic('success');
      void qc.invalidateQueries({ queryKey: ['recipe', id] });
      void qc.invalidateQueries({ queryKey: ['recipes'] });
    },
  });

  if (recipe.isLoading)
    return (
      <p className="hint" role="status">
        {t('common.loading')}
      </p>
    );
  const r = recipe.data;
  if (!r) return <EmptyState icon={'🍽️'} title={t('recipe.not_found')} />;

  const recalcLabel = `${t('recipe.recalculate')} · ${t('common.coming_soon')}`;
  const cookLabel = `${t('recipe.cook')} · ${t('common.coming_soon')}`;

  return (
    <div className="stack">
      <div
        className="center"
        style={{ fontSize: 72, padding: 'var(--space-4)' }}
        aria-hidden="true"
      >
        {r.emoji}
      </div>
      <div>
        <h1>{r.title}</h1>
        <p className="hint">{t('recipe.by_author', { name: r.authorName })}</p>
      </div>
      <div className="row row--wrap">
        <Tag>{t(`recipe.visibility.${r.visibility}`)}</Tag>
        {r.difficulty && <Tag>{t(`difficulty.${r.difficulty}`)}</Tag>}
        {r.totalMin !== null && <Tag>{t('recipe.minutes', { count: r.totalMin })}</Tag>}
        <Tag>{t('recipe.servings', { count: r.servings })}</Tag>
        {r.tags.map((tag) => (
          <Tag key={tag}>{t(`tags.${tag}`)}</Tag>
        ))}
      </div>
      {r.ingredientNames.length > 0 && (
        <section className="section stack stack--tight" aria-label={t('recipe.ingredients')}>
          <h2>{t('recipe.ingredients')}</h2>
          <ul style={{ margin: 0, paddingLeft: 'var(--space-5)' }}>
            {r.ingredientNames.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      )}
      <p className="hint">{t('recipe.placeholder_note')}</p>
      <div className="row">
        <Button className="grow" variant="secondary" disabled>
          {recalcLabel}
        </Button>
        <Button className="grow" disabled>
          {cookLabel}
        </Button>
      </div>
      {!r.isMine && (
        <Button
          variant={r.saved ? 'ghost' : 'primary'}
          disabled={toggleSaved.isPending}
          onClick={() => toggleSaved.mutate(!r.saved)}
        >
          {r.saved ? t('recipe.unsave') : t('recipe.save')}
        </Button>
      )}
    </div>
  );
}
