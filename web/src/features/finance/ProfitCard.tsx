/** Event profitability: estimate (from the plan) vs. actual (purchases, staff who came, costs entered by hand). */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2, AlertTriangle } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { useAction } from '../../lib/query.ts';
import { Card, QueryView } from '../../ui/layout.tsx';
import { Button } from '../../ui/Button.tsx';
import { Badge } from '../../ui/Badge.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import { Field, FormError, Input, MoneyInput, Select, optionsOf } from '../../ui/form.tsx';
import { COST_CATEGORY, type CostBreakdown, type CostCategory } from '@shared/costing.ts';
import { formatMoney } from '@shared/money.ts';

interface Costs extends CostBreakdown {
  food: { itemId: number; itemName: string; unit: string; qty: number; unitCost: number; cost: number }[];
  manual: { id: number; category: CostCategory; label: string; amount: number; note: string; createdByName: string | null }[];
  targetPct: number;
}

export function ProfitCard({ eventId, canEdit }: { eventId: number; canEdit: boolean }) {
  const q = useQuery({ queryKey: ['finance', 'costs', eventId], queryFn: () => api.get<Costs>(`/finance/events/${eventId}/costs`) });
  const [add, setAdd] = useState(false);
  const [showFood, setShowFood] = useState(false);
  const del = useAction((id: number) => api.del(`/finance/events/${eventId}/costs/${id}`), { success: 'העלות נמחקה', invalidate: [['finance']] });
  return (
    <Card title="רווחיות האירוע" actions={<>
      <Badge>פנימי – הנהלה בלבד</Badge>
      {canEdit && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setAdd(true)}>עלות נוספת</Button>}
    </>}>
      <QueryView q={q}>
        {(k) => (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label="הכנסה (חוזה / הצעה)" value={formatMoney(k.revenue)} />
              <Stat label="עלות משוערת" value={formatMoney(k.estimate.total)} />
              <Stat label="רווח משוער" value={formatMoney(k.profitEstimate)} tone={k.profitEstimate !== null && k.profitEstimate < 0 ? 'danger' : undefined} />
              <Stat label="רווח בפועל" value={formatMoney(k.profitActual)} tone={k.profitActual !== null && k.profitActual < 0 ? 'danger' : undefined}
                hint={k.foodPct !== null ? `עלות מזון ${k.foodPct}% מההכנסה (יעד ${k.targetPct}%)` : undefined} warn={k.foodPct !== null && k.foodPct > k.targetPct} />
            </div>
            {k.unpriced > 0 && (
              <p className="flex items-center gap-2 rounded-[10px] bg-[var(--color-warn-soft)] px-3 py-2 text-sm text-[var(--color-warn)]">
                <AlertTriangle className="size-4 shrink-0" />ל-{k.unpriced} חומרי גלם בתפריט אין מחיר – העלות המשוערת נמוכה מהאמת. מחירים מתעדכנים מהזמנות הרכש או בקטלוג.
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>רכיב</th><th className="text-end">משוער</th><th className="text-end">בפועל</th></tr></thead>
                <tbody>
                  {(Object.keys(COST_CATEGORY) as CostCategory[]).map((c) => (
                    <tr key={c}><td className="font-semibold">{COST_CATEGORY[c]}</td><td className="num text-end">{formatMoney(k.estimate[c])}</td><td className="num text-end">{formatMoney(k.actual[c])}</td></tr>
                  ))}
                  <tr className="font-bold"><td>סה״כ</td><td className="num text-end">{formatMoney(k.estimate.total)}</td><td className="num text-end">{formatMoney(k.actual.total)}</td></tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-[var(--color-muted)]">משוער: תפריט × מתכון × מחיר פריט, שורות ציוד, תקן צוות × עלות משמרת (בהגדרות). בפועל: קליטות רכש לאירוע, עובדים שהגיעו, ועלויות שהוזנו ידנית.</p>
            {k.manual.length > 0 && (
              <div>
                <h3 className="mb-1 text-sm font-bold">עלויות שהוזנו ידנית</h3>
                <ul className="divide-y divide-[var(--color-border)] text-sm">
                  {k.manual.map((m) => (
                    <li key={m.id} className="flex items-center gap-2 py-1.5">
                      <Badge>{COST_CATEGORY[m.category]}</Badge><span className="flex-1">{m.label}{m.note ? ` · ${m.note}` : ''}</span>
                      <span className="num font-semibold">{formatMoney(m.amount)}</span>
                      {canEdit && <Button size="sm" variant="ghost" aria-label={`מחיקת ${m.label}`} loading={del.isPending && del.variables === m.id} onClick={() => del.mutate(m.id)}><Trash2 className="size-3.5" /></Button>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {k.food.length > 0 && (
              <div>
                <button type="button" className="text-sm font-semibold text-[var(--color-brand)] hover:underline" onClick={() => setShowFood((x) => !x)}>{showFood ? 'הסתרת' : 'פירוט'} עלות חומרי הגלם ({k.food.length})</button>
                {showFood && (
                  <table className="table mt-2">
                    <thead><tr><th>פריט</th><th className="text-end">כמות</th><th className="text-end">מחיר ליחידה</th><th className="text-end">עלות</th></tr></thead>
                    <tbody>{k.food.map((f) => (
                      <tr key={f.itemId}><td>{f.itemName}</td><td className="num text-end">{f.qty} {f.unit}</td><td className="num text-end">{f.unitCost ? formatMoney(f.unitCost) : <Badge tone="warn">חסר מחיר</Badge>}</td><td className="num text-end">{formatMoney(f.cost)}</td></tr>
                    ))}</tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        )}
      </QueryView>
      {add && <AddCostDialog eventId={eventId} onClose={() => setAdd(false)} />}
    </Card>
  );
}

function Stat({ label, value, tone, hint, warn }: { label: string; value: string; tone?: 'danger'; hint?: string; warn?: boolean }) {
  return (
    <div className="rounded-[12px] bg-[var(--color-surface-2)] p-3">
      <div className="text-xs font-semibold text-[var(--color-muted)]">{label}</div>
      <div className={`num text-xl font-extrabold ${tone === 'danger' ? 'text-[var(--color-danger)]' : ''}`}>{value}</div>
      {hint && <div className={`text-xs ${warn ? 'font-semibold text-[var(--color-warn)]' : 'text-[var(--color-muted)]'}`}>{hint}</div>}
    </div>
  );
}

function AddCostDialog({ eventId, onClose }: { eventId: number; onClose: () => void }) {
  const [category, setCategory] = useState<CostCategory>('transport');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const save = useAction(() => api.post(`/finance/events/${eventId}/costs`, { category, label, amount: amount ?? 0, note }), { success: 'העלות נוספה', invalidate: [['finance']], onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} title="עלות נוספת לאירוע" size="sm" footer={<><Button onClick={onClose}>ביטול</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>הוספה</Button></>}>
      <div className="space-y-3">
        <FormError message={save.error?.message} />
        <Field label="סוג">{(x) => <Select {...x} value={category} onChange={(e) => setCategory(e.target.value as CostCategory)} options={optionsOf(COST_CATEGORY)} />}</Field>
        <Field label="תיאור" required error={save.error?.fields.label}>{(x) => <Input {...x} data-autofocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="למשל: שכירות רכב קירור חלופי" />}</Field>
        <Field label="סכום" required error={save.error?.fields.amount}>{(x) => <MoneyInput {...x} value={amount} onChange={setAmount} />}</Field>
        <Field label="הערה">{(x) => <Input {...x} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}
