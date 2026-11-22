import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, Lock, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { Button } from './Button.tsx';
import { ApiError } from '../lib/api.ts';

export function PageHeader({ title, subtitle, actions, eyebrow, children }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-semibold text-[var(--color-muted)]">{eyebrow}</div>}
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-[var(--color-ink-2)]">{subtitle}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Card({ title, actions, children, className, bodyClass, id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string; id?: string }) {
  return (
    <section className={clsx('card', className)} aria-labelledby={title && id ? `${id}-t` : undefined}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-3">
          {title && <h2 id={id ? `${id}-t` : undefined} className="text-[15px] font-bold">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={clsx('p-4', bodyClass)}>{children}</div>
    </section>
  );
}

export function EmptyState({ title, text, action, icon }: { title: string; text?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      <div className="grid size-12 place-items-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-muted)]">{icon ?? <Inbox className="size-6" aria-hidden />}</div>
      <p className="font-semibold">{title}</p>
      {text && <p className="max-w-sm text-sm text-[var(--color-muted)]">{text}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const e = error instanceof ApiError ? error : null;
  if (e?.status === 403) return <Forbidden text={e.message} />;
  if (e?.status === 404) return <EmptyState title={e.message} text="ייתכן שהרשומה נמחקה או שאינה בתחום ההרשאה שלך." />;
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <AlertTriangle className="size-8 text-[var(--color-danger)]" aria-hidden />
      <p className="font-semibold">לא הצלחנו לטעון את הנתונים</p>
      <p className="text-sm text-[var(--color-muted)]">{e?.message ?? 'שגיאה לא צפויה'}</p>
      {retry && <Button onClick={retry} icon={<RefreshCw className="size-4" />}>נסה שוב</Button>}
    </div>
  );
}

export function Forbidden({ text }: { text?: string }) {
  return <EmptyState icon={<Lock className="size-6" aria-hidden />} title="אין הרשאה" text={text ?? 'האזור הזה אינו בתחום ההרשאות שלך. לבקשת גישה פנה להנהלה.'} />;
}

export function Loading({ rows = 4, label = 'טוען' }: { rows?: number; label?: string }) {
  return (
    <div className="space-y-3 p-2" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton h-10" style={{ opacity: 1 - i * 0.15 }} />)}
    </div>
  );
}

/** Query wrapper: loading → error → empty → content. */
export function QueryView<T>({ q, children, empty, rows }: {
  q: { data: T | undefined; isLoading: boolean; error: unknown; refetch: () => unknown };
  children: (d: T) => ReactNode;
  empty?: (d: T) => ReactNode | null;
  rows?: number;
}) {
  if (q.isLoading) return <Loading rows={rows} />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (q.data === undefined) return null;
  const e = empty?.(q.data);
  if (e) return <>{e}</>;
  return <>{children(q.data)}</>;
}

export function DL({ items, cols = 2 }: { items: [ReactNode, ReactNode][]; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={clsx('grid gap-x-6 gap-y-3', cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3')}>
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs font-semibold text-[var(--color-muted)]">{k}</dt>
          <dd className="mt-0.5 break-words text-sm">{v === '' || v === null || v === undefined ? '—' : v}</dd>
        </div>
      ))}
    </dl>
  );
}
