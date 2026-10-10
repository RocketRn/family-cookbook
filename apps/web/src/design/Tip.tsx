import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';

/** The first-run tips (S6-6, D-059), each shown until "Got it". */
export type TipId = 'forward' | 'recalculate' | 'timers';

const key = (id: TipId) => `tip:${id}`;
function seen(id: TipId): boolean {
  try {
    return localStorage.getItem(key(id)) === 'seen';
  } catch {
    return false;
  }
}

/**
 * One thing that is easy to miss, said where it matters, until the person taps "Got it"; then
 * never again on this phone (local storage; if it is unavailable, until the app is closed).
 */
export function Tip({ id }: { id: TipId }) {
  const { t } = useTranslation();
  const [hidden, setHidden] = useState(() => seen(id));
  if (hidden) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(key(id), 'seen');
    } catch {
      /* storage may be unavailable in some WebViews */
    }
    setHidden(true);
  };
  return (
    <aside className="tip" role="note" aria-label={t('tips.label')}>
      <span className="tip__icon" aria-hidden="true">
        {'💡'}
      </span>
      <p className="tip__text">{t(`tips.${id}`)}</p>
      <Button variant="ghost" className="tip__ok" onClick={dismiss}>
        {t('tips.got_it')}
      </Button>
    </aside>
  );
}
