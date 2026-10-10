import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../errors';
import { useOnline } from '../state/online';
import { Button } from './Button';

export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon: string;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="stack center">
      <div style={{ fontSize: 48 }} aria-hidden="true">
        {icon}
      </div>
      <h2>{title}</h2>
      {text && <p className="hint">{text}</p>}
      {action}
    </div>
  );
}

/** Every failed load shows the reason (from i18n) and a retry, never a misleading empty state. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div role="alert">
      <EmptyState
        icon={'⚠️'}
        title={errorMessage(t, error)}
        action={<Button onClick={onRetry}>{t('common.retry')}</Button>}
      />
    </div>
  );
}

/** "Loading…", or, without a connection, that it will load when the connection is back (S6-6). */
export function Loading() {
  const { t } = useTranslation();
  const online = useOnline();
  return (
    <p className="hint" role="status">
      {online ? t('common.loading') : t('offline.waiting')}
    </p>
  );
}

/** S6-6: a note at the top of every screen while there is no connection. */
export function OfflineNote() {
  const { t } = useTranslation();
  if (useOnline()) return null;
  return (
    <p className="offline-note" role="status">
      {t('offline.note')}
    </p>
  );
}

export function Avatar({ name, src }: { name: string; src?: string | null }) {
  return (
    <span className="avatar" aria-hidden="true">
      {src ? <img src={src} alt="" /> : (name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="toast" role="status">
      {message}
    </div>
  );
}
