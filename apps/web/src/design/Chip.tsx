import type { ButtonHTMLAttributes } from 'react';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  selected?: boolean;
  onToggle?: () => void;
};

/** Toggle chip (filters, language). Exposes its state through aria-pressed. */
export function Chip({
  selected = false,
  onToggle,
  className = '',
  type = 'button',
  ...rest
}: Props) {
  return (
    <button
      type={type}
      className={['chip', className].filter(Boolean).join(' ')}
      aria-pressed={selected}
      onClick={onToggle}
      {...rest}
    />
  );
}

export function Tag({ children }: { children: React.ReactNode }) {
  return <span className="chip chip--static chip--wraps">{children}</span>;
}
