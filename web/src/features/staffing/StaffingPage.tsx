/**
 * Staffing across events by day: how many waiters, cooks, bartenders… each day needs and how many are booked.
 * The booking itself stays in Ubeya; this is the overview for planning and for spotting gaps.
 */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../../lib/api.ts';
import { useUrlState } from '../../lib/useUrlState.ts';
import { Card, EmptyState, PageHeader, QueryView } from '../../ui/layout.tsx';
import { Badge, VenueTag } from '../../ui/Badge.tsx';
import { Segmented } from '../../ui/Tabs.tsx';
import { STAFF_ROLES, type StaffRole, type VenueCode } from '@shared/domain.ts';
import { addDays, formatLongDay, today } from '@shared/dates.ts';

interface Day {
  date: string;
  totals: Record<StaffRole, { required: number; assigned: number }>;
  events: { id: number; title: string; venue: VenueCode; startTime: string; guests: number; ubeyaRef: string; lines: Partial<Record<StaffRole, { required: number; assigned: number }>>; missing: number; planned: boolean }[];
}

function Cell({ v }: { v?: { required: number; assigned: number } }) {
  if (!v || !v.required) return <span className="text-[var(--color-muted)]">—</span>;
  const short = v.required - v.assigned;
  return <span className={`num ${short > 0 ? 'font-bold text-[var(--color-danger)]' : ''}`}>{v.assigned}/{v.required}</span>;
}

export function StaffingPage() {
  const [s, set] = useUrlState({ days: '14' });
  const from = today();
  const to = addDays(from, Number(s.days) - 1);
  const q = useQuery({ queryKey: ['staffing', 'by-day', from, to], queryFn: () => api.get<{ roles: StaffRole[]; days: Day[] }>(`/ops/staffing${qs({ from, to })}`) });
  return (
    <div>
      <PageHeader title="כוח אדם לפי יום" subtitle="כמה עובדים נדרשים בכל יום מכל האירועים יחד, וכמה כבר שובצו. השיבוץ עצמו נשאר ב-Ubeya – כאן רואים את התמונה ואת החוסרים." />
      <div className="mb-4"><Segmented label="טווח" value={s.days} onChange={(v) => set({ days: v })} options={[{ value: '7', label: 'שבוע' }, { value: '14', label: 'שבועיים' }, { value: '30', label: 'חודש' }]} /></div>
      <QueryView q={q} empty={(d) => (d.days.length ? null : <Card><EmptyState title="אין אירועים עם צוות בטווח" /></Card>)}>
        {(d) => (
          <div className="space-y-4">
            {d.days.map((day) => {
              const missing = day.events.reduce((a, e) => a + e.missing, 0);
              return (
                <Card key={day.date} bodyClass="p-0" title={<span>{formatLongDay(day.date)} <span className="text-sm font-normal text-[var(--color-muted)]">· {day.events.length} אירועים</span></span>}
                  actions={missing > 0 ? <Badge tone="danger">חסרים {missing} עובדים</Badge> : day.events.some((e) => !e.planned) ? <Badge tone="warn">יש אירוע ללא תקן</Badge> : <Badge tone="ok">מאויש</Badge>}>
                  <div className="overflow-x-auto">
                    <table className="table">
                      <thead><tr><th>אירוע</th><th className="text-end">אורחים</th>{d.roles.map((r) => <th key={r} className="text-end">{STAFF_ROLES[r]}</th>)}<th>Ubeya</th></tr></thead>
                      <tbody>
                        {day.events.map((e) => (
                          <tr key={e.id}>
                            <td><Link to={`/events/${e.id}/staff`} className="font-semibold hover:underline">{e.title}</Link><div className="flex items-center gap-1.5 text-xs text-[var(--color-muted)]"><VenueTag venue={e.venue} />{e.startTime}</div></td>
                            <td className="num text-end">{e.guests}</td>
                            {d.roles.map((r) => <td key={r} className="text-end"><Cell v={e.lines[r]} /></td>)}
                            <td className="text-sm">{e.ubeyaRef || (e.planned ? <Badge tone="warn">ללא מזהה</Badge> : <Badge tone="warn">אין תקן</Badge>)}</td>
                          </tr>
                        ))}
                        <tr className="bg-[var(--color-surface-2)] font-bold">
                          <td>סה״כ ליום</td><td />
                          {d.roles.map((r) => <td key={r} className="text-end"><Cell v={day.totals[r]} /></td>)}<td />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </QueryView>
    </div>
  );
}
