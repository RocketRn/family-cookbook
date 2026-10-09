import { useTranslation } from 'react-i18next';
import { Link, Route, Routes } from 'react-router-dom';
import { CookDesign } from './CookDesign';
import { CookedDesign } from './CookedDesign';
import { ReviewDesign } from './ReviewDesign';

/**
 * DEVELOPMENT ONLY: the UX-03 design of the import review (FE-05), the UX-04 design of cooking mode
 * (FE-08) and the UX-05 design of "I cooked it" (Sprint 5), built from the design system with
 * sample data. The recipe
 * editor design became the real editor (FE-04, D-035). Loaded only behind
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
              <Link className="card" to="review">
                {t('dev.review_link')}
              </Link>
              <Link className="card" to="cook">
                {t('dev.cook_link')}
              </Link>
              <Link className="card" to="cooked">
                {t('dev.cooked_link')}
              </Link>
            </div>
          }
        />
        <Route path="review" element={<ReviewDesign />} />
        <Route path="cook" element={<CookDesign />} />
        <Route path="cooked" element={<CookedDesign />} />
      </Routes>
    </div>
  );
}
