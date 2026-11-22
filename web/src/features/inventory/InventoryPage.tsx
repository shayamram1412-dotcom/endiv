import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, ShoppingCart } from 'lucide-react';
import { api, qs } from '../../lib/api.ts';
import { useAction } from '../../lib/query.ts';
import { useAuth } from '../../lib/auth.tsx';
import { useUrlState } from '../../lib/useUrlState.ts';
import { Card, EmptyState, PageHeader, QueryView } from '../../ui/layout.tsx';
import { Button, LinkButton } from '../../ui/Button.tsx';
import { Badge } from '../../ui/Badge.tsx';
import { Segmented } from '../../ui/Tabs.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import { Field, FormError, Input, NumberInput, Select, optionsOf } from '../../ui/form.tsx';
import { ITEM_KIND, MOVEMENT_KIND } from '@shared/domain.ts';
import { formatDay, formatTs } from '@shared/dates.ts';
import type { Allocation } from '@shared/inventory.ts';
import type { ItemRecord, MovementRecord, StockRow } from '@shared/types.ts';

interface Warehouse { id: number; name: string; venue: string | null; venueName: string | null }
interface Shortage { itemId: number; itemName: string; unit: string; warehouseId: number; warehouseName: string; supplierName: string | null; allocation: Allocation }

export function useWarehouses() {
  return useQuery({ queryKey: ['inventory', 'warehouses'], queryFn: () => api.get<Warehouse[]>('/inventory/warehouses'), staleTime: 300_000 });
}

export function InventoryPage() {
  const auth = useAuth();
  const [s, set] = useUrlState({ tab: 'shortages', warehouse: '', kind: '', q: '' });
  const wh = useWarehouses();
  const [moveOpen, setMoveOpen] = useState(false);
  return (
    <div>
      <PageHeader title="מלאי ומחסנים" subtitle="יתרה פיזית לפי תנועות, שריון לאירועים לפי דרישות שאושרו, הזמנות בדרך וחוסרים."
        actions={auth.can('inventory', 2) && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setMoveOpen(true)}>תנועת מלאי</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented label="תצוגה" value={s.tab} onChange={(v) => set({ tab: v })} options={[{ value: 'shortages', label: 'חוסרים והקצאה' }, { value: 'stock', label: 'יתרות' }, { value: 'movements', label: 'תנועות' }]} />
        {s.tab !== 'shortages' && <Select aria-label="מחסן" value={s.warehouse} onChange={(e) => set({ warehouse: e.target.value })} placeholder="כל המחסנים" options={(wh.data ?? []).map((w) => ({ value: w.id, label: w.name }))} className="w-56" />}
        {s.tab === 'stock' && <>
          <Select aria-label="סוג פריט" value={s.kind} onChange={(e) => set({ kind: e.target.value })} placeholder="כל הסוגים" options={optionsOf(ITEM_KIND)} className="w-40" />
          <Input aria-label="חיפוש פריט" placeholder="חיפוש פריט" value={s.q} onChange={(e) => set({ q: e.target.value })} className="w-48" />
        </>}
      </div>
      {s.tab === 'shortages' && <Shortages />}
      {s.tab === 'stock' && <Stock params={{ warehouse: s.warehouse, kind: s.kind, q: s.q }} />}
      {s.tab === 'movements' && <Movements warehouse={s.warehouse} />}
      {moveOpen && <MovementDialog onClose={() => setMoveOpen(false)} />}
    </div>
  );
}

function Shortages() {
  const auth = useAuth();
  const q = useQuery({ queryKey: ['inventory', 'shortages'], queryFn: () => api.get<Shortage[]>('/inventory/shortages') });
  return (
    <QueryView q={q} empty={(l) => (l.length ? null : <Card><EmptyState title="אין חוסרים" text="כל הדרישות המאושרות מכוסות במלאי הפיזי." /></Card>)}>
      {(list) => (
        <div className="space-y-4">
          {auth.can('purchasing', 2) && <div className="flex justify-end"><LinkButton to="/purchasing/new" variant="primary" icon={<ShoppingCart className="size-4" />}>הזמנה מהצעות החוסר</LinkButton></div>}
          {list.map((s) => (
            <Card key={`${s.itemId}-${s.warehouseId}`} title={<span>{s.itemName} <span className="text-sm font-normal text-[var(--color-muted)]">· {s.warehouseName}</span></span>}
              actions={<>
                <Badge tone="danger">חסר {s.allocation.shortage} {s.unit}</Badge>
                {s.allocation.incoming > 0 && <Badge tone="info">בהזמנה {s.allocation.incoming}</Badge>}
                {s.allocation.uncovered > 0 ? <Badge tone="danger">להזמין {s.allocation.uncovered}</Badge> : <Badge tone="ok">מכוסה בהזמנות</Badge>}
              </>} bodyClass="p-0">
              <div className="flex flex-wrap gap-x-6 gap-y-1 px-4 py-2 text-sm">
                <span>יתרה פיזית: <strong className="num">{s.allocation.balance}</strong></span>
                <span>דרישה כוללת: <strong className="num">{s.allocation.totalNeed}</strong></span>
                {s.supplierName && <span>ספק: {s.supplierName}</span>}
              </div>
              <table className="table">
                <thead><tr><th>אירוע</th><th>תאריך</th><th className="text-end">נדרש</th><th className="text-end">הוקצה</th><th className="text-end">חסר</th></tr></thead>
                <tbody>
                  {s.allocation.rows.map((r) => (
                    <tr key={r.eventId}>
                      <td><Link to={`/events/${r.eventId}/kitchen`} className="font-semibold hover:underline">{r.title}</Link></td>
                      <td>{formatDay(r.date)}</td>
                      <td className="num text-end">{r.qty}</td>
                      <td className="num text-end">{r.allocated}</td>
                      <td className="num text-end">{r.short > 0 ? <Badge tone="danger">{r.short}</Badge> : <Badge tone="ok">0</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))}
        </div>
      )}
    </QueryView>
  );
}

function Stock({ params }: { params: Record<string, string> }) {
  const q = useQuery({ queryKey: ['inventory', 'stock', params], queryFn: () => api.get<StockRow[]>(`/inventory/stock${qs(params)}`) });
  return (
    <Card bodyClass="p-0">
      <QueryView q={q} empty={(l) => (l.length ? null : <EmptyState title="אין פריטים במלאי" />)}>
        {(list) => (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>פריט</th><th>סוג</th><th>מחסן</th><th className="text-end">יתרה פיזית</th><th className="text-end">משוריין לאירועים</th><th className="text-end">בהזמנה</th><th className="text-end">פנוי</th><th /></tr></thead>
              <tbody>
                {list.map((r) => (
                  <tr key={`${r.itemId}-${r.warehouseId}`}>
                    <td className="font-semibold">{r.itemName}</td>
                    <td className="text-xs">{ITEM_KIND[r.kind]}</td>
                    <td className="text-sm">{r.warehouseName}</td>
                    <td className="num text-end">{r.balance} <span className="text-xs text-[var(--color-muted)]">{r.unit}</span></td>
                    <td className="num text-end">{r.reserved || '—'}</td>
                    <td className="num text-end">{r.incoming || '—'}</td>
                    <td className={`num text-end font-bold ${r.available < 0 ? 'text-[var(--color-danger)]' : ''}`}>{r.available}</td>
                    <td>{r.available < 0 ? <Badge tone="danger">חוסר</Badge> : r.minStock > 0 && r.available < r.minStock ? <Badge tone="warn">מתחת למינימום</Badge> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryView>
    </Card>
  );
}

function Movements({ warehouse }: { warehouse: string }) {
  const q = useQuery({ queryKey: ['inventory', 'movements', warehouse], queryFn: () => api.get<MovementRecord[]>(`/inventory/movements${qs({ warehouse })}`) });
  return (
    <Card bodyClass="p-0">
      <QueryView q={q} empty={(l) => (l.length ? null : <EmptyState title="אין תנועות" />)}>
        {(list) => (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>מועד</th><th>פריט</th><th>מחסן</th><th>סוג</th><th className="text-end">כמות</th><th>אירוע</th><th>הערה</th><th>מבצע</th></tr></thead>
              <tbody>
                {list.map((m) => (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap text-sm">{formatTs(m.at)}</td>
                    <td className="font-semibold">{m.itemName}</td>
                    <td className="text-sm">{m.warehouseName}</td>
                    <td><Badge tone={m.qty > 0 ? 'ok' : 'neutral'}>{MOVEMENT_KIND[m.kind]}</Badge></td>
                    <td className={`num text-end font-bold ${m.qty < 0 ? 'text-[var(--color-danger)]' : 'text-[var(--color-ok)]'}`}>{m.qty > 0 ? '+' : ''}{m.qty} {m.unit}</td>
                    <td className="text-sm">{m.eventId ? <Link to={`/events/${m.eventId}`} className="hover:underline">{m.eventTitle}</Link> : '—'}</td>
                    <td className="max-w-56 truncate text-sm">{m.note}</td>
                    <td className="text-sm">{m.userName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryView>
    </Card>
  );
}

function MovementDialog({ onClose }: { onClose: () => void }) {
  const wh = useWarehouses();
  const items = useQuery({ queryKey: ['catalog', 'items'], queryFn: () => api.get<ItemRecord[]>('/catalog/items') });
  const [kind, setKind] = useState<'count' | 'adjustment' | 'transfer'>('count');
  const [itemId, setItemId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [toWarehouseId, setTo] = useState('');
  const [qty, setQty] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const save = useAction(() => api.post('/inventory/movements', kind === 'count'
    ? { kind, itemId: Number(itemId), warehouseId: Number(warehouseId), counted: qty ?? 0, note: note || 'ספירת מלאי' }
    : kind === 'transfer' ? { kind, itemId: Number(itemId), warehouseId: Number(warehouseId), toWarehouseId: Number(toWarehouseId), qty: qty ?? 0, note }
    : { kind, itemId: Number(itemId), warehouseId: Number(warehouseId), qty: qty ?? 0, note }),
  { success: 'התנועה נרשמה', invalidate: [['inventory'], ['kitchen']], onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} title="תנועת מלאי" footer={<><Button onClick={onClose}>ביטול</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>רישום</Button></>}>
      <div className="space-y-4">
        <FormError message={save.error?.message} />
        <Segmented label="סוג תנועה" value={kind} onChange={setKind} options={[{ value: 'count', label: 'ספירה' }, { value: 'adjustment', label: 'התאמה' }, { value: 'transfer', label: 'העברה בין מחסנים' }]} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="פריט" required>{(p) => <Select {...p} value={itemId} onChange={(e) => setItemId(e.target.value)} placeholder="בחירה…" options={(items.data ?? []).filter((i) => i.active).map((i) => ({ value: i.id, label: `${i.name} (${i.unit})` }))} />}</Field>
          <Field label={kind === 'transfer' ? 'ממחסן' : 'מחסן'} required>{(p) => <Select {...p} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} placeholder="בחירה…" options={(wh.data ?? []).map((w) => ({ value: w.id, label: w.name }))} />}</Field>
          {kind === 'transfer' && <Field label="למחסן" required>{(p) => <Select {...p} value={toWarehouseId} onChange={(e) => setTo(e.target.value)} placeholder="בחירה…" options={(wh.data ?? []).map((w) => ({ value: w.id, label: w.name }))} />}</Field>}
          <Field label={kind === 'count' ? 'כמות שנספרה בפועל' : kind === 'adjustment' ? 'שינוי (+/−)' : 'כמות'} required error={save.error?.fields.qty ?? save.error?.fields.counted}>{(p) => <NumberInput {...p} min={kind === 'adjustment' ? undefined : 0} step="any" value={qty} onChange={setQty} />}</Field>
          <Field label={kind === 'adjustment' ? 'סיבה' : 'הערה'} required={kind === 'adjustment'} className="sm:col-span-2" error={save.error?.fields.note}>{(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        </div>
        {kind === 'count' && <p className="text-xs text-[var(--color-muted)]">המערכת תרשום את ההפרש בין הספירה ליתרה הרשומה.</p>}
      </div>
    </Dialog>
  );
}
