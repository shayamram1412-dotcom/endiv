import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';

/** Accessible modal on top of native <dialog> (focus trap, Esc, backdrop). */
export function Dialog({ open, onClose, title, children, footer, size = 'md', side }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl'; side?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // Native showModal focuses the close button; move focus to the first form field instead.
      const field = d.querySelector<HTMLElement>('[data-autofocus]') ?? d.querySelector<HTMLElement>('[data-dialog-body] input:not([type=hidden]):not([disabled]), [data-dialog-body] textarea:not([disabled]), [data-dialog-body] select:not([disabled])');
      field?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className={clsx(
        'm-auto max-h-[92dvh] w-[calc(100%-1.5rem)] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-0 text-[var(--color-ink)] shadow-[var(--shadow-pop)] backdrop:bg-black/40',
        side && 'me-0 h-dvh max-h-dvh rounded-none sm:rounded-s-2xl',
        size === 'sm' ? 'max-w-md' : size === 'md' ? 'max-w-xl' : size === 'lg' ? 'max-w-3xl' : 'max-w-5xl',
      )}>
      {open && (
        <div className={clsx('flex flex-col', side ? 'h-dvh' : 'max-h-[92dvh]')}>
          <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-3.5">
            <h2 className="text-lg font-bold">{title}</h2>
            <button onClick={onClose} className="grid size-9 place-items-center rounded-lg hover:bg-[var(--color-surface-2)]" aria-label="סגירה"><X className="size-5" /></button>
          </div>
          <div data-dialog-body className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface-2)] px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
