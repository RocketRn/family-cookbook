import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState, Loading } from '../design/Feedback';

// Saving recipes arrives with BE-10 (Sprint 5). Production shows a neutral empty shelf; the dev
// build shows sample data (owner decision 5). The import sits behind the DEV flag, so production
// bundles do not contain it.
const DevSavedShelf = import.meta.env.DEV ? lazy(() => import('../dev/DevSavedShelf')) : null;

export function SavedScreen() {
  const { t } = useTranslation();
  return (
    <div className="stack">
      <h1>{t('saved.title')}</h1>
      {DevSavedShelf ? (
        <Suspense fallback={<Loading />}>
          <DevSavedShelf />
        </Suspense>
      ) : (
        <EmptyState icon={'🔖'} title={t('saved.empty_title')} text={t('saved.empty_text')} />
      )}
    </div>
  );
}
