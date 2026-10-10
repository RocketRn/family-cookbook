import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  addReaction,
  getReactions,
  removeReaction,
  type CookedMark,
  type OneEach,
  type ReactionSummary,
} from '../api/reactions';
import type { Recipe } from '../api/types';
import { Button } from '../design/Button';
import { Chip } from '../design/Chip';
import { errorMessage } from '../errors';
import { useToastStore } from '../state/store';
import { haptic } from '../telegram/sdk';

/** PRD 3.2: the emotions, then "I'll cook it again"; one of each, a second tap removes it. */
const ONE_EACH: ReadonlyArray<[OneEach, string]> = [
  ['heart', '❤️'],
  ['yum', '😋'],
  ['fire', '🔥'],
  ['idea', '💡'],
  ['curious', '🤔'],
  ['cook_again', '🔁'],
];

export const reactionsKey = (recipeId: string) => ['reactions', recipeId] as const;

/**
 * FE-10 (PRD 2.4 steps 12-14, 3.2; D-048): reactions on the card. Counts for everyone, your own
 * pressed; "👨‍🍳 I cooked it" opens its screen; the author also sees who cooked it, with the
 * photo and the words. "My version" stays hidden (owner, Sprint 4).
 */
export function Reactions({ recipe }: { recipe: Recipe }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToastStore((s) => s.show);
  const key = reactionsKey(recipe.id);
  const q = useQuery({ queryKey: key, queryFn: () => getReactions(recipe.id) });
  const [busy, setBusy] = useState<OneEach | null>(null);

  async function toggle(kind: OneEach, mine: string | null) {
    setBusy(kind);
    haptic('select');
    try {
      if (mine) {
        await removeReaction(mine);
        await qc.invalidateQueries({ queryKey: key });
      } else {
        const r = await addReaction(recipe.id, { kind });
        qc.setQueryData<ReactionSummary>(key, r.summary);
      }
    } catch (err) {
      toast(errorMessage(t, err));
    } finally {
      setBusy(null);
    }
  }

  const s = q.data;
  return (
    <section className="section stack stack--tight" aria-labelledby="reactions-h">
      <h2 id="reactions-h">{t('reactions.title')}</h2>
      {q.isError && <p className="hint">{errorMessage(t, q.error)}</p>}
      {s && (
        <>
          <div className="row row--wrap">
            {ONE_EACH.map(([kind, emoji]) => {
              const count = s.counts[kind];
              const mine = s.mine[kind];
              return (
                <Chip
                  key={kind}
                  selected={!!mine}
                  aria-label={t('reactions.chip_label', { name: t(`reactions.${kind}`), count })}
                  disabled={busy !== null}
                  onToggle={() => void toggle(kind, mine)}
                >
                  <span aria-hidden="true">
                    {emoji}
                    {count > 0 ? ` ${count}` : ''}
                  </span>
                </Chip>
              );
            })}
          </div>
          {s.counts.cooked > 0 && <p>{t('reactions.cooked_times', { count: s.counts.cooked })}</p>}
          {s.mine.cooked > 0 && (
            <p className="hint">{t('reactions.cooked_mine', { count: s.mine.cooked })}</p>
          )}
          <Button variant="secondary" onClick={() => navigate(`/recipe/${recipe.id}/cooked`)}>
            {t('cook.cooked')}
          </Button>
          {recipe.is_mine && s.cooked.length > 0 && (
            <CookedList marks={s.cooked} lang={i18n.language} />
          )}
        </>
      )}
    </section>
  );
}

/** For the author: who cooked the recipe, with the photo and the words they left. */
function CookedList({ marks, lang }: { marks: CookedMark[]; lang: string }) {
  const { t } = useTranslation();
  return (
    <>
      <h3 id="cooked-by-h">{t('reactions.cooked_by')}</h3>
      <ul className="stack stack--tight cooked-list" aria-labelledby="cooked-by-h">
        {marks.map((m) => {
          const name = m.cook_name ?? t('reactions.someone');
          return (
            <li key={m.id} className="stack stack--tight">
              <div className="row">
                <strong>{name}</strong>
                <span className="hint">{new Date(m.created_at).toLocaleDateString(lang)}</span>
              </div>
              {m.photo && (
                <img
                  className="edit-photo"
                  src={m.photo.thumb_url}
                  alt={t('reactions.dish_of', { name })}
                />
              )}
              {m.note && <p className="pre-line">{m.note}</p>}
            </li>
          );
        })}
      </ul>
    </>
  );
}
