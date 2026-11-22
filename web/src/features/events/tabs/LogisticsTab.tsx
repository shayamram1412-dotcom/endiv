import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Wand2, Plus, Truck, PackageCheck, Undo2, Trash2 } from 'lucide-react';
import { api } from '../../../lib/api.ts';
import { useAction } from '../../../lib/query.ts';
import { Card, EmptyState, QueryView } from '../../../ui/layout.tsx';
import { Button } from '../../../ui/Button.tsx';
import { Badge } from '../../../ui/Badge.tsx';
import { Dialog } from '../../../ui/Dialog.tsx';
import { Checkbox, Field, FormError, Input, MoneyInput, NumberInput, Select, Textarea } from '../../../ui/form.tsx';
import { formatMoney } from '@shared/money.ts';
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { TransportCard } from './TransportCard.tsx';
import type { EquipmentLine, EventDetail, ItemRecord } from '@shared/types.ts';

type Stage = 'loaded' | 'unloaded' | 'returned';
interface Conflict { date: string; itemId: number; itemName: string; owned: number; demanded: number; short: number; events: { eventId: number; title: string; qty: number }[] }
interface EqView { mode: 'rental' | 'consumables' | 'none' | 'site'; loadCheck: boolean; lines: EquipmentLine[]; conflicts: Conflict[] }

const STAGE_LABEL: Record<Stage, string> = { loaded: 'ספירת העמסה', unloaded: 'ספירה לאחר פריקה', returned: 'החזרה לספק' };

export function LogisticsTab({ d }: { d: EventDetail }) {
  const ev = d.event;
  const q = useQuery({ queryKey: ['event', ev.id, 'equipment'], queryFn: () => api.get<EqView>(`/events/${ev.id}/equipment`) });
  const canEdit = d.access.equipment >= 2;
  const [stage, setStage] = useState<Stage | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const inv = [['event', ev.id]];
  const gen = useAction(() => api.post<{ added: number }>(`/events/${ev.id}/equipment/generate`), { success: (r) => `נוספו ${r.added} פריטים מהתבנית`, invalidate: inv });
  const patch = useAction(({ id, body }: { id: number; body: Record<string, unknown> }) => api.patch(`/events/${ev.id}/equipment/${id}`, body), {
    invalidate: inv,
    optimistic: { key: ['event', ev.id, 'equipment'], update: (old, v) => { const o = old as EqView; return { ...o, lines: o.lines.map((l) => (l.id === v.id ? { ...l, ...v.body, supplierConfirmed: v.body.supplierConfirmed ? 1 : 0 } : l)) }; } },
  });
  const del = useAction((id: number) => api.del(`/events/${ev.id}/equipment/${id}`), { invalidate: inv });

  return (
    <QueryView q={q} rows={5}>
      {(v) => {
        const gaps = v.lines.filter((l) => (l.loaded !== null && l.unloaded !== null && l.unloaded < l.loaded) || (l.returned !== null && l.returned < l.planned));
        return (
          <div className="space-y-5">
            <div className="rounded-[10px] bg-[var(--color-surface-2)] p-3 text-sm">
              {v.mode === 'rental' && 'ציוד שכור: כלי הגשה רב-פעמיים מוזמנים מספק לפי סוג האירוע. מנהל האירוע אחראי להחזרה ומתעד כמה כלים הוחזרו.'}
              {v.mode === 'consumables' && 'ציוד מתכלה בלבד. מנהל התפעול סופר אוכל וציוד לפני ההעמסה ושוב לאחר הפריקה – כל פער מקבל אחראי.'}
              {v.mode === 'site' && `אירוע חוץ: ציוד לפי צורכי האתר.${ev.siteRequirements ? ` דרישות המקום: ${ev.siteRequirements}` : ''}`}
            </div>
            {v.conflicts.length > 0 && (
              <div role="alert" className="rounded-[10px] border border-[var(--color-warn)] bg-[var(--color-warn-soft)] p-3 text-sm">
                <strong className="text-[var(--color-warn)]">ציוד בבעלות שנדרש גם באירוע אחר באותו יום:</strong>
                <ul className="mt-1 space-y-0.5">
                  {v.conflicts.map((c) => (
                    <li key={c.itemId}>{c.itemName}: נדרשים {c.demanded}, בבעלות {c.owned} – <strong>חסרים {c.short}</strong> ({c.events.map((e) => (
                      e.eventId === ev.id ? `כאן ${e.qty}` : <Link key={e.eventId} to={`/events/${e.eventId}/logistics`} className="underline">{e.title} {e.qty}</Link>
                    )).reduce<ReactNode[]>((a, x, i) => (i ? [...a, ' · ', x] : [x]), [])}). להשכיר או לשנות כמויות.</li>
                  ))}
                </ul>
              </div>
            )}
            {gaps.length > 0 && (
              <div role="alert" className="rounded-[10px] border border-[var(--color-danger)] bg-[var(--color-danger-soft)] p-3 text-sm">
                <strong className="text-[var(--color-danger)]">פערים בספירה:</strong>{' '}
                {gaps.map((g) => `${g.label}: ${g.unloaded ?? g.returned} מתוך ${g.loaded ?? g.planned}${g.gapOwnerName ? ` (אחראי: ${g.gapOwnerName})` : ''}`).join(' · ')}
              </div>
            )}
            <Card title="רשימת ציוד" bodyClass="p-0" actions={canEdit && <>
              <Button size="sm" icon={<Wand2 className="size-4" />} loading={gen.isPending} onClick={() => gen.mutate(undefined)}>הפקה מתבנית הנקודה</Button>
              <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setAddOpen(true)}>פריט</Button>
              {v.loadCheck && <Button size="sm" variant="primary" icon={<Truck className="size-4" />} onClick={() => setStage('loaded')}>ספירת העמסה</Button>}
              {v.loadCheck && <Button size="sm" variant="primary" icon={<PackageCheck className="size-4" />} disabled={!v.lines.some((l) => l.loaded !== null)} onClick={() => setStage('unloaded')}>ספירה לאחר פריקה</Button>}
              {v.mode === 'rental' && <Button size="sm" variant="primary" icon={<Undo2 className="size-4" />} onClick={() => setStage('returned')}>החזרה לספק</Button>}
            </>}>
              {!v.lines.length ? <EmptyState title="אין רשימת ציוד" text="הפק רשימה מתבנית הנקודה וסוג האירוע או הוסף פריטים ידנית." /> : (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead><tr>
                      <th>פריט</th><th className="text-end">מתוכנן</th>
                      {v.mode === 'rental' && <><th>ספק</th><th className="text-end">מחיר ליח׳</th><th>הזמנה אושרה</th><th className="text-end">הוחזר</th></>}
                      {v.loadCheck && <><th className="text-end">הועמס</th><th className="text-end">נפרק</th><th>פער</th></>}
                      <th>הערות</th>{canEdit && <th />}
                    </tr></thead>
                    <tbody>
                      {v.lines.map((l) => {
                        const gap = l.loaded !== null && l.unloaded !== null ? l.loaded - l.unloaded : null;
                        return (
                          <tr key={l.id}>
                            <td><span className="font-semibold">{l.label}</span>{l.isFood ? <Badge tone="brand" className="ms-1">מזון</Badge> : null}</td>
                            <td className="num text-end">{l.planned} <span className="text-xs text-[var(--color-muted)]">{l.unit}</span></td>
                            {v.mode === 'rental' && <>
                              <td className="text-sm">{l.supplierName ?? '—'}</td>
                              <td className="num text-end text-sm">{l.unitCost ? formatMoney(l.unitCost) : '—'}</td>
                              <td><Checkbox label={l.supplierConfirmed ? 'אושר' : 'לא אושר'} checked={!!l.supplierConfirmed} disabled={!canEdit || l.isFood === 1} onChange={(c) => patch.mutate({ id: l.id, body: { supplierConfirmed: c } })} /></td>
                              <td className="num text-end">{l.returned ?? '—'}{l.returned !== null && l.returned < l.planned && <Badge tone="danger" className="ms-1">חסר {l.planned - l.returned}</Badge>}</td>
                            </>}
                            {v.loadCheck && <>
                              <td className="num text-end">{l.loaded ?? '—'}</td>
                              <td className="num text-end">{l.unloaded ?? '—'}</td>
                              <td>{gap === null ? '—' : gap > 0 ? <Badge tone="danger">חסר {gap}</Badge> : <Badge tone="ok">תקין</Badge>}</td>
                            </>}
                            <td className="text-sm text-[var(--color-ink-2)]">{l.gapNote || l.notes}</td>
                            {canEdit && <td><button onClick={() => del.mutate(l.id)} className="p-1 text-[var(--color-danger)]" aria-label={`הסרת ${l.label}`}><Trash2 className="size-4" /></button></td>}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            <TransportCard eventId={ev.id} canEdit={canEdit} />
            {stage && <CountDialog eventId={ev.id} stage={stage} lines={v.lines.filter((l) => stage !== 'returned' || !l.isFood)} onClose={() => setStage(null)} />}
            {addOpen && <AddLineDialog eventId={ev.id} onClose={() => setAddOpen(false)} />}
          </div>
        );
      }}
    </QueryView>
  );
}

function CountDialog({ eventId, stage, lines, onClose }: { eventId: number; stage: Stage; lines: EquipmentLine[]; onClose: () => void }) {
  const expected = (l: EquipmentLine) => (stage === 'unloaded' ? l.loaded ?? l.planned : l.planned);
  const [counts, setCounts] = useState<Record<number, number | null>>(() => Object.fromEntries(lines.map((l) => [l.id, l[stage] ?? expected(l)])));
  const [note, setNote] = useState('');
  const save = useAction(() => api.put<{ gaps: string[] }>(`/events/${eventId}/equipment/counts`, { stage, note, counts: lines.map((l) => ({ id: l.id, qty: counts[l.id] ?? 0 })) }), {
    success: (r) => (r.gaps.length ? `נרשמו ${r.gaps.length} פערים ונפתח דיווח לטיפול` : 'נספר ללא פערים'),
    invalidate: [['event', eventId], ['tasks'], ['dashboard']], onSuccess: onClose,
  });
  return (
    <Dialog open onClose={onClose} title={STAGE_LABEL[stage]} size="md" footer={<><Button onClick={onClose}>ביטול</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>אישור הספירה</Button></>}>
      <FormError message={save.error?.message} />
      <ul className="divide-y divide-[var(--color-border)]">
        {lines.map((l) => {
          const exp = expected(l);
          const val = counts[l.id];
          return (
            <li key={l.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1"><div className="font-semibold">{l.label}</div><div className="text-xs text-[var(--color-muted)]">צפוי: {exp} {l.unit}</div></div>
              <div className="w-28"><NumberInput aria-label={`נספר ${l.label}`} value={val} onChange={(x) => setCounts((c) => ({ ...c, [l.id]: x }))} className="input num text-lg font-bold" /></div>
              <div className="w-20 text-end">{val !== null && val < exp ? <Badge tone="danger">−{exp - val}</Badge> : <Badge tone="ok">✓</Badge>}</div>
            </li>
          );
        })}
      </ul>
      <Field label="הערה" className="mt-3">{(p) => <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
    </Dialog>
  );
}

function AddLineDialog({ eventId, onClose }: { eventId: number; onClose: () => void }) {
  const items = useQuery({ queryKey: ['catalog', 'items'], queryFn: () => api.get<ItemRecord[]>('/catalog/items') });
  const [itemId, setItemId] = useState('');
  const [label, setLabel] = useState('');
  const [unit, setUnit] = useState('יח׳');
  const [planned, setPlanned] = useState<number | null>(null);
  const [unitCost, setUnitCost] = useState<number | null>(null);
  const [isFood, setIsFood] = useState(false);
  const pick = (id: string) => {
    setItemId(id);
    const it = items.data?.find((x) => String(x.id) === id);
    if (it) { setLabel(it.name); setUnit(it.unit); setUnitCost(it.kind === 'rental' ? it.unitCost : 0); }
  };
  const save = useAction(() => api.post(`/events/${eventId}/equipment`, { itemId: itemId ? Number(itemId) : null, label, unit, planned: planned ?? 0, isFood, unitCost: unitCost ?? 0 }), { success: 'נוסף', invalidate: [['event', eventId]], onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} title="פריט ציוד" size="sm" footer={<><Button onClick={onClose}>ביטול</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>הוספה</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="מהקטלוג" hint="ציוד בבעלות נבדק מול אירועים אחרים באותו יום" className="sm:col-span-2">{(p) => <Select {...p} value={itemId} onChange={(e) => pick(e.target.value)} placeholder="פריט חופשי" options={(items.data ?? []).filter((i) => i.kind !== 'food' && i.active).map((i) => ({ value: i.id, label: `${i.name} (${i.kind === 'equipment' ? 'בבעלות' : i.kind === 'rental' ? 'שכירות' : 'מתכלה'})` }))} />}</Field>
        <Field label="תיאור" className="sm:col-span-2" error={save.error?.fields.label}>{(p) => <Input {...p} value={label} onChange={(e) => setLabel(e.target.value)} />}</Field>
        <Field label="כמות">{(p) => <NumberInput {...p} value={planned} onChange={setPlanned} />}</Field>
        <Field label="יחידה">{(p) => <Input {...p} value={unit} onChange={(e) => setUnit(e.target.value)} />}</Field>
        <Field label="מחיר שכירות ליח׳" hint="לחישוב רווחיות">{(p) => <MoneyInput {...p} value={unitCost} onChange={setUnitCost} />}</Field>
        <Checkbox label="פריט מזון (לספירת העמסה)" checked={isFood} onChange={setIsFood} />
      </div>
    </Dialog>
  );
}
