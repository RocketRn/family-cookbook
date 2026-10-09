import { useTranslation } from 'react-i18next';
import { EmptyState } from '../design/Feedback';

/** `startapp=r_<share_token>` target. The guest recipe screen is FE-11 (Sprint 6). */
export function LinkRecipeScreen() {
  const { t } = useTranslation();
  return <EmptyState icon={'🔗'} title={t('link_recipe.title')} text={t('link_recipe.text')} />;
}
