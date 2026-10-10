import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { addReaction, type CookedBody } from '../api/reactions';
import { recipeApi } from '../api/recipeApi';
import type { Photo } from '../api/types';
import { Button } from '../design/Button';
import { EmptyState, ErrorState, Loading } from '../design/Feedback';
import { PhotoSlot } from '../editor/parts';
import { errorMessage } from '../errors';
import { reactionsKey } from '../recipe/Reactions';
import { useToastStore } from '../state/store';
import { haptic } from '../telegram/sdk';

/** The same limit as the server (D-048); it also keeps the bot's photo caption short enough. */
const NOTE_MAX = 500;

/**
 * FE-10 (PRD 2.4 steps 12-14; D-044 design, D-048): "I cooked it". A photo and a few words for the
 * author are both optional; the author gets them from the bot, unless the recipe is your own.
 * Opened from the card, or from the Done screen of cooking (?session=<cooking session>).
 */
export function CookedScreen() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToastStore((s) => s.show);
  const recipe = useQuery({ queryKey: ['recipe', id], queryFn: () => recipeApi.get(id) });
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  if (recipe.isLoading) return <Loading />;
  if (recipe.isError)
    return <ErrorState error={recipe.error} onRetry={() => void recipe.refetch()} />;
  const r = recipe.data;
  if (!r) return <EmptyState icon={'🍽️'} title={t('recipe.not_found')} />;
  const own = r.is_mine;
  const author = r.author.name ?? t('reactions.someone');
  const back = () => navigate(`/recipe/${r.id}`, { replace: true });

  async function send(withWords: boolean) {
    const session = search.get('session');
    const words = note.trim();
    const body: CookedBody = {
      kind: 'cooked',
      ...(withWords && words ? { note: words } : {}),
      ...(withWords && photo ? { photo_media_id: photo.id } : {}),
      ...(session ? { cook_session_id: session } : {}),
    };
    setBusy(true);
    try {
      await addReaction(r!.id, body);
      haptic('success');
      await qc.invalidateQueries({ queryKey: reactionsKey(r!.id) });
      setSent(true);
    } catch (err) {
      toast(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="stack center">
        <p className="cook__done" aria-hidden="true">
          {own ? '🎉' : '👨‍🍳'}
        </p>
        <h1>{t('cooked.sent_title')}</h1>
        <p>{own ? t('cooked.own_text') : t('cooked.sent_text', { name: author })}</p>
        <Button block onClick={back}>
          {t('cook.back_to_recipe')}
        </Button>
      </div>
    );
  }

  const counter = `${[...note].length} / ${NOTE_MAX}`;
  return (
    <div className="stack">
      <h1>{t('cooked.title', { title: r.title })}</h1>
      <p className="hint">{own ? t('cooked.own_intro') : t('cooked.intro', { name: author })}</p>
      <PhotoSlot
        photo={photo}
        onChange={setPhoto}
        label={t('cook.cooked_photo')}
        alt={t('cooked.photo_alt')}
      />
      <label className="stack stack--tight">
        <span className="label">{own ? t('cooked.comment_own') : t('cook.cooked_comment')}</span>
        <textarea
          className="field textarea"
          value={note}
          maxLength={NOTE_MAX}
          placeholder={t('cooked.comment_hint')}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <p className="hint">{counter}</p>
      <div className="actionbar row">
        <Button
          variant="secondary"
          className="grow"
          disabled={busy}
          onClick={() => void send(false)}
        >
          {t('cooked.later')}
        </Button>
        <Button className="grow" disabled={busy} onClick={() => void send(true)}>
          {t('cook.cooked_send')}
        </Button>
      </div>
    </div>
  );
}
