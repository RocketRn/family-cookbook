import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { recipeApi } from '../api/recipeApi';
import type { Recipe } from '../api/types';
import { BottomSheet } from '../design/BottomSheet';
import { Button } from '../design/Button';
import { ErrorState, Loading } from '../design/Feedback';
import { useToastStore } from '../state/store';
import { getRuntime, haptic } from '../telegram/sdk';

/** A recipe can be shared once it is in the book or shared by link (S6-3b, D-056). */
export const canShare = (r: Recipe) => r.status === 'published' && r.visibility !== 'private';

/**
 * BE-12 / FE-11, S6-3b (PRD 4.7, R1; D-056): "Share". The server prepares a message with the
 * recipe and its button; Telegram's shareMessage (Bot API 8.0) lets the person pick a chat. With
 * an older Telegram, or when the bot could not prepare it, Telegram's share screen gets the link.
 */
export function ShareButton({ recipe }: { recipe: Recipe }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t('common.share')}
      </Button>
      {open && <ShareSheet recipe={recipe} onClose={() => setOpen(false)} />}
    </>
  );
}

function ShareSheet({ recipe, onClose }: { recipe: Recipe; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToastStore((s) => s.show);
  // Prepared once when the sheet opens, so "Send to a chat" answers at once.
  const share = useQuery({
    queryKey: ['share', recipe.id],
    queryFn: () => recipeApi.share(recipe.id),
    gcTime: 0,
    retry: false,
  });

  const send = () => {
    const s = share.data;
    if (!s) return;
    haptic('select');
    const app = getRuntime().webApp;
    if (s.prepared_message_id && app.isVersionAtLeast('8.0') && app.shareMessage) {
      app.shareMessage(s.prepared_message_id, (sent) => {
        if (sent) toast(t('share.sent'));
      });
      return;
    }
    app.openTelegramLink(
      `https://t.me/share/url?url=${encodeURIComponent(s.link)}&text=${encodeURIComponent(recipe.title)}`,
    );
  };
  const copy = async () => {
    if (!share.data) return;
    try {
      await navigator.clipboard.writeText(share.data.link);
      toast(t('common.copied'));
    } catch {
      /* clipboard may be blocked in some WebViews; "Send to a chat" remains */
    }
  };

  return (
    <BottomSheet open title={t('share.title')} onClose={onClose}>
      <div className="stack">
        <p className="hint">
          {recipe.visibility === 'link' ? t('share.for_anyone') : t('share.for_book')}
        </p>
        {share.isLoading && <Loading />}
        {share.isError && <ErrorState error={share.error} onRetry={() => void share.refetch()} />}
        {share.data && (
          <>
            <Button block onClick={send}>
              {t('share.send')}
            </Button>
            <Button block variant="secondary" onClick={() => void copy()}>
              {t('share.copy')}
            </Button>
          </>
        )}
      </div>
    </BottomSheet>
  );
}
