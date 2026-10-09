import type { ButtonHTMLAttributes } from 'react';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  block?: boolean;
};

export function Button({
  variant = 'primary',
  block,
  className = '',
  type = 'button',
  ...rest
}: Props) {
  const cls = ['btn', `btn--${variant}`, block ? 'btn--block' : '', className]
    .filter(Boolean)
    .join(' ');
  return <button type={type} className={cls} {...rest} />;
}
