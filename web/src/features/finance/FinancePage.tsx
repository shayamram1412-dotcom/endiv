import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { api, qs } from '../../lib/api.ts';
import { useUrlState } from '../../lib/useUrlState.ts';
import { Card, EmptyState, PageHeader, QueryView } from '../../ui/layout.tsx';
import { StatusPill, VenueTag } from '../../ui/Badge.tsx';
import { Segmented } from '../../ui/Tabs.tsx';
import { ExportButton } from '../process/ProcessPages.tsx';
import { PAYMENT_KIND, type VenueCode, type PaymentKind, type PaymentStatus } from '@shared/domain.ts';
import { formatMoney } from '@shared/money.ts';
import { formatDay, today } from '@shared/dates.ts';
import { useAuth } from '../../lib/auth.tsx';
import { PayablesView, ProfitabilityView } from './MoreFinance.tsx';

interface Receivable {
  eventId: number; title: string; clientName: string | null; venue: VenueCode; date: string; lifecycle: string; payer: string;
  contract: number; received: number; balance: number; overdue: number; status: PaymentStatus; nextDue: { kind: PaymentKind; dueDate: string | null; open: number } | null;
}

export function FinancePage() {
  const auth = useAuth();
  const [s, set] = useUrlState({ tab: 'receivables' });
  const tabs = [{ value: 'receivables', label: 'גבייה מלקוחות' }, ...(auth.margins ? [{ value: 'profit', label: 'רווחיות אירועים' }, { value: 'payables', label: 'חשבוניות ספקים' }] : [])];
  return (
    <div>
      <PageHeader title="כספים" subtitle="גבייה, רווחיות ותשלומים לספקים. הנהלת החשבונות עצמה נשארת בתוכנה הקיימת – כאן המעקב."
        actions={s.tab === 'receivables' ? <ExportButton kind="receivables" /> : undefined} />
      {tabs.length > 1 && <div className="mb-4"><Segmented label="אזור" value={s.tab} onChange={(v) => set({ tab: v })} options={tabs} /></div>}
      {s.tab === 'profit' && auth.margins ? <ProfitabilityView /> : s.tab === 'payables' && auth.margins ? <PayablesView /> : <ReceivablesView />}
    </div>
  );
}

function ReceivablesView() {
  const [s, set] = useUrlState({ view: 'open', ids: '' });
  const q = useQuery({ queryKey: ['finance', 'receivables', s.view], queryFn: () => api.get<{ items: Receivable[]; totals: { balance: number; overdue: number; received: number } }>(`/finance/receivables${qs({ all: s.view === 'all' ? 1 : undefined })}`) });
  const ids = s.ids ? new Set(s.ids.split(',').map(Number)) : null;
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented label="תצוגה" value={s.view} onChange={(v) => set({ view: v })} options={[{ value: 'open', label: 'יתרות פתוחות' }, { value: 'late', label: 'באיחור' }, { value: 'all', label: 'הכול' }]} />
        {ids && <button onClick={() => set({ ids: '' })} className="inline-flex items-center gap-1 rounded-full bg-[var(--color-brand-soft)] px-3 py-1 text-sm font-semibold"><X className="size-4" />בחירה מהדשבורד</button>}
      </div>
      <QueryView q={q}>
        {(d) => {
          const items = d.items.filter((i) => (!ids || ids.has(i.eventId)) && (s.view !== 'late' || i.overdue > 0));
          return (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="card p-4"><div className="text-xs font-semibold text-[var(--color-muted)]">יתרה פתוחה</div><div className="num text-2xl font-extrabold">{formatMoney(d.totals.balance)}</div></div>
                <div className="card p-4"><div className="text-xs font-semibold text-[var(--color-muted)]">באיחור</div><div className="num text-2xl font-extrabold text-[var(--color-danger)]">{formatMoney(d.totals.overdue)}</div></div>
                <div className="card p-4"><div className="text-xs font-semibold text-[var(--color-muted)]">התקבל באירועים אלה</div><div className="num text-2xl font-extrabold">{formatMoney(d.totals.received)}</div></div>
              </div>
              <Card bodyClass="p-0">
                {!items.length ? <EmptyState title="אין יתרות בתצוגה" /> : (
                  <div className="overflow-x-auto">
                    <table className="table">
                      <thead><tr><th>אירוע</th><th>תאריך</th><th>נקודה</th><th>גורם משלם</th><th className="text-end">חוזה</th><th className="text-end">התקבל</th><th className="text-end">יתרה</th><th>מועד הבא</th><th>מצב</th></tr></thead>
                      <tbody>
                        {items.map((i) => (
                          <tr key={i.eventId}>
                            <td><Link to={`/events/${i.eventId}/payments`} className="font-semibold hover:underline">{i.title}</Link><div className="text-xs text-[var(--color-muted)]">{i.clientName}</div></td>
                            <td className="whitespace-nowrap">{formatDay(i.date)}</td>
                            <td><VenueTag venue={i.venue} /></td>
                            <td className="text-sm">{i.payer || 'הלקוח'}</td>
                            <td className="num text-end">{formatMoney(i.contract)}</td>
                            <td className="num text-end">{formatMoney(i.received)}</td>
                            <td className="num text-end font-bold">{formatMoney(i.balance)}</td>
                            <td className="whitespace-nowrap text-sm">{i.nextDue ? <span className={i.nextDue.dueDate && i.nextDue.dueDate < today() ? 'font-semibold text-[var(--color-danger)]' : ''}>{PAYMENT_KIND[i.nextDue.kind]} · {formatDay(i.nextDue.dueDate)}</span> : '—'}</td>
                            <td><StatusPill kind="payment" value={i.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>
          );
        }}
      </QueryView>
    </div>
  );
}
