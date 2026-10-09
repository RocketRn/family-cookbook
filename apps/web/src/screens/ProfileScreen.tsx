import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  leaveBook,
  removeMember,
  rotateInvite,
  updateMe,
  type Member,
  type Me,
} from '../api/endpoints';
import { BottomSheet } from '../design/BottomSheet';
import { Button } from '../design/Button';
import { Chip } from '../design/Chip';
import { Avatar, ErrorState, Loading } from '../design/Feedback';
import { errorMessage } from '../errors';
import { LANGUAGES, LANGUAGE_NAMES, saveManualLanguage, setLanguage, type Language } from '../i18n';
import { bookQuery } from '../queries';
import { getRuntime, haptic } from '../telegram/sdk';
import { useToastStore } from '../state/store';

const BOT = import.meta.env.VITE_BOT_USERNAME ?? 'your_cookbook_bot';
const APP = import.meta.env.VITE_MINI_APP_SHORT_NAME ?? 'cookbook';

type Confirm = { kind: 'leave' } | { kind: 'rotate' } | { kind: 'remove'; member: Member } | null;

export function ProfileScreen({ me }: { me: Me }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const toast = useToastStore((s) => s.show);
  const book = useQuery(bookQuery);
  const [confirm, setConfirm] = useState<Confirm>(null);

  const refreshBook = () => qc.invalidateQueries({ queryKey: ['book'] });
  const action = useMutation({
    mutationFn: async (c: NonNullable<Confirm>) => {
      if (c.kind === 'leave') await leaveBook();
      else if (c.kind === 'rotate') await rotateInvite();
      else await removeMember(c.member.user_id);
      return c.kind;
    },
    onSuccess: async (kind) => {
      haptic('success');
      setConfirm(null);
      await refreshBook();
      if (kind === 'rotate') toast(t('profile.invite_rotated'));
    },
    onError: () => haptic('error'),
  });

  // The choice applies at once and is kept on this device; the profile copy (PATCH /me) is what
  // the bot and other devices use. If saving it fails, the user is told and can pick again.
  const saveLanguage = useMutation({
    mutationFn: (lang: Language) => updateMe({ ui_lang: lang }),
    onError: () => toast(t('profile.language_not_saved')),
  });
  const pickLanguage = (lang: Language) => {
    saveManualLanguage(lang);
    void setLanguage(lang);
    haptic('select');
    saveLanguage.mutate(lang);
  };

  const b = book.data;
  const handle = me.tg_username ? `@${me.tg_username}` : null;
  const youSuffix = ` (${t('profile.you')})`;
  const inviteLink = b?.invite_code
    ? `https://t.me/${BOT}/${APP}?startapp=join_${b.invite_code}`
    : null;
  const shareInvite = () => {
    if (!inviteLink) return;
    const url = `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent(t('profile.invite_share_text'))}`;
    getRuntime().webApp.openTelegramLink(url);
  };
  const copyInvite = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      toast(t('common.copied'));
    } catch {
      /* clipboard may be blocked in some WebViews; the share button remains */
    }
  };

  const confirmText =
    confirm?.kind === 'leave'
      ? t('profile.leave_text')
      : confirm?.kind === 'rotate'
        ? t('profile.invite_rotate_text')
        : confirm?.kind === 'remove'
          ? t('profile.remove_text', { name: confirm.member.first_name ?? '' })
          : '';

  return (
    <div className="stack">
      <h1>{t('profile.title')}</h1>

      <div className="section row">
        <Avatar name={me.first_name ?? '?'} src={me.photo_url} />
        <div className="grow">
          <div style={{ fontWeight: 600 }}>{me.first_name}</div>
          {handle && <div className="hint">{handle}</div>}
        </div>
      </div>

      {getRuntime().mocked && (
        <p className="dev-badge" role="note">
          {t('profile.dev_mode')}
        </p>
      )}

      <section className="section stack stack--tight" aria-labelledby="lang-h">
        <h2 id="lang-h">{t('profile.language')}</h2>
        <div className="row row--wrap">
          {LANGUAGES.map((l) => (
            <Chip key={l} selected={i18n.language === l} onToggle={() => pickLanguage(l)} lang={l}>
              {LANGUAGE_NAMES[l]}
            </Chip>
          ))}
        </div>
        <p className="hint">{t('profile.language_hint')}</p>
      </section>

      <section className="section stack stack--tight" aria-labelledby="book-h">
        <h2 id="book-h">{t('profile.book')}</h2>
        {book.isLoading && <Loading />}
        {book.isError && <ErrorState error={book.error} onRetry={() => void book.refetch()} />}
        {book.isSuccess && !b && <p className="hint">{t('profile.no_book')}</p>}
        {b && (
          <>
            <div className="row row--between">
              <strong>{b.title}</strong>
              <span className="hint">{t('profile.members', { count: b.members.length })}</span>
            </div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} className="stack stack--tight">
              {b.members.map((m) => (
                <li key={m.user_id} className="row">
                  <Avatar name={m.first_name ?? '?'} src={m.photo_url} />
                  <div className="grow">
                    <div>
                      {m.first_name}
                      {m.user_id === me.id && <span className="hint">{youSuffix}</span>}
                    </div>
                    <div className="hint">
                      {m.role === 'owner' ? t('profile.role_owner') : t('profile.role_member')}
                    </div>
                  </div>
                  {b.role === 'owner' && m.role !== 'owner' && (
                    <Button
                      variant="danger"
                      onClick={() => setConfirm({ kind: 'remove', member: m })}
                    >
                      {t('profile.remove_member')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {b.role === 'owner' && inviteLink && (
              <div className="stack stack--tight">
                <h3>{t('profile.invite')}</h3>
                <div className="row row--wrap">
                  <Button onClick={shareInvite}>{t('profile.invite_share')}</Button>
                  <Button variant="secondary" onClick={copyInvite}>
                    {t('common.copy')}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirm({ kind: 'rotate' })}>
                    {t('profile.invite_rotate')}
                  </Button>
                </div>
              </div>
            )}
            {b.role === 'owner' ? (
              <p className="hint">{t('profile.keeper_cannot_leave')}</p>
            ) : (
              <Button variant="danger" onClick={() => setConfirm({ kind: 'leave' })}>
                {t('profile.leave')}
              </Button>
            )}
          </>
        )}
      </section>

      <BottomSheet
        open={confirm !== null}
        title={
          confirm?.kind === 'leave'
            ? t('profile.leave')
            : confirm?.kind === 'rotate'
              ? t('profile.invite_rotate')
              : t('profile.remove_member')
        }
        onClose={() => setConfirm(null)}
      >
        <div className="stack">
          <p>{confirmText}</p>
          {action.isError && (
            <p className="error-text" role="alert">
              {errorMessage(t, action.error)}
            </p>
          )}
          <div className="row">
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              className="grow"
              variant="danger"
              disabled={action.isPending}
              onClick={() => confirm && action.mutate(confirm)}
            >
              {t('common.confirm')}
            </Button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
