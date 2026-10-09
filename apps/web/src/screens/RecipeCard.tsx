import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { RecipeSummary } from '../api/recipes';

export function RecipeListItem({ recipe }: { recipe: RecipeSummary }) {
  const { t } = useTranslation();
  const meta = [
    recipe.difficulty ? t(`difficulty.${recipe.difficulty}`) : null,
    recipe.totalMin !== null ? t('recipe.minutes', { count: recipe.totalMin }) : null,
    t('recipe.servings', { count: recipe.servings }),
  ].filter(Boolean);

  return (
    <Link to={`/recipe/${recipe.id}`} className="card">
      <span className="card__cover" aria-hidden="true">
        {recipe.emoji}
      </span>
      <span className="grow">
        <span className="card__title" style={{ display: 'block' }}>
          {recipe.title}
        </span>
        <span className="hint" style={{ display: 'block' }}>
          {t('recipe.by_author', { name: recipe.authorName })}
        </span>
        <span className="hint" style={{ display: 'block' }}>
          {meta.join(' · ')}
        </span>
      </span>
      {recipe.saved && <span aria-label={t('recipe.saved_badge')}>{'🔖'}</span>}
    </Link>
  );
}
