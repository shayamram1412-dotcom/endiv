import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';
import clsx from 'clsx';

interface Toast { id: number; kind: 'success' | 'error'; text: string }
interface ToastApi { success: (t: string) => void; error: (t: string) => void }

const Ctx = createContext<ToastApi>({ success: () => {}, error: () => {} });
export const useToast = () => useContext(Ctx);

let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const remove = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = ++seq;
    setItems((l) => [...l.slice(-3), { id, kind, text }]);
    setTimeout(() => remove(id), kind === 'error' ? 7000 : 3200);
  }, [remove]);
  const api = useMemo(() => ({ success: (t: string) => push('success', t), error: (t: string) => push('error', t) }), [push]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'}
            className={clsx('pointer-events-auto flex max-w-lg items-start gap-2 rounded-xl px-4 py-3 text-sm font-medium shadow-[var(--shadow-pop)]',
              t.kind === 'success' ? 'bg-[var(--color-ink)] text-[var(--color-bg)]' : 'bg-[var(--color-danger)] text-white')}>
            {t.kind === 'success' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />}
            <span className="flex-1">{t.text}</span>
            <button onClick={() => remove(t.id)} aria-label="סגירת הודעה" className="opacity-70 hover:opacity-100"><X className="size-4" /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
