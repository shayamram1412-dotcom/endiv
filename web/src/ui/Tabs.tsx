import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import clsx from 'clsx';

export interface TabDef { to: string; label: string; badge?: ReactNode; end?: boolean }

/** Tabs that are real links (each tab has its own URL). Scrolls horizontally on phones. */
export function LinkTabs({ tabs, label }: { tabs: TabDef[]; label: string }) {
  return (
    <nav aria-label={label} className="-mx-4 mb-5 overflow-x-auto border-b border-[var(--color-border)] px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1">
        {tabs.map((t) => (
          <li key={t.to}>
            <NavLink to={t.to} end={t.end} replace
              className={({ isActive }) => clsx('relative flex h-11 items-center gap-1.5 px-3 text-sm font-semibold transition-colors',
                isActive ? 'text-[var(--color-brand-strong)] after:absolute after:inset-x-2 after:-bottom-px after:h-[3px] after:rounded-full after:bg-[var(--color-brand)]' : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]')}>
              {t.label}
              {t.badge}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Segmented control for in-page views. */
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[10px] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-0.5">
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={clsx('h-8 rounded-lg px-3 text-[13px] font-semibold transition-colors', value === o.value ? 'bg-[var(--color-brand)] text-[var(--color-on-brand)]' : 'text-[var(--color-ink-2)] hover:bg-[var(--color-surface-2)]')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
