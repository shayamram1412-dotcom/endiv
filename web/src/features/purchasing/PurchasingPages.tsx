import { useSettings } from '../../lib/settings.ts';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, PackageCheck, Trash2, ArrowRight, Pencil, Printer } from 'lucide-react';
import { api, qs } from '../../lib/api.ts';
import { useAction } from '../../lib/query.ts';
import { useAuth, useDirectory, usersWithRole } from '../../lib/auth.tsx';
import { useUrlState } from '../../lib/useUrlState.ts';
import { Card, EmptyState, ErrorState, Loading, PageHeader, QueryView, DL } from '../../ui/layout.tsx';
import { Button, LinkButton } from '../../ui/Button.tsx';
import { Badge, StatusPill } from '../../ui/Badge.tsx';
import { Segmented } from '../../ui/Tabs.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import { Checkbox, Field, FormError, Input, MoneyInput, Select, Textarea } from '../../ui/form.tsx';
import { formatMoney } from '@shared/money.ts';
import { useWarehouses } from '../inventory/InventoryPage.tsx';
import { addDays, formatDay, formatTs, today } from '@shared/dates.ts';
import type { ItemRecord, PurchaseOrderRecord, SupplierRecord } from '@shared/types.ts';

export function OrdersPage() {
  const auth = useAuth();
  const [s, set] = useUrlState({ status: 'open', tab: 'orders' });
  const q = useQuery({ queryKey: ['purchasing', 'orders', s.status], queryFn: () => api.get<PurchaseOrderRecord[]>(`/purchasing/orders${qs({ status: s.status === 'all' ? '' : s.status })}`), enabled: s.tab === 'orders' });
  return (
    <div>
      <PageHeader title="רכש וספקים" subtitle="הזמנות עם אחראי ומועד אספקה. קבלה חלקית מעדכנת את המלאי מיד ומשאירה את הפער פתוח לטיפול."
        actions={auth.can('purchasing', 2) && <LinkButton to="/purchasing/new" variant="primary" icon={<Plus className="size-4" />}>הזמנה חדשה</LinkButton>} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Segmented label="אזור" value={s.tab} onChange={(v) => set({ tab: v })} options={[{ value: 'orders', label: 'הזמנות' }, { value: 'suppliers', label: 'ספקים' }]} />
        {s.tab === 'orders' && <Segmented label="מצב" value={s.status} onChange={(v) => set({ status: v })} options={[{ value: 'open', label: 'פתוחות' }, { value: 'received', label: 'התקבלו' }, { value: 'all', label: 'הכול' }]} />}
      </div>
      {s.tab === 'suppliers' ? <SuppliersPanel /> : (
        <Card bodyClass="p-0">
          <QueryView q={q} empty={(l) => (l.length ? null : <EmptyState title="אין הזמנות" />)}>
            {(list) => (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead><tr><th>#</th><th>ספק</th><th>מועד אספקה</th><th>מחסן</th><th>אחראי</th><th>שורות</th><th>מצב</th></tr></thead>
                  <tbody>
                    {list.map((o) => {
                      const late = (o.status === 'ordered' || o.status === 'partial') && o.expectedDate < today();
                      return (
                        <tr key={o.id}>
                          <td><Link to={`/purchasing/${o.id}`} className="font-bold text-[var(--color-brand)] hover:underline">#{o.id}</Link></td>
                          <td className="font-semibold">{o.supplierName}</td>
                          <td className="whitespace-nowrap">{formatDay(o.expectedDate)} {o.expectedTime}{late && <Badge tone="danger" className="ms-1">עבר המועד</Badge>}</td>
                          <td className="text-sm">{o.warehouseName}</td>
                          <td className="text-sm">{o.responsibleName ?? '—'}</td>
                          <td className="text-sm">{o.lines.length} · {o.lines.filter((l) => l.gap > 0 && !l.gapResolved).length > 0 && <Badge tone="warn">פערים פתוחים</Badge>}</td>
                          <td><StatusPill kind="po" value={o.status} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </QueryView>
        </Card>
      )}
    </div>
  );
}

export function OrderPage() {
  const id = Number(useParams().id);
  const auth = useAuth();
  const q = useQuery({ queryKey: ['purchasing', 'order', id], queryFn: () => api.get<PurchaseOrderRecord>(`/purchasing/orders/${id}`) });
  const [recv, setRecv] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [resolveLine, setResolveLine] = useState<number | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const cancel = useAction(() => api.post(`/purchasing/orders/${id}/cancel`, { reason: cancelReason }), { success: 'ההזמנה בוטלה', invalidate: [['purchasing'], ['inventory'], ['tasks']], onSuccess: () => setCancelOpen(false) });
  const [resolveNote, setResolveNote] = useState('');
  const receive = useAction(() => api.post(`/purchasing/orders/${id}/receive`, { lines: Object.entries(recv).filter(([, v]) => Number(v) > 0).map(([lineId, v]) => ({ lineId: Number(lineId), qty: Number(v), note: notes[Number(lineId)] ?? '' })) }),
    { success: 'הקבלה נרשמה והמלאי עודכן', invalidate: [['purchasing'], ['inventory'], ['tasks'], ['event']], onSuccess: () => { setRecv({}); setNotes({}); } });
  const resolve = useAction(() => api.post(`/purchasing/lines/${resolveLine}/resolve`, { note: resolveNote }), { success: 'הפער נסגר', invalidate: [['purchasing'], ['inventory'], ['tasks']], onSuccess: () => { setResolveLine(null); setResolveNote(''); } });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const o = q.data;
  const open = o.status === 'ordered' || o.status === 'partial';
  const canReceive = auth.can('purchasing', 2) && open;
  const fillAll = () => setRecv(Object.fromEntries(o.lines.filter((l) => l.gap > 0 && !l.gapResolved).map((l) => [l.id, String(l.gap)])));

  return (
    <div>
      <Link to="/purchasing" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-muted)]"><ArrowRight className="size-4" />להזמנות</Link>
      <PageHeader title={`הזמנה #${o.id} · ${o.supplierName}`} actions={<>
        <StatusPill kind="po" value={o.status} />
        <LinkButton to={`/print/po/${o.id}`} icon={<Printer className="size-4" />}>הדפסה / וואטסאפ לספק</LinkButton>
        {open && auth.can('purchasing', 3) && !o.lines.some((l) => l.received > 0) && <Button variant="ghost" onClick={() => setCancelOpen(true)}>ביטול ההזמנה</Button>}
      </>} />
      <Dialog open={cancelOpen} onClose={() => setCancelOpen(false)} title="ביטול הזמנה" size="sm" footer={<><Button onClick={() => setCancelOpen(false)}>חזרה</Button><Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate(undefined)}>ביטול ההזמנה</Button></>}>
        <FormError message={cancel.error?.message} />
        <Field label="סיבת הביטול" required error={cancel.error?.fields.reason}>{(p) => <Textarea {...p} data-autofocus value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />}</Field>
      </Dialog>
      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <Card title="שורות ההזמנה" bodyClass="p-0" actions={canReceive && <Button size="sm" onClick={fillAll}>מילוי הכל כהתקבל</Button>}>
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>פריט</th><th>לאירוע</th><th className="text-end">הוזמן</th><th className="text-end">מחיר ליח׳</th><th className="text-end">התקבל</th><th className="text-end">פער</th>{canReceive && <th>קבלה עכשיו</th>}<th>טיפול בפער</th></tr></thead>
              <tbody>
                {o.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="font-semibold">{l.itemName}</td>
                    <td className="text-sm">{l.eventId ? <Link to={`/events/${l.eventId}/kitchen`} className="hover:underline">{l.eventTitle}</Link> : '—'}</td>
                    <td className="num text-end">{l.qty} {l.unit}</td>
                    <td className="num text-end">{formatMoney(l.unitPrice)}</td>
                    <td className="num text-end">{l.received}</td>
                    <td className="num text-end">{l.gap > 0 ? <Badge tone={l.gapResolved ? 'neutral' : 'warn'}>{l.gap}</Badge> : <Badge tone="ok">0</Badge>}</td>
                    {canReceive && (
                      <td>
                        {l.gap > 0 && !l.gapResolved && (
                          <div className="flex gap-1">
                            <input aria-label={`כמות שהתקבלה ${l.itemName}`} type="number" min={0} step="any" className="input num w-24" value={recv[l.id] ?? ''} onChange={(e) => setRecv((r) => ({ ...r, [l.id]: e.target.value }))} />
                            <input aria-label={`הערה ${l.itemName}`} className="input w-40" placeholder="הערה (חלקי…)" value={notes[l.id] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [l.id]: e.target.value }))} />
                          </div>
                        )}
                      </td>
                    )}
                    <td className="text-sm">
                      {l.gapNote && <div className="text-[var(--color-ink-2)]">{l.gapNote}</div>}
                      {l.gap > 0 && !l.gapResolved && auth.can('purchasing', 2) && <Button size="sm" variant="ghost" onClick={() => setResolveLine(l.id)}>סגירת פער</Button>}
                      {l.gapResolved ? <Badge>נסגר</Badge> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canReceive && (
            <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] p-3">
              <FormError message={receive.error?.message} />
              <Button variant="primary" icon={<PackageCheck className="size-4" />} disabled={!Object.values(recv).some((v) => Number(v) > 0)} loading={receive.isPending} onClick={() => receive.mutate(undefined)}>רישום קבלה</Button>
            </div>
          )}
        </Card>
        <Card title="פרטים">
          <DL cols={1} items={[
            ['ספק', o.supplierName], ['מועד אספקה', `${formatDay(o.expectedDate)} ${o.expectedTime}`], ['מחסן יעד', o.warehouseName], ['אחראי לאימות', o.responsibleName],
            ['נוצרה', formatTs(o.createdAt)], ['הערות', o.notes],
          ]} />
        </Card>
      </div>
      <Dialog open={resolveLine !== null} onClose={() => setResolveLine(null)} title="סגירת פער בשורה" size="sm" footer={<><Button onClick={() => setResolveLine(null)}>ביטול</Button><Button variant="primary" loading={resolve.isPending} onClick={() => resolve.mutate(undefined)}>סגירה</Button></>}>
        <p className="mb-3 text-sm text-[var(--color-muted)]">סגירה מציינת שהספק לא ישלים את היתרה. אם חסר לאירוע – החוסר ימשיך להופיע במלאי עד שיוזמן ממקור אחר.</p>
        <Field label="מה נעשה עם הפער" required error={resolve.error?.fields.note}>{(p) => <Textarea {...p} value={resolveNote} onChange={(e) => setResolveNote(e.target.value)} />}</Field>
      </Dialog>
    </div>
  );
}

interface Suggestion { supplierId: number | null; supplierName: string; warehouseId: number; neededBy: string; lines: { itemId: number; itemName: string; unit: string; qty: number; eventId: number | null; neededBy: string }[] }

export function NewOrderPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const eventId = params.get('event');
  const dir = useDirectory();
  const wh = useWarehouses();
  const suppliers = useQuery({ queryKey: ['purchasing', 'suppliers'], queryFn: () => api.get<SupplierRecord[]>('/purchasing/suppliers') });
  const items = useQuery({ queryKey: ['catalog', 'items'], queryFn: () => api.get<ItemRecord[]>('/catalog/items') });
  const sugg = useQuery({ queryKey: ['purchasing', 'suggestions', eventId], queryFn: () => api.get<Suggestion[]>(`/purchasing/suggestions${qs({ event: eventId })}`) });
  const [supplierId, setSupplierId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [responsibleId, setResponsibleId] = useState('');
  const fd = useSettings().formDefaults;
  const [expectedDate, setExpectedDate] = useState(addDays(today(), fd.poLeadDays));
  const [expectedTime, setExpectedTime] = useState(fd.poTime);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<{ itemId: string; qty: string; eventId: number | null; price?: number | null; label?: string }[]>([{ itemId: '', qty: '', eventId: null }]);
  const itemPrice = (id: string) => items.data?.find((it) => String(it.id) === id)?.unitCost || null;
  const priceOf = (l: { itemId: string; price?: number | null }) => (l.price !== undefined ? l.price : itemPrice(l.itemId));
  const orderTotal = lines.reduce((a, l) => a + Math.round((priceOf(l) ?? 0) * (Number(l.qty) || 0)), 0);
  const [applied, setApplied] = useState(false);

  const apply = (s: Suggestion) => {
    setSupplierId(s.supplierId ? String(s.supplierId) : '');
    setWarehouseId(String(s.warehouseId));
    setExpectedDate(s.neededBy > today() ? addDays(s.neededBy, -1) : today());
    setLines(s.lines.map((l) => ({ itemId: String(l.itemId), qty: String(l.qty), eventId: l.eventId })));
    setApplied(true);
  };
  useEffect(() => { if (!applied && sugg.data?.length === 1) apply(sugg.data[0]); }, [sugg.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useAction(() => api.post<{ id: number }>('/purchasing/orders', {
    supplierId: Number(supplierId), warehouseId: Number(warehouseId), responsibleId: responsibleId ? Number(responsibleId) : null,
    expectedDate, expectedTime, notes, lines: lines.filter((l) => l.itemId && Number(l.qty) > 0).map((l) => ({ itemId: Number(l.itemId), qty: Number(l.qty), eventId: l.eventId, unitPrice: priceOf(l) })),
  }), { success: 'ההזמנה נשמרה', invalidate: [['purchasing'], ['inventory'], ['tasks']], onSuccess: (r) => nav(`/purchasing/${r.id}`) });
  const responsibles = [...usersWithRole(dir.data, 'purchasing'), ...usersWithRole(dir.data, 'kitchen')];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="הזמנת רכש" subtitle="אחראי ההזמנה יקבל משימת אימות קבלה במועד האספקה. כאשר מנהל המטבח מזמין – האחריות נרשמת על שמו." />
      {(sugg.data?.length ?? 0) > 0 && (
        <Card title="הצעות לפי חוסרים שלא כוסו" className="mb-5">
          <ul className="space-y-2">
            {sugg.data!.map((s, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 rounded-[10px] border border-[var(--color-border)] p-2.5">
                <span className="font-semibold">{s.supplierName}</span>
                <span className="text-sm text-[var(--color-ink-2)]">{s.lines.map((l) => `${l.itemName} ${l.qty} ${l.unit}`).join(' · ')}</span>
                <span className="text-xs text-[var(--color-muted)]">נדרש עד {formatDay(s.neededBy)}</span>
                <Button size="sm" className="ms-auto" onClick={() => apply(s)}>מילוי ההזמנה</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title="פרטי ההזמנה">
        <FormError message={save.error?.message} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="ספק" required>{(p) => <Select {...p} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} placeholder="בחירה…" options={(suppliers.data ?? []).filter((s) => s.active).map((s) => ({ value: s.id, label: s.name }))} />}</Field>
          <Field label="מחסן יעד" required>{(p) => <Select {...p} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} placeholder="בחירה…" options={(wh.data ?? []).map((w) => ({ value: w.id, label: w.name }))} />}</Field>
          <Field label="אחראי לאימות קבלה" hint="ריק = אתה">{(p) => <Select {...p} value={responsibleId} onChange={(e) => setResponsibleId(e.target.value)} placeholder="אני" options={[...new Map(responsibles.map((u) => [u.id, u])).values()].map((u) => ({ value: u.id, label: u.name }))} />}</Field>
          <Field label="מועד אספקה" required error={save.error?.fields.expectedDate}>{(p) => <Input {...p} type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />}</Field>
          <Field label="שעה">{(p) => <Input {...p} type="time" value={expectedTime} onChange={(e) => setExpectedTime(e.target.value)} />}</Field>
          <Field label="הערות">{(p) => <Input {...p} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        </div>
        <h3 className="mb-2 mt-5 text-sm font-bold">שורות</h3>
        <ul className="space-y-2">
          {lines.map((l, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <Select aria-label="פריט" value={l.itemId} onChange={(e) => setLines((x) => x.map((y, j) => (j === i ? { ...y, itemId: e.target.value, price: undefined } : y)))} placeholder="פריט…" options={(items.data ?? []).filter((it) => it.active).map((it) => ({ value: it.id, label: `${it.name} (${it.unit})` }))} className="w-72" />
              <input aria-label="כמות" type="number" min={0} step="any" className="input num w-28" value={l.qty} onChange={(e) => setLines((x) => x.map((y, j) => (j === i ? { ...y, qty: e.target.value } : y)))} />
              <div className="w-32"><MoneyInput aria-label="מחיר ליחידה" placeholder="מחיר ליח׳" value={priceOf(l)} onChange={(v) => setLines((x) => x.map((y, j) => (j === i ? { ...y, price: v } : y)))} /></div>
              {priceOf(l) && Number(l.qty) > 0 ? <span className="num text-sm text-[var(--color-muted)]">{formatMoney(Math.round((priceOf(l) ?? 0) * Number(l.qty)))}</span> : null}
              {l.eventId && <Badge tone="brand">לאירוע #{l.eventId}</Badge>}
              <button onClick={() => setLines((x) => x.filter((_, j) => j !== i))} className="p-1 text-[var(--color-danger)]" aria-label="הסרת שורה"><Trash2 className="size-4" /></button>
            </li>
          ))}
        </ul>
        <Button size="sm" className="mt-2" icon={<Plus className="size-4" />} onClick={() => setLines((x) => [...x, { itemId: '', qty: '', eventId: null }])}>שורה</Button>
        {orderTotal > 0 && <p className="mt-3 text-sm">סה״כ משוער להזמנה: <strong className="num">{formatMoney(orderTotal)}</strong> <span className="text-xs text-[var(--color-muted)]">(המחיר נשמר כמחיר הפריט בקבלה)</span></p>}
        <div className="mt-5 flex justify-end"><Button variant="primary" size="lg" loading={save.isPending} disabled={!supplierId || !warehouseId} onClick={() => save.mutate(undefined)}>שמירת ההזמנה</Button></div>
      </Card>
    </div>
  );
}

function SuppliersPanel() {
  const auth = useAuth();
  const q = useQuery({ queryKey: ['purchasing', 'suppliers'], queryFn: () => api.get<SupplierRecord[]>('/purchasing/suppliers') });
  const [edit, setEdit] = useState<SupplierRecord | 'new' | null>(null);
  return (
    <Card bodyClass="p-0" actions={auth.can('purchasing', 2) && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEdit('new')}>ספק חדש</Button>} title="ספקים">
      <QueryView q={q}>
        {(list) => (
          <table className="table">
            <thead><tr><th>ספק</th><th>איש קשר</th><th>טלפון</th><th>קטגוריות</th><th>מצב</th><th /></tr></thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} className={s.active ? '' : 'opacity-60'}>
                  <td className="font-semibold">{s.name}</td><td>{s.contact}</td><td className="num"><a href={`tel:${s.phone}`}>{s.phone}</a></td><td className="text-sm">{s.categories}</td>
                  <td>{s.active ? <Badge tone="ok">פעיל</Badge> : <Badge>לא פעיל</Badge>}</td>
                  <td>{auth.can('purchasing', 2) && <Button size="sm" variant="ghost" aria-label={`עריכת ${s.name}`} onClick={() => setEdit(s)}><Pencil className="size-4" /></Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </QueryView>
      {edit && <SupplierDialog s={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </Card>
  );
}

function SupplierDialog({ s, onClose }: { s: SupplierRecord | null; onClose: () => void }) {
  const [v, setV] = useState({ name: s?.name ?? '', contact: s?.contact ?? '', phone: s?.phone ?? '', email: s?.email ?? '', categories: s?.categories ?? '', notes: s?.notes ?? '', active: s ? !!s.active : true });
  const save = useAction(() => (s ? api.put(`/purchasing/suppliers/${s.id}`, v) : api.post('/purchasing/suppliers', v)), { success: 'הספק נשמר', invalidate: [['purchasing']], onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} title={s ? `עריכת ${s.name}` : 'ספק חדש'} footer={<><Button onClick={onClose}>ביטול</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>שמירה</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="שם" required error={save.error?.fields.name}>{(p) => <Input {...p} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
        <Field label="איש קשר">{(p) => <Input {...p} value={v.contact} onChange={(e) => setV({ ...v, contact: e.target.value })} />}</Field>
        <Field label="טלפון" error={save.error?.fields.phone}>{(p) => <Input {...p} dir="ltr" className="text-start" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />}</Field>
        <Field label="מייל" error={save.error?.fields.email}>{(p) => <Input {...p} dir="ltr" className="text-start" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />}</Field>
        <Field label="קטגוריות" className="sm:col-span-2">{(p) => <Input {...p} value={v.categories} onChange={(e) => setV({ ...v, categories: e.target.value })} />}</Field>
        <Checkbox label="ספק פעיל" checked={v.active} onChange={(c) => setV({ ...v, active: c })} />
      </div>
    </Dialog>
  );
}
