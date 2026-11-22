/** Profitability across events and supplier invoices (payables). Management and the accountant only. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Banknote, AlertTriangle } from 'lucide-react';
import { api, qs } from '../../lib/api.ts';
import { useAction } from '../../lib/query.ts';
import { useUrlState } from '../../lib/useUrlState.ts';
import { Card, EmptyState, QueryView } from '../../ui/layout.tsx';
import { Button } from '../../ui/Button.tsx';
import { Badge, VenueTag } from '../../ui/Badge.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import { Segmented } from '../../ui/Tabs.tsx';
import { Field, FormError, Input, MoneyInput, Select, Textarea } from '../../ui/form.tsx';
import { formatMoney } from '@shared/money.ts';
import { useSettings } from '../../lib/settings.ts';
import { addDays, formatDay, today } from '@shared/dates.ts';
import type { VenueCode } from '@shared/domain.ts';
import type { SupplierRecord } from '@shared/types.ts';

interface ProfitRow {
  eventId: number; title: string; clientName: string | null; venue: VenueCode; date: string; guests: number; lifecycle: string;
  revenue: number | null; estimate: number; actual: number; profitEstimate: number | null; profitActual: number | null; foodPct: number | null; overTarget: boolean; unpriced: number;
}

const pct = (profit: number | null, revenue: number | null) => (profit !== null && revenue ? `${Math.round((profit / revenue) * 1000) / 10}%` : '—');

export function ProfitabilityView() {
  const [s, set] = useUrlState({ range: 'past' });
  const range = s.range === 'past' ? { from: addDays(today(), -90), to: today() } : s.range === 'next' ? { from: today(), to: addDays(today(), 90) } : { from: addDays(today(), -365), to: addDays(today(), 365) };
  const q = useQuery({ queryKey: ['finance', 'profit', range], queryFn: () => api.get<{ target: number; items: ProfitRow[]; totals: { revenue: number; actual: number; profit: number } }>(`/finance/profitability${qs(range)}`) });
  return (
    <div className="space-y-4">
      <Segmented label="טווח" value={s.range} onChange={(v) => set({ range: v })} options={[{ value: 'past', label: '90 הימים האחרונים' }, { value: 'next', label: '90 הימים הבאים' }, { value: 'year', label: 'שנה לכל כיוון' }]} />
      <QueryView q={q}>
        {(d) => (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="card p-4"><div className="text-xs font-semibold text-[var(--color-muted)]">הכנסות</div><div className="num text-2xl font-extrabold">{formatMoney(d.totals.revenue)}</div></div>
              <div className="card p-4"><div className="text-xs font-semibold text-[var(--color-muted)]">עלויות</div><div className="num text-2xl font-extrabold">{formatMoney(d.totals.actual)}</div></div>
              <div className="card p-4"><div className="text-xs font-semibold text-[var(--color-muted)]">רווח ({pct(d.totals.profit, d.totals.revenue)})</div><div className={`num text-2xl font-extrabold ${d.totals.profit < 0 ? 'text-[var(--color-danger)]' : ''}`}>{formatMoney(d.totals.profit)}</div></div>
            </div>
            <Card bodyClass="p-0">
              {!d.items.length ? <EmptyState title="אין אירועים סגורים בטווח" /> : (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead><tr><th>אירוע</th><th>תאריך</th><th>נקודה</th><th className="text-end">אורחים</th><th className="text-end">הכנסה</th><th className="text-end">עלות</th><th className="text-end">רווח</th><th className="text-end">%</th><th>עלות מזון</th></tr></thead>
                    <tbody>
                      {d.items.map((i) => (
                        <tr key={i.eventId}>
                          <td className="min-w-44"><Link to={`/events/${i.eventId}/payments`} className="font-semibold hover:underline">{i.title}</Link><div className="text-xs text-[var(--color-muted)]">{i.clientName}</div></td>
                          <td className="whitespace-nowrap">{formatDay(i.date)}</td>
                          <td><VenueTag venue={i.venue} /></td>
                          <td className="num text-end">{i.guests}</td>
                          <td className="num text-end">{formatMoney(i.revenue)}</td>
                          <td className="num text-end">{formatMoney(i.actual)}{i.unpriced > 0 && <span title={`${i.unpriced} פריטים ללא מחיר`}><AlertTriangle className="ms-1 inline size-3.5 text-[var(--color-warn)]" aria-label="חסרים מחירים" /></span>}</td>
                          <td className={`num text-end font-bold ${(i.profitActual ?? 0) < 0 ? 'text-[var(--color-danger)]' : ''}`}>{formatMoney(i.profitActual)}</td>
                          <td className="num text-end">{pct(i.profitActual, i.revenue)}</td>
                          <td>{i.foodPct === null ? '—' : <Badge tone={i.overTarget ? 'warn' : 'ok'}>{i.foodPct}%{i.overTarget ? ' · מעל היעד' : ''}</Badge>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            <p className="text-xs text-[var(--color-muted)]">יעד עלות מזון: {d.target}% מההכנסה (בהגדרות). עלות לפי קליטות רכש לאירוע; כשאין עדיין קליטות – לפי התכנון.</p>
          </>
        )}
      </QueryView>
    </div>
  );
}

interface Payable { id: number; supplierId: number; supplierName: string; poId: number | null; number: string; date: string; dueDate: string; amount: number; paid: number; balance: number; status: string; overdue: boolean; notes: string; version: number }
const STATUS: Record<string, string> = { open: 'פתוחה', partial: 'שולמה חלקית', paid: 'שולמה', cancelled: 'בוטלה' };

export function PayablesView() {
  const [s, set] = useUrlState({ pstatus: 'open' });
  const q = useQuery({ queryKey: ['finance', 'payables', s.pstatus], queryFn: () => api.get<{ items: Payable[]; totals: { balance: number; overdue: number } }>(`/finance/payables${qs({ status: s.pstatus })}`) });
  const [add, setAdd] = useState(false);
  const [pay, setPay] = useState<Payable | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="מצב" value={s.pstatus} onChange={(v) => set({ pstatus: v })} options={[{ value: 'open', label: 'פתוחות' }, { value: 'paid', label: 'שולמו' }, { value: 'all', label: 'הכול' }]} />
        <Button className="ms-auto" variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdd(true)}>חשבונית ספק</Button>
      </div>
      <QueryView q={q}>
        {(d) => (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="card p-4"><div className="text-xs font-semibold text-[var(--color-muted)]">לתשלום לספקים</div><div className="num text-2xl font-extrabold">{formatMoney(d.totals.balance)}</div></div>
              <div className="card p-4"><div className="text-xs font-semibold text-[var(--color-muted)]">עבר מועד התשלום</div><div className="num text-2xl font-extrabold text-[var(--color-danger)]">{formatMoney(d.totals.overdue)}</div></div>
            </div>
            <Card bodyClass="p-0">
              {!d.items.length ? <EmptyState title="אין חשבוניות בתצוגה" /> : (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead><tr><th>ספק</th><th>מס׳ חשבונית</th><th>תאריך</th><th>לתשלום עד</th><th className="text-end">סכום</th><th className="text-end">שולם</th><th className="text-end">יתרה</th><th>מצב</th><th /></tr></thead>
                    <tbody>
                      {d.items.map((i) => (
                        <tr key={i.id}>
                          <td className="font-semibold">{i.supplierName}{i.poId && <Link to={`/purchasing/${i.poId}`} className="block text-xs font-normal text-[var(--color-brand)] hover:underline">הזמנה #{i.poId}</Link>}</td>
                          <td>{i.number || '—'}</td>
                          <td className="whitespace-nowrap">{formatDay(i.date)}</td>
                          <td className={`whitespace-nowrap ${i.overdue ? 'font-semibold text-[var(--color-danger)]' : ''}`}>{formatDay(i.dueDate)}</td>
                          <td className="num text-end">{formatMoney(i.amount)}</td>
                          <td className="num text-end">{formatMoney(i.paid)}</td>
                          <td className="num text-end font-bold">{formatMoney(i.balance)}</td>
                          <td>{i.overdue ? <Badge tone="danger">באיחור</Badge> : <Badge tone={i.status === 'paid' ? 'ok' : 'info'}>{STATUS[i.status]}</Badge>}</td>
                          <td>{(i.status === 'open' || i.status === 'partial') && <Button size="sm" variant="primary" icon={<Banknote className="size-3.5" />} onClick={() => setPay(i)}>רישום תשלום</Button>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </QueryView>
      {add && <NewPayableDialog onClose={() => setAdd(false)} />}
      {pay && <PayDialog p={pay} onClose={() => setPay(null)} />}
    </div>
  );
}

function NewPayableDialog({ onClose }: { onClose: () => void }) {
  const suppliers = useQuery({ queryKey: ['purchasing', 'suppliers'], queryFn: () => api.get<SupplierRecord[]>('/purchasing/suppliers') });
  const [supplierId, setSupplierId] = useState('');
  const [number, setNumber] = useState('');
  const [date, setDate] = useState(today());
  const terms = useSettings().formDefaults.payableTermsDays;
  const [dueDate, setDueDate] = useState(addDays(today(), terms));
  const [amount, setAmount] = useState<number | null>(null);
  const [poId, setPoId] = useState('');
  const [notes, setNotes] = useState('');
  // Payment terms run from the invoice date.
  const setInvoiceDate = (v: string) => { setDate(v); if (/^\d{4}-\d{2}-\d{2}$/.test(v)) setDueDate(addDays(v, terms)); };
  const save = useAction(() => api.post('/finance/payables', { supplierId: Number(supplierId) || 0, number, date, dueDate, amount: amount ?? 0, poId: Number(poId) || null, notes }),
    { success: 'החשבונית נרשמה', invalidate: [['finance']], onSuccess: onClose });
  const f = save.error?.fields ?? {};
  return (
    <Dialog open onClose={onClose} title="חשבונית ספק" footer={<><Button onClick={onClose}>ביטול</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>שמירה</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><FormError message={save.error?.message} /></div>
        <Field label="ספק" required error={f.supplierId} className="sm:col-span-2">{(x) => <Select {...x} data-autofocus value={supplierId} onChange={(e) => setSupplierId(e.target.value)} placeholder="בחירה" options={(suppliers.data ?? []).filter((s) => s.active).map((s) => ({ value: s.id, label: s.name }))} />}</Field>
        <Field label="מס׳ חשבונית" error={f.number}>{(x) => <Input {...x} value={number} onChange={(e) => setNumber(e.target.value)} />}</Field>
        <Field label="סכום כולל" required error={f.amount}>{(x) => <MoneyInput {...x} value={amount} onChange={setAmount} />}</Field>
        <Field label="תאריך חשבונית" required error={f.date}>{(x) => <Input {...x} type="date" value={date} onChange={(e) => setInvoiceDate(e.target.value)} />}</Field>
        <Field label="לתשלום עד" hint={`ברירת מחדל: שוטף + ${terms} (בהגדרות)`} required error={f.dueDate}>{(x) => <Input {...x} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}</Field>
        <Field label="מס׳ הזמנת רכש (לא חובה)" error={f.poId}>{(x) => <Input {...x} inputMode="numeric" value={poId} onChange={(e) => setPoId(e.target.value.replace(/\D/g, ''))} />}</Field>
        <Field label="הערות" className="sm:col-span-2">{(x) => <Textarea {...x} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}

function PayDialog({ p, onClose }: { p: Payable; onClose: () => void }) {
  const [amount, setAmount] = useState<number | null>(p.balance);
  const [date, setDate] = useState(today());
  const save = useAction(() => api.post(`/finance/payables/${p.id}/pay`, { amount: amount ?? 0, date }), { success: 'התשלום נרשם', invalidate: [['finance']], onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} title={`תשלום לספק – ${p.supplierName}`} size="sm" footer={<><Button onClick={onClose}>ביטול</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>רישום</Button></>}>
      <div className="space-y-3">
        <FormError message={save.error?.message} />
        <Field label="סכום" hint={`יתרה: ${formatMoney(p.balance)}`} error={save.error?.fields.amount}>{(x) => <MoneyInput {...x} value={amount} onChange={setAmount} />}</Field>
        <Field label="תאריך תשלום">{(x) => <Input {...x} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}
