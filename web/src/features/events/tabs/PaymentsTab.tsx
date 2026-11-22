import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Banknote, Pencil } from 'lucide-react';
import { api } from '../../../lib/api.ts';
import { useAction } from '../../../lib/query.ts';
import { Card, EmptyState, QueryView } from '../../../ui/layout.tsx';
import { Button } from '../../../ui/Button.tsx';
import { Badge, StatusPill } from '../../../ui/Badge.tsx';
import { Dialog } from '../../../ui/Dialog.tsx';
import { Field, FormError, Input, MoneyInput, Select, optionsOf } from '../../../ui/form.tsx';
import { PAYMENT_KIND } from '@shared/domain.ts';
import { formatMoney } from '@shared/money.ts';
import { formatDay, today } from '@shared/dates.ts';
import type { CollectionSummary } from '@shared/finance.ts';
import type { EventDetail, PaymentRecord } from '@shared/types.ts';
import { useAuth } from '../../../lib/auth.tsx';
import { ProfitCard } from '../../finance/ProfitCard.tsx';

export function PaymentsTab({ d }: { d: EventDetail }) {
  const ev = d.event;
  const q = useQuery({ queryKey: ['finance', 'event', ev.id], queryFn: () => api.get<{ lines: PaymentRecord[]; summary: CollectionSummary; contractTotal: number | null }>(`/finance/events/${ev.id}/payments`) });
  const canEdit = d.access.finance >= 2;
  const auth = useAuth();
  const [receive, setReceive] = useState<PaymentRecord | null>(null);
  const [edit, setEdit] = useState<PaymentRecord | 'new' | null>(null);
  const [contract, setContract] = useState<number | null>(ev.contractTotal);
  const saveContract = useAction(() => api.patch(`/events/${ev.id}`, { changes: { contractTotal: contract }, base: { contractTotal: ev.contractTotal } }), { success: 'סכום החוזה עודכן', invalidate: [['event', ev.id], ['finance']] });

  return (
    <QueryView q={q}>
      {(v) => (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-4">
            {[['סכום חוזה', v.summary.contract], ['התקבל', v.summary.received], ['יתרה', v.summary.balance], ['באיחור', v.summary.overdue]].map(([l, n], i) => (
              <div key={i} className="card p-4">
                <div className="text-xs font-semibold text-[var(--color-muted)]">{l}</div>
                <div className={`num text-xl font-extrabold ${i === 3 && (n as number) > 0 ? 'text-[var(--color-danger)]' : ''}`}>{formatMoney(n as number)}</div>
              </div>
            ))}
          </div>
          <Card title="לוח תשלומים" bodyClass="p-0" actions={<>
            <StatusPill kind="payment" value={v.summary.status} />
            {canEdit && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEdit('new')}>מועד תשלום</Button>}
          </>}>
            {!v.lines.length ? <EmptyState title="לא הוגדרו מועדי תשלום" text={ev.payer ? `גורם משלם: ${ev.payer}` : undefined} /> : (
              <table className="table">
                <thead><tr><th>סוג</th><th>מועד</th><th className="text-end">סכום</th><th className="text-end">התקבל</th><th>אסמכתא</th><th>מצב</th>{canEdit && <th />}</tr></thead>
                <tbody>
                  {v.lines.map((p) => {
                    const open = p.amount - p.received;
                    const late = open > 0 && p.dueDate && p.dueDate < today();
                    return (
                      <tr key={p.id}>
                        <td className="font-semibold">{PAYMENT_KIND[p.kind]}</td>
                        <td>{formatDay(p.dueDate)}</td>
                        <td className="num text-end">{formatMoney(p.amount)}</td>
                        <td className="num text-end">{formatMoney(p.received)}{p.receivedAt && <div className="text-xs text-[var(--color-muted)]">{formatDay(p.receivedAt)}</div>}</td>
                        <td className="text-sm">{p.reference || '—'}</td>
                        <td>{open <= 0 ? <Badge tone="ok">שולם</Badge> : late ? <Badge tone="danger">באיחור</Badge> : <Badge tone="info">פתוח</Badge>}</td>
                        {canEdit && (
                          <td className="whitespace-nowrap">
                            {open > 0 && <Button size="sm" variant="primary" icon={<Banknote className="size-3.5" />} onClick={() => setReceive(p)}>רישום תקבול</Button>}
                            <Button size="sm" variant="ghost" aria-label="עריכה" onClick={() => setEdit(p)}><Pencil className="size-3.5" /></Button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>
          {canEdit && (
            <Card title="סכום החוזה">
              <div className="flex flex-wrap items-end gap-2">
                <Field label="סכום" className="w-48">{(p) => <MoneyInput {...p} value={contract} onChange={setContract} />}</Field>
                <Button disabled={contract === ev.contractTotal} loading={saveContract.isPending} onClick={() => saveContract.mutate(undefined)}>עדכון</Button>
              </div>
              <p className="mt-2 text-xs text-[var(--color-muted)]">הרישום במערכת הנהלת החשבונות ממשיך בתהליך הקיים. כאן מתעדים את האסמכתא והמעקב.</p>
            </Card>
          )}
          {auth.margins && <ProfitCard eventId={ev.id} canEdit={canEdit} />}
          {receive && <ReceiveDialog p={receive} eventId={ev.id} onClose={() => setReceive(null)} />}
          {edit && <EditLineDialog p={edit === 'new' ? null : edit} eventId={ev.id} onClose={() => setEdit(null)} />}
        </div>
      )}
    </QueryView>
  );
}

function ReceiveDialog({ p, eventId, onClose }: { p: PaymentRecord; eventId: number; onClose: () => void }) {
  const [amount, setAmount] = useState<number | null>(p.amount - p.received);
  const [receivedAt, setReceivedAt] = useState(today());
  const [reference, setReference] = useState('');
  const save = useAction(() => api.post(`/finance/payments/${p.id}/receive`, { amount: amount ?? 0, receivedAt, reference, version: p.version }),
    { success: 'התקבול נרשם', invalidate: [['finance'], ['event', eventId], ['tasks'], ['dashboard']], onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} title={`רישום תקבול – ${PAYMENT_KIND[p.kind]}`} size="sm" footer={<><Button onClick={onClose}>ביטול</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>רישום</Button></>}>
      <div className="space-y-3">
        <FormError message={save.error?.message} />
        <Field label="סכום" hint={`יתרה בשורה: ${formatMoney(p.amount - p.received)}`} error={save.error?.fields.amount}>{(x) => <MoneyInput {...x} value={amount} onChange={setAmount} />}</Field>
        <Field label="תאריך קבלה">{(x) => <Input {...x} type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} />}</Field>
        <Field label="אסמכתא" required hint="מס׳ קבלה, העברה או שיק" error={save.error?.fields.reference}>{(x) => <Input {...x} value={reference} onChange={(e) => setReference(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}

function EditLineDialog({ p, eventId, onClose }: { p: PaymentRecord | null; eventId: number; onClose: () => void }) {
  const [kind, setKind] = useState(p?.kind ?? 'interim');
  const [amount, setAmount] = useState<number | null>(p?.amount ?? null);
  const [dueDate, setDueDate] = useState(p?.dueDate ?? '');
  const save = useAction(() => (p ? api.put(`/finance/payments/${p.id}`, { kind, amount: amount ?? 0, dueDate: dueDate || null }) : api.post(`/finance/events/${eventId}/payments`, { kind, amount: amount ?? 0, dueDate: dueDate || null })),
    { success: 'נשמר', invalidate: [['finance'], ['event', eventId]], onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} title={p ? 'עריכת מועד תשלום' : 'מועד תשלום חדש'} size="sm" footer={<><Button onClick={onClose}>ביטול</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>שמירה</Button></>}>
      <div className="space-y-3">
        <FormError message={save.error?.message} />
        <Field label="סוג">{(x) => <Select {...x} value={kind} onChange={(e) => setKind(e.target.value as never)} options={optionsOf(PAYMENT_KIND)} />}</Field>
        <Field label="סכום" error={save.error?.fields.amount}>{(x) => <MoneyInput {...x} value={amount} onChange={setAmount} />}</Field>
        <Field label="מועד">{(x) => <Input {...x} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}
