import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ShoppingCart, PackageMinus } from 'lucide-react';
import { api } from '../../../lib/api.ts';
import { useAction } from '../../../lib/query.ts';
import { Card, EmptyState, QueryView } from '../../../ui/layout.tsx';
import { Button, LinkButton } from '../../../ui/Button.tsx';
import { Badge } from '../../../ui/Badge.tsx';
import { Dialog } from '../../../ui/Dialog.tsx';
import { Field, FormError, Input, NumberInput } from '../../../ui/form.tsx';
import { ITEM_KIND } from '@shared/domain.ts';
import { addDays, formatDay } from '@shared/dates.ts';
import type { EventDetail, KitchenView } from '@shared/types.ts';

const PREP_STATUS: Record<string, { label: string; tone: 'neutral' | 'info' | 'warn' | 'ok' }> = {
  unplanned: { label: 'לא תוכנן', tone: 'neutral' }, planned: { label: 'מתוכנן', tone: 'info' }, in_progress: { label: 'בהכנה', tone: 'warn' }, done: { label: 'מוכן', tone: 'ok' },
};

export function KitchenTab({ d }: { d: EventDetail }) {
  const ev = d.event;
  const q = useQuery({ queryKey: ['kitchen', 'event', ev.id], queryFn: () => api.get<KitchenView>(`/kitchen/events/${ev.id}`) });
  const [planFor, setPlanFor] = useState<KitchenView['lines'][number] | null>(null);
  const [reqOpen, setReqOpen] = useState(false);
  const canPlan = d.access.kitchen >= 2;
  const canApprove = d.access.kitchen >= 3;
  const approvedMenu = ev.menuStatus === 'approved' || ev.menuStatus === 'changed';

  return (
    <QueryView q={q} rows={6}>
      {(k) => {
        const dishes = [...new Map(k.lines.map((l) => [l.dishId, l])).values()];
        const portionsByDish = new Map<number, number>();
        for (const l of k.lines) portionsByDish.set(l.dishId, (portionsByDish.get(l.dishId) ?? 0) + l.portions);
        const short = k.raw.filter((r) => r.eventShort > 0);
        const unapproved = k.raw.filter((r) => r.computed > 0 && (r.required === null || r.required !== r.computed));
        return (
          <div className="space-y-5">
            {!approvedMenu && <div className="rounded-[10px] bg-[var(--color-warn-soft)] p-3 text-sm font-medium text-[var(--color-warn)]">התפריט עדיין לא מאושר – הכמויות כאן הן תכנון ראשוני.</div>}
            {k.missingRecipes.length > 0 && (
              <div className="rounded-[10px] bg-[var(--color-warn-soft)] p-3 text-sm text-[var(--color-warn)]">
                <AlertTriangle className="me-1 inline size-4" />למנות הבאות אין מתכון בקטלוג ולכן אין חישוב חומרי גלם: <strong>{k.missingRecipes.map((m) => m.dishName).join(', ')}</strong>
              </div>
            )}
            <Card title="מנות, כמויות ותוכנית הכנות" bodyClass="p-0">
              {!dishes.length ? <EmptyState title="אין מנות בתפריט" /> : (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead><tr><th>מנה</th><th className="text-end">מחושב</th><th className="text-end">לביצוע</th><th>יום הכנה</th><th>מצב</th><th>סיבת שינוי</th>{canPlan && <th />}</tr></thead>
                    <tbody>
                      {dishes.map((l) => {
                        const computed = portionsByDish.get(l.dishId) ?? 0;
                        const st = PREP_STATUS[l.prepStatus] ?? PREP_STATUS.unplanned;
                        return (
                          <tr key={l.dishId}>
                            <td><div className="font-semibold">{l.dishName}</div><div className="text-xs text-[var(--color-muted)]">{l.category}</div></td>
                            <td className="num text-end">{computed}</td>
                            <td className="num text-end text-base font-bold">{l.portionsOverride ?? computed}{l.portionsOverride !== null && <Badge tone="warn" className="ms-1">שונה</Badge>}</td>
                            <td className="whitespace-nowrap">{l.prepDate ? formatDay(l.prepDate) : <span className="text-[var(--color-muted)]">ביום האירוע</span>}</td>
                            <td><Badge tone={st.tone}>{st.label}</Badge></td>
                            <td className="max-w-xs text-sm text-[var(--color-ink-2)]">{l.reason}</td>
                            {canPlan && <td><Button size="sm" variant="ghost" onClick={() => setPlanFor(l)}>תכנון</Button></td>}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card title="חומרי גלם ודרישה למלאי" bodyClass="p-0" actions={<>
              {short.length > 0 && <Badge tone="danger">{short.length} פריטים בחוסר</Badge>}
              {canApprove && k.raw.length > 0 && <Button size="sm" variant={unapproved.length ? 'primary' : 'secondary'} icon={<CheckCircle2 className="size-4" />} onClick={() => setReqOpen(true)}>{unapproved.length ? 'אישור דרישה' : 'עדכון דרישה'}</Button>}
              {short.length > 0 && d.access.purchasing >= 2 && <LinkButton size="sm" to={`/purchasing/new?event=${ev.id}`} icon={<ShoppingCart className="size-4" />}>הזמנת חוסרים</LinkButton>}
              {d.access.inventory >= 2 && k.raw.some((r) => r.approvedAt) && <ConsumeButton eventId={ev.id} raw={k.raw} />}
            </>}>
              {!k.raw.length ? <EmptyState title="אין חומרי גלם מחושבים" text="הוסף מנות עם מתכון לתפריט." /> : (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead><tr><th>פריט</th><th>סוג</th><th className="text-end">מחושב</th><th className="text-end">דרישה מאושרת</th><th className="text-end">במלאי (מחסן)</th><th className="text-end">בהזמנה</th><th>מצב לאירוע</th></tr></thead>
                    <tbody>
                      {k.raw.map((r) => (
                        <tr key={r.itemId}>
                          <td className="font-semibold">{r.itemName}</td>
                          <td className="text-xs">{ITEM_KIND[r.kind]}</td>
                          <td className="num text-end">{r.computed} <span className="text-xs text-[var(--color-muted)]">{r.unit}</span></td>
                          <td className="num text-end">{r.required ?? <span className="text-[var(--color-muted)]">—</span>}{r.required !== null && r.computed > 0 && r.required !== r.computed && <Badge tone="warn" className="ms-1">שונה מהחישוב</Badge>}</td>
                          <td className="num text-end">{r.allocation ? r.allocation.balance : '—'}</td>
                          <td className="num text-end">{r.allocation?.incoming || '—'}</td>
                          <td>
                            {!r.approvedAt ? <Badge>טרם אושר</Badge>
                              : r.eventShort > 0 ? <Badge tone="danger">חסר {r.eventShort} {r.unit}{r.allocation && r.allocation.uncovered === 0 ? ' (מכוסה בהזמנה)' : ''}</Badge>
                              : <Badge tone="ok">מכוסה</Badge>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-muted)]">המלאי מוקצה לאירועים לפי סדר התאריכים. אירוע מאוחר יותר יראה חוסר כשהיתרה הוקצתה לאירוע קודם.</p>
            </Card>

            {planFor && <PrepDialog eventId={ev.id} eventDate={ev.date} line={planFor} computed={portionsByDish.get(planFor.dishId) ?? 0} onClose={() => setPlanFor(null)} />}
            {reqOpen && <RequirementsDialog eventId={ev.id} raw={k.raw} onClose={() => setReqOpen(false)} />}
          </div>
        );
      }}
    </QueryView>
  );
}

function PrepDialog({ eventId, eventDate, line, computed, onClose }: { eventId: number; eventDate: string; line: KitchenView['lines'][number]; computed: number; onClose: () => void }) {
  const [prepDate, setPrepDate] = useState(line.prepDate ?? eventDate);
  const [override, setOverride] = useState<number | null>(line.portionsOverride);
  const [reason, setReason] = useState(line.reason);
  const save = useAction(() => api.put(`/kitchen/events/${eventId}/prep/${line.dishId}`, { prepDate, portionsOverride: override, reason }),
    { success: 'התכנון נשמר', invalidate: [['kitchen'], ['event', eventId]], onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} title={`תכנון הכנה – ${line.dishName}`} size="sm" footer={<><Button onClick={onClose}>ביטול</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>שמירה</Button></>}>
      <div className="space-y-4">
        <FormError message={save.error?.message} />
        <div className="flex gap-2">
          {[-2, -1, 0].map((n) => <Button key={n} size="sm" variant={prepDate === addDays(eventDate, n) ? 'primary' : 'secondary'} onClick={() => setPrepDate(addDays(eventDate, n))}>{n === 0 ? 'ביום האירוע' : n === -1 ? 'יום לפני' : 'יומיים לפני'}</Button>)}
        </div>
        <Field label="יום הכנה" error={save.error?.fields.prepDate}>{(p) => <Input {...p} type="date" max={eventDate} value={prepDate} onChange={(e) => setPrepDate(e.target.value)} />}</Field>
        <Field label="כמות לביצוע (ריק = לפי החישוב)" hint={`מחושב: ${computed} מנות`}>{(p) => <NumberInput {...p} value={override} onChange={setOverride} />}</Field>
        {override !== null && <Field label="סיבת השינוי" required error={save.error?.fields.reason}>{(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="למשל: הכנה משותפת עם אירוע אחר" />}</Field>}
      </div>
    </Dialog>
  );
}

function RequirementsDialog({ eventId, raw, onClose }: { eventId: number; raw: KitchenView['raw']; onClose: () => void }) {
  const [qty, setQty] = useState<Record<number, number | null>>({});
  useEffect(() => setQty(Object.fromEntries(raw.map((r) => [r.itemId, r.required ?? r.computed]))), [raw]);
  const save = useAction(() => api.post(`/kitchen/events/${eventId}/requirements`, { items: raw.map((r) => ({ itemId: r.itemId, qty: qty[r.itemId] ?? 0, warehouseId: r.warehouseId, source: r.computed > 0 ? 'menu' : 'manual' })) }),
    { success: 'הדרישה אושרה והמלאי הוקצה', invalidate: [['kitchen'], ['event', eventId], ['inventory'], ['tasks']], onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} title="אישור דרישת חומרי גלם" size="lg" footer={<><Button onClick={onClose}>ביטול</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>אישור הדרישה</Button></>}>
      <p className="mb-3 text-sm text-[var(--color-muted)]">הכמויות מחושבות מהתפריט והמתכונים. אפשר לעגל או להתאים לפני האישור. כמות 0 מסירה פריט מהדרישה.</p>
      <FormError message={save.error?.message} />
      <table className="table">
        <thead><tr><th>פריט</th><th className="text-end">מחושב</th><th>לאישור</th></tr></thead>
        <tbody>
          {raw.map((r) => (
            <tr key={r.itemId}>
              <td className="font-semibold">{r.itemName}</td>
              <td className="num text-end">{r.computed} {r.unit}</td>
              <td><input aria-label={`כמות ${r.itemName}`} type="number" min={0} step="0.1" className="input num w-32" value={qty[r.itemId] ?? ''} onChange={(e) => setQty((s) => ({ ...s, [r.itemId]: e.target.value === '' ? null : Number(e.target.value) }))} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}

function ConsumeButton({ eventId, raw }: { eventId: number; raw: KitchenView['raw'] }) {
  const [open, setOpen] = useState(false);
  const items = raw.filter((r) => r.approvedAt && r.required);
  const [qty, setQty] = useState<Record<number, number>>({});
  useEffect(() => setQty(Object.fromEntries(items.map((r) => [r.itemId, r.required ?? 0]))), [raw]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useAction(() => api.post(`/kitchen/events/${eventId}/consume`, { items: items.map((r) => ({ itemId: r.itemId, qty: qty[r.itemId] ?? 0 })) }),
    { success: 'הצריכה נרשמה במלאי', invalidate: [['kitchen'], ['inventory'], ['event', eventId]], onSuccess: () => setOpen(false) });
  if (!items.length) return null;
  return (
    <>
      <Button size="sm" variant="ghost" icon={<PackageMinus className="size-4" />} onClick={() => setOpen(true)}>רישום צריכה</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="רישום צריכה בפועל" size="md" footer={<><Button onClick={() => setOpen(false)}>ביטול</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>רישום והורדה מהמלאי</Button></>}>
        <ul className="space-y-2">
          {items.map((r) => (
            <li key={r.itemId} className="flex items-center justify-between gap-3">
              <span className="font-semibold">{r.itemName}</span>
              <span className="flex items-center gap-2"><input aria-label={`נצרך ${r.itemName}`} type="number" min={0} className="input num w-28" value={qty[r.itemId] ?? 0} onChange={(e) => setQty((s) => ({ ...s, [r.itemId]: Number(e.target.value) }))} />{r.unit}</span>
            </li>
          ))}
        </ul>
      </Dialog>
    </>
  );
}
