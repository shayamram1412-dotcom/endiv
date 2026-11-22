import type { ReactNode } from 'react';
import clsx from 'clsx';
import { VENUE_LABEL, VENUE_COLORS, type VenueCode, SALES_STATUS, MENU_STATUS, LIFECYCLE, INTAKE_STATUS, PAYMENT_STATUS, PO_STATUS } from '@shared/domain.ts';
import { TASK_STATUS } from '@shared/tasks.ts';

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral' | 'brand';

const toneClass: Record<Tone, string> = {
  ok: 'bg-[var(--color-ok-soft)] text-[var(--color-ok)]',
  warn: 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]',
  danger: 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]',
  info: 'bg-[var(--color-info-soft)] text-[var(--color-info)]',
  neutral: 'bg-[var(--color-neutral-soft)] text-[var(--color-ink-2)]',
  brand: 'bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]',
};

/** Status is always shown in words, color only reinforces it. */
export function Badge({ tone = 'neutral', children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap', toneClass[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

export const venueColor = (v: VenueCode | null | undefined) => (v ? VENUE_COLORS[v] ?? 'var(--color-muted)' : 'var(--color-muted)');

export function VenueTag({ venue, className }: { venue: VenueCode; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-ink-2)] whitespace-nowrap', className)}>
      <span className="size-2.5 rounded-sm" style={{ background: venueColor(venue) }} aria-hidden />
      {VENUE_LABEL[venue]}
    </span>
  );
}

const SALES_TONE: Record<string, Tone> = { lead: 'info', quoted: 'info', tour: 'info', signed: 'ok', lost: 'neutral', hall: 'brand' };
const MENU_TONE: Record<string, Tone> = { open: 'neutral', draft: 'warn', approved: 'ok', changed: 'danger' };
const LIFE_TONE: Record<string, Tone> = { planning: 'brand', completed: 'warn', closed: 'neutral', cancelled: 'neutral' };
const INTAKE_TONE: Record<string, Tone> = { received: 'warn', missing: 'danger', verified: 'ok' };
const PAY_TONE: Record<string, Tone> = { none: 'neutral', deposit_due: 'warn', deposit_late: 'danger', balance_due: 'info', balance_late: 'danger', paid: 'ok' };
const TASK_TONE: Record<string, Tone> = { open: 'info', in_progress: 'warn', done: 'ok', cancelled: 'neutral' };
const PO_TONE: Record<string, Tone> = { draft: 'neutral', ordered: 'info', partial: 'warn', received: 'ok', cancelled: 'neutral' };

const MAPS = {
  sales: [SALES_STATUS, SALES_TONE], menu: [MENU_STATUS, MENU_TONE], lifecycle: [LIFECYCLE, LIFE_TONE], intake: [INTAKE_STATUS, INTAKE_TONE],
  payment: [PAYMENT_STATUS, PAY_TONE], task: [TASK_STATUS, TASK_TONE], po: [PO_STATUS, PO_TONE],
} as const;

export function StatusPill({ kind, value, prefix }: { kind: keyof typeof MAPS; value: string | null | undefined; prefix?: string }) {
  if (!value) return null;
  const [labels, tones] = MAPS[kind] as unknown as readonly [Record<string, string>, Record<string, Tone>];
  return <Badge tone={tones[value] ?? 'neutral'} dot>{prefix ? `${prefix}: ` : ''}{labels[value] ?? value}</Badge>;
}

export function Progress({ pct, label, size = 'md' }: { pct: number; label?: string; size?: 'sm' | 'md' }) {
  const tone = pct >= 100 ? 'var(--color-ok)' : pct >= 60 ? 'var(--color-brand)' : pct >= 30 ? 'var(--color-warn)' : 'var(--color-danger)';
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className={clsx('flex-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]', size === 'sm' ? 'h-1.5' : 'h-2')}
        role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label ?? `מוכנות ${pct}%`}>
        <div className="h-full rounded-full transition-[width]" style={{ width: `${Math.max(3, pct)}%`, background: tone }} />
      </div>
      {label && <span className="shrink-0 text-xs text-[var(--color-ink-2)]">{label}</span>}
    </div>
  );
}
