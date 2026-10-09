import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../errors';
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

export function Loading() {
  const { t } = useTranslation();
  return (
    <p className="hint" role="status">
      {t('common.loading')}
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
