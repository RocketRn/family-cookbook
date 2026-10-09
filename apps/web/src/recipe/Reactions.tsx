import { useTranslation } from 'react-i18next';

/** PRD 3.2 reactions. Markup only in Sprint 2: saving them is BE-10 / FE-10 (Sprint 5). */
const EMOTIONS = [
  ['heart', '❤️'],
  ['yum', '😋'],
  ['fire', '🔥'],
  ['idea', '💡'],
  ['curious', '🤔'],
] as const;
const ACTIONS = [
  ['cooked', '👨‍🍳'],
  ['cook_again', '🔁'],
  ['my_version', '✏️'],
] as const;

export function Reactions() {
  const { t } = useTranslation();
  return (
    <section className="section stack stack--tight" aria-labelledby="reactions-h">
      <h2 id="reactions-h">{t('reactions.title')}</h2>
      <div className="row row--wrap">
        {EMOTIONS.map(([kind, emoji]) => (
          <button
            key={kind}
            type="button"
            className="chip"
            disabled
            aria-label={t(`reactions.${kind}`)}
          >
            {emoji}
          </button>
        ))}
      </div>
      <div className="row row--wrap">
        {ACTIONS.map(([kind, emoji]) => (
          <button key={kind} type="button" className="chip" disabled>
            <span aria-hidden="true">{emoji}</span> {t(`reactions.${kind}`)}
          </button>
        ))}
      </div>
      <p className="hint">{t('reactions.coming_soon')}</p>
    </section>
  );
}
