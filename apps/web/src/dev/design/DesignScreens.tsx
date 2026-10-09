import { useTranslation } from 'react-i18next';
import { Link, Route, Routes } from 'react-router-dom';
import { EditorDesign } from './EditorDesign';
import { ReviewDesign } from './ReviewDesign';

/**
 * DEVELOPMENT ONLY: UX-03 design screens for the recipe editor (FE-04, Sprint 3) and the import
 * review (FE-05, Sprint 4), built from the design system with sample data. Loaded only behind
 * import.meta.env.DEV; `pnpm check:bundle` fails if they reach a production build.
 */
export default function DesignScreens() {
  const { t } = useTranslation();
  return (
    <div className="stack" data-testid="dev-design-screens">
      <p className="dev-badge" role="note">
        {t('dev.design_note')}
      </p>
      <Routes>
        <Route
          index
          element={
            <div className="stack">
              <h1>{t('dev.design_title')}</h1>
              <Link className="card" to="editor">
                {t('dev.editor_link')}
              </Link>
              <Link className="card" to="review">
                {t('dev.review_link')}
              </Link>
            </div>
          }
        />
        <Route path="editor" element={<EditorDesign />} />
        <Route path="review" element={<ReviewDesign />} />
      </Routes>
    </div>
  );
}
