import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api, qs } from '../../lib/api.ts';
import { useAuth } from '../../lib/auth.tsx';
import { useUrlState } from '../../lib/useUrlState.ts';
import { Card, EmptyState, PageHeader, QueryView } from '../../ui/layout.tsx';
import { LinkButton } from '../../ui/Button.tsx';
import { Badge, VenueTag } from '../../ui/Badge.tsx';
import { Input } from '../../ui/form.tsx';
import { EVENT_TYPES, SALES_STATUS, type VenueCode } from '@shared/domain.ts';
import { addDays, formatDay, today } from '@shared/dates.ts';
import { formatMoney } from '@shared/money.ts';
import type { EventListItem } from '@shared/types.ts';

const COLUMNS = ['lead', 'quoted', 'tour', 'signed'] as const;

export function PipelinePage() {
  const auth = useAuth();
  const q = useQuery({ queryKey: ['pipeline'], queryFn: () => api.get<EventListItem[]>('/sales/pipeline') });
  return (
    <div>
      <PageHeader title="מכירות ישירות" subtitle="יקב ואירועי חוץ: מפנייה ועד חתימת חוזה. חוזים שנחתמו ב-30 הימים האחרונים מוצגים בעמודה האחרונה."
        actions={<>
          {auth.can('reports', 1) && <LinkButton to="/reports">דוח המרה לפי מקור</LinkButton>}
          {auth.can('sales', 2) && <LinkButton to="/events/new" variant="primary" icon={<Plus className="size-4" />}>פנייה חדשה</LinkButton>}
        </>} />
      <QueryView q={q} rows={6}>
        {(list) => (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {COLUMNS.map((col) => {
              const items = list.filter((e) => e.salesStatus === col);
              return (
                <section key={col} aria-labelledby={`col-${col}`} className="rounded-[14px] bg-[var(--color-surface-2)] p-2.5">
                  <h2 id={`col-${col}`} className="mb-2 flex items-center justify-between px-1 text-sm font-bold">{SALES_STATUS[col]}<Badge>{items.length}</Badge></h2>
                  <ul className="space-y-2">
                    {items.map((e) => (
                      <li key={e.id}>
                        <Link to={`/events/${e.id}/sales`} className="card block p-3 hover:border-[var(--color-brand)]">
                          <div className="font-semibold">{e.clientName ?? e.title}</div>
                          <div className="mt-0.5 text-xs text-[var(--color-ink-2)]">{EVENT_TYPES[e.eventType]} · {e.guests} אורחים</div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                            <VenueTag venue={e.venue} />
                            <span className="text-[var(--color-muted)]">{formatDay(e.date)}</span>
                            {e.openTasks > 0 && <Badge tone="info">{e.openTasks} משימות</Badge>}
                          </div>
                        </Link>
                      </li>
                    ))}
                    {!items.length && <li className="px-2 py-4 text-center text-xs text-[var(--color-muted)]">אין</li>}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </QueryView>
    </div>
  );
}

interface Conversion {
  cells: { key: string; source: string; venue: VenueCode; leads: number; signed: number; lost: number; open: number; revenue: number | null; ids: number[]; signedIds: number[] }[];
  campaigns: { campaign: string; leads: number; signed: number; ids: number[] }[];
}

export function ConversionReportPage() {
  const [s, set] = useUrlState({ from: addDays(today(), -180), to: today() });
  const q = useQuery({ queryKey: ['conversion', s], queryFn: () => api.get<Conversion>(`/sales/conversion${qs(s)}`) });
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
  return (
    <div>
      <PageHeader title="המרה לפי מקור ונקודה" subtitle="לפי מועד קליטת הפנייה. לחיצה על מספר מציגה את הפניות שמרכיבות אותו." />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="text-sm font-semibold">מתאריך<Input type="date" value={s.from} onChange={(e) => set({ from: e.target.value })} className="mt-1 w-44" /></label>
        <label className="text-sm font-semibold">עד<Input type="date" value={s.to} onChange={(e) => set({ to: e.target.value })} className="mt-1 w-44" /></label>
      </div>
      <QueryView q={q} empty={(d) => (d.cells.length ? null : <Card><EmptyState title="אין פניות בטווח" /></Card>)}>
        {(d) => {
          const tot = d.cells.reduce((t, c) => ({ leads: t.leads + c.leads, signed: t.signed + c.signed, revenue: t.revenue + (c.revenue ?? 0) }), { leads: 0, signed: 0, revenue: 0 });
          return (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="card p-4"><div className="text-xs font-semibold text-[var(--color-muted)]">פניות</div><div className="num text-2xl font-extrabold">{tot.leads}</div></div>
                <div className="card p-4"><div className="text-xs font-semibold text-[var(--color-muted)]">נסגרו</div><div className="num text-2xl font-extrabold">{tot.signed} <span className="text-base text-[var(--color-muted)]">({pct(tot.signed, tot.leads)})</span></div></div>
                {d.cells[0]?.revenue !== null && <div className="card p-4"><div className="text-xs font-semibold text-[var(--color-muted)]">היקף חוזים</div><div className="num text-2xl font-extrabold">{formatMoney(tot.revenue)}</div></div>}
              </div>
              <Card title="לפי מקור × נקודה" bodyClass="p-0">
                <table className="table">
                  <thead><tr><th>מקור</th><th>נקודה</th><th className="text-end">פניות</th><th className="text-end">פתוחות</th><th className="text-end">נסגרו</th><th className="text-end">לא נסגרו</th><th className="text-end">המרה</th>{d.cells[0]?.revenue !== null && <th className="text-end">היקף</th>}</tr></thead>
                  <tbody>
                    {d.cells.map((c) => (
                      <tr key={c.key}>
                        <td className="font-semibold">{c.source}</td>
                        <td><VenueTag venue={c.venue} /></td>
                        <td className="num text-end"><Link className="font-semibold text-[var(--color-brand)] underline" to={`/events?ids=${c.ids.join(',')}&label=${encodeURIComponent(`פניות מ${c.source}`)}`}>{c.leads}</Link></td>
                        <td className="num text-end">{c.open}</td>
                        <td className="num text-end">{c.signed ? <Link className="font-semibold text-[var(--color-brand)] underline" to={`/events?ids=${c.signedIds.join(',')}&label=${encodeURIComponent(`נסגרו מ${c.source}`)}`}>{c.signed}</Link> : 0}</td>
                        <td className="num text-end">{c.lost}</td>
                        <td className="num text-end font-bold">{pct(c.signed, c.leads)}</td>
                        {c.revenue !== null && <td className="num text-end">{formatMoney(c.revenue)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
              {d.campaigns.length > 0 && (
                <Card title="לפי קמפיין" bodyClass="p-0">
                  <table className="table">
                    <thead><tr><th>קמפיין</th><th className="text-end">פניות</th><th className="text-end">נסגרו</th><th className="text-end">המרה</th></tr></thead>
                    <tbody>{d.campaigns.map((c) => <tr key={c.campaign}><td className="font-semibold">{c.campaign}</td><td className="num text-end"><Link className="text-[var(--color-brand)] underline" to={`/events?ids=${c.ids.join(',')}`}>{c.leads}</Link></td><td className="num text-end">{c.signed}</td><td className="num text-end">{pct(c.signed, c.leads)}</td></tr>)}</tbody>
                  </table>
                </Card>
              )}
            </div>
          );
        }}
      </QueryView>
    </div>
  );
}
