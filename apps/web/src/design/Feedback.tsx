import type { ReactNode } from 'react';

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
