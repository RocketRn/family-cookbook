import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

type Props = { open: boolean; title: string; onClose: () => void; children: ReactNode };

export function BottomSheet({ open, title, onClose, children }: Props) {
  const { t } = useTranslation();
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    sheetRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose} data-testid="sheet-backdrop">
      <div
        ref={sheetRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet__grab" aria-hidden="true" />
        <div className="row row--between" style={{ marginBottom: 'var(--space-3)' }}>
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            {'✕'}
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
