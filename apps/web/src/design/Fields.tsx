import { useId, type InputHTMLAttributes } from 'react';

type Props = InputHTMLAttributes<HTMLInputElement> & { label?: string };

export function TextField({ label, className = '', ...rest }: Props) {
  const id = useId();
  return (
    <div>
      {label && (
        <label className="label" htmlFor={id}>
          {label}
        </label>
      )}
      <input id={id} className={['field', className].filter(Boolean).join(' ')} {...rest} />
    </div>
  );
}

export function SearchField(props: Omit<Props, 'type' | 'label'> & { 'aria-label': string }) {
  return <input type="search" className="field" enterKeyHint="search" {...props} />;
}
