import { Plus, Inbox, X } from 'lucide-react';
import { useAuth, canHallIntake } from '../../lib/auth.tsx';
import { navFor } from '@shared/navigation.ts';
import { useUrlState } from '../../lib/useUrlState.ts';
import { Card, EmptyState, PageHeader, QueryView } from '../../ui/layout.tsx';
import { LinkButton } from '../../ui/Button.tsx';
import { Input, Select, optionsOf } from '../../ui/form.tsx';
import { Segmented } from '../../ui/Tabs.tsx';
import { EventsTable, EventCard, useEventList } from './shared.tsx';
import { VENUE_LABEL, MENU_STATUS, WORK_STAGES, WORK_STAGE_ORDER } from '@shared/domain.ts';
import { ExportButton } from '../process/ProcessPages.tsx';
import { addDays, today } from '@shared/dates.ts';

const RANGES: Record<string, { label: string; from?: string; to?: string; order?: string; lifecycle?: string }> = {
  upcoming: { label: 'קרובים', from: today(), to: addDays(today(), 120) },
  week: { label: 'השבוע', from: today(), to: addDays(today(), 7) },
  past: { label: 'עברו', from: addDays(today(), -365), to: addDays(today(), -1), order: 'desc' },
  closing: { label: 'בסגירה', lifecycle: 'completed', order: 'desc' },
  all: { label: 'הכול' },
};

export function EventsListPage() {
  const auth = useAuth();
  const [s, set] = useUrlState({ range: 'upcoming', venue: '', q: '', menu: '', mine: '', readiness: '', ids: '', label: '', view: 'table', stage: '', blocked: '' });
  const r = RANGES[s.range] ?? RANGES.upcoming;
  const params = s.ids
    ? { ids: s.ids }
    : { from: r.from, to: r.to, order: r.order, lifecycle: r.lifecycle, venue: s.venue || undefined, q: s.q || undefined, menu: s.menu || undefined, mine: s.mine || undefined, readiness: s.readiness || undefined, stage: s.stage || undefined, blocked: s.blocked || undefined };
  const q = useEventList(params);
  const showPayment = auth.can('finance', 1);

  return (
    <div>
      <PageHeader title="אירועים" subtitle="כל האירועים בכל הנקודות לפי הרשאה. סינון נשמר בכתובת – חזרה מהכרטיס תשאיר אותך באותו מקום."
        actions={<>
          <ExportButton kind="events" />
          {navFor(auth.me.grants).has('sales') && auth.can('sales', 2) && <LinkButton to="/events/new" variant="primary" icon={<Plus className="size-4" />}>פנייה חדשה</LinkButton>}
          {navFor(auth.me.grants).has('intake') && canHallIntake(auth) && <LinkButton to="/intake" icon={<Inbox className="size-4" />}>קליטה מאולם</LinkButton>}
        </>} />
      {s.ids ? (
        <div className="mb-4 flex items-center gap-2 rounded-[10px] bg-[var(--color-brand-soft)] px-3 py-2 text-sm">
          <span className="font-semibold">{s.label || 'אירועים נבחרים'}</span>
          <button onClick={() => set({ ids: '', label: '' })} className="ms-auto inline-flex items-center gap-1 font-semibold text-[var(--color-brand-strong)]"><X className="size-4" />ניקוי</button>
        </div>
      ) : (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Segmented label="טווח" value={s.range} onChange={(v) => set({ range: v })} options={Object.entries(RANGES).map(([value, x]) => ({ value, label: x.label }))} />
          <Input aria-label="חיפוש" placeholder="חיפוש לקוח, טלפון, אירוע…" value={s.q} onChange={(e) => set({ q: e.target.value })} className="w-60" />
          <Select aria-label="נקודה" value={s.venue} onChange={(e) => set({ venue: e.target.value })} placeholder="כל הנקודות" options={optionsOf(VENUE_LABEL)} className="w-40" />
          <Select aria-label="מצב תפריט" value={s.menu} onChange={(e) => set({ menu: e.target.value })} placeholder="כל מצבי התפריט" options={optionsOf(MENU_STATUS)} className="w-48" />
          <Select aria-label="שלב בתהליך" value={s.stage} onChange={(e) => set({ stage: e.target.value })} placeholder="כל השלבים" options={WORK_STAGE_ORDER.map((x) => ({ value: x, label: `${WORK_STAGES[x].n}. ${WORK_STAGES[x].label}` }))} className="w-48" />
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" className="size-4 accent-[var(--color-brand)]" checked={s.blocked === '1'} onChange={(e) => set({ blocked: e.target.checked ? '1' : '' })} />
            עם חסימות
          </label>
          <Select aria-label="מוכנות" value={s.readiness} onChange={(e) => set({ readiness: e.target.value })} placeholder="כל רמות המוכנות" options={[{ value: 'incomplete', label: 'לא מוכנים' }]} className="w-40" />
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" className="size-4 accent-[var(--color-brand)]" checked={s.mine === '1'} onChange={(e) => set({ mine: e.target.checked ? '1' : '' })} />
            באחריותי
          </label>
          <div className="ms-auto hidden md:block">
            <Segmented label="תצוגה" value={s.view} onChange={(v) => set({ view: v })} options={[{ value: 'table', label: 'טבלה' }, { value: 'cards', label: 'כרטיסים' }]} />
          </div>
        </div>
      )}
      <QueryView q={q} rows={8} empty={(d) => (d.length ? null : <Card><EmptyState title="לא נמצאו אירועים" text="נסה לשנות את הסינון או את טווח התאריכים." /></Card>)}>
        {(d) => (
          <>
            <p className="mb-2 text-sm text-[var(--color-muted)]" role="status">{d.length} אירועים · {d.reduce((s2, e) => s2 + e.guests, 0).toLocaleString('he-IL')} אורחים</p>
            <div className={s.view === 'cards' ? 'hidden' : 'hidden md:block'}><Card bodyClass="p-0">{<EventsTable items={d} showPayment={showPayment} />}</Card></div>
            <div className={s.view === 'cards' ? 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3' : 'grid gap-3 sm:grid-cols-2 md:hidden'}>{d.map((e) => <EventCard key={e.id} e={e} />)}</div>
          </>
        )}
      </QueryView>
    </div>
  );
}
