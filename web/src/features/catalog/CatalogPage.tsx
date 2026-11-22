import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { useAction } from '../../lib/query.ts';
import { useAuth } from '../../lib/auth.tsx';
import { useUrlState } from '../../lib/useUrlState.ts';
import { Card, EmptyState, Loading, PageHeader, QueryView } from '../../ui/layout.tsx';
import { Button } from '../../ui/Button.tsx';
import { Badge } from '../../ui/Badge.tsx';
import { Segmented } from '../../ui/Tabs.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import { Checkbox, Field, FormError, Input, MoneyInput, NumberInput, Select, Textarea, optionsOf } from '../../ui/form.tsx';
import { formatMoney } from '@shared/money.ts';
import { VENUE_RULES, VENUE_CODES, ALLERGENS, EVENT_TYPES, ITEM_KIND, VENUE_LABEL } from '@shared/domain.ts';
import { useSettings } from '../../lib/settings.ts';
import type { DishRecord, ItemRecord, SupplierRecord } from '@shared/types.ts';

export function CatalogPage() {
  const [s, set] = useUrlState({ tab: 'dishes' });
  return (
    <div>
      <PageHeader title="קטלוג" subtitle="מנות ומתכונים (תפוקה → חומרי גלם), פריטי מלאי ותבניות ציוד לכל נקודה." />
      <div className="mb-4"><Segmented label="קטלוג" value={s.tab} onChange={(v) => set({ tab: v })} options={[{ value: 'dishes', label: 'מנות ומתכונים' }, { value: 'items', label: 'פריטים' }, { value: 'equipment', label: 'תבניות ציוד' }]} /></div>
      {s.tab === 'dishes' && <Dishes />}
      {s.tab === 'items' && <Items />}
      {s.tab === 'equipment' && <Templates />}
    </div>
  );
}

function Dishes() {
  const auth = useAuth();
  const q = useQuery({ queryKey: ['catalog', 'dishes'], queryFn: () => api.get<(DishRecord & { recipeLines: number })[]>('/catalog/dishes') });
  const [edit, setEdit] = useState<number | 'new' | null>(null);
  const canEdit = auth.can('catalog', 2);
  const costs = useQuery({ queryKey: ['catalog', 'dish-costs'], queryFn: () => api.get<Record<number, { perPortion: number; unpriced: number }>>('/finance/dish-costs'), enabled: auth.margins });
  return (
    <Card bodyClass="p-0" title="מנות" actions={canEdit && <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit('new')}>מנה חדשה</Button>}>
      <QueryView q={q}>
        {(list) => (
          <table className="table">
            <thead><tr><th>מנה</th><th>קטגוריה</th><th className="text-end">ברירת מחדל לאורח</th><th className="text-end">תפוקת מתכון</th><th>מתכון</th><th>אלרגנים</th>{auth.margins && <th className="text-end">עלות למנה</th>}<th /></tr></thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id} className={d.active ? '' : 'opacity-50'}>
                  <td className="font-semibold">{d.name} {d.isVegan ? <Badge tone="ok">טבעוני</Badge> : d.isVegetarian ? <Badge tone="ok">צמחוני</Badge> : null}</td>
                  <td>{d.category}</td>
                  <td className="num text-end">{d.defaultPerGuest}</td>
                  <td className="num text-end">{d.yieldPortions} מנות</td>
                  <td>{d.recipeLines ? <Badge tone="info">{d.recipeLines} רכיבים</Badge> : <Badge tone="warn">חסר מתכון</Badge>}</td>
                  <td className="text-sm">{d.allergens || '—'}</td>
                  {auth.margins && <td className="num text-end">{costs.data?.[d.id]?.perPortion ? formatMoney(costs.data[d.id].perPortion) : '—'}{costs.data?.[d.id]?.unpriced ? <Badge tone="warn" className="ms-1">חסר מחיר</Badge> : null}</td>}
                  <td>{canEdit && <Button size="sm" variant="ghost" aria-label={`עריכת ${d.name}`} onClick={() => setEdit(d.id)}><Pencil className="size-4" /></Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </QueryView>
      {edit && <DishDialog id={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </Card>
  );
}

function DishDialog({ id, onClose }: { id: number | null; onClose: () => void }) {
  const dq = useQuery({ queryKey: ['catalog', 'dish', id], queryFn: () => api.get<DishRecord>(`/catalog/dishes/${id}`), enabled: id !== null });
  const items = useQuery({ queryKey: ['catalog', 'items'], queryFn: () => api.get<ItemRecord[]>('/catalog/items') });
  if (id !== null && dq.isLoading) return <Dialog open onClose={onClose} title="טוען"><Loading /></Dialog>;
  return <DishForm dish={dq.data ?? null} items={items.data ?? []} onClose={onClose} />;
}

function DishForm({ dish, items, onClose }: { dish: DishRecord | null; items: ItemRecord[]; onClose: () => void }) {
  const settings = useSettings();
  const [v, setV] = useState({
    name: dish?.name ?? '', category: dish?.category ?? settings.lists.dishCategories[2] ?? settings.lists.dishCategories[0], description: dish?.description ?? '', allergens: dish?.allergens ?? '',
    isVegetarian: !!dish?.isVegetarian, isVegan: !!dish?.isVegan, defaultPerGuest: dish?.defaultPerGuest ?? 1, yieldPortions: dish?.yieldPortions ?? 10,
    prepLeadDays: dish?.prepLeadDays ?? 0, active: dish ? !!dish.active : true,
  });
  const [recipe, setRecipe] = useState<{ itemId: string; qty: string }[]>(dish?.recipe?.map((r) => ({ itemId: String(r.itemId), qty: String(r.qty) })) ?? []);
  const body = () => ({ ...v, recipe: recipe.filter((r) => r.itemId && Number(r.qty) > 0).map((r) => ({ itemId: Number(r.itemId), qty: Number(r.qty) })), ...(dish ? { version: dish.version } : {}) });
  const save = useAction(() => (dish ? api.put(`/catalog/dishes/${dish.id}`, body()) : api.post('/catalog/dishes', body())), { success: 'המנה נשמרה', invalidate: [['catalog'], ['kitchen']], onSuccess: onClose });
  const allergenSet = new Set(v.allergens.split(',').map((x) => x.trim()).filter(Boolean));
  const toggleAllergen = (a: string) => { const n = new Set(allergenSet); if (n.has(a)) n.delete(a); else n.add(a); setV({ ...v, allergens: [...n].join(', ') }); };
  const food = items.filter((i) => i.active && (i.kind === 'food' || i.kind === 'consumable'));
  return (
    <Dialog open onClose={onClose} size="lg" title={dish ? `עריכת ${dish.name}` : 'מנה חדשה'} footer={<><Button onClick={onClose}>ביטול</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>שמירה</Button></>}>
      <div className="space-y-5">
        <FormError message={save.error?.message} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="שם המנה" required className="sm:col-span-2" error={save.error?.fields.name}>{(p) => <Input {...p} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
          <Field label="קטגוריה">{(p) => <Select {...p} value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })} options={[...new Set([...settings.lists.dishCategories, v.category])].map((c) => ({ value: c, label: c }))} />}</Field>
          <Field label="מנות לאורח (ברירת מחדל)" hint="1 = מנה לכל אורח; 0.5 = חצי מהאורחים">{(p) => <NumberInput {...p} step="0.05" value={v.defaultPerGuest} onChange={(x) => setV({ ...v, defaultPerGuest: x ?? 0 })} />}</Field>
          <Field label="תפוקת המתכון (מנות)" required error={save.error?.fields.yieldPortions}>{(p) => <NumberInput {...p} value={v.yieldPortions} onChange={(x) => setV({ ...v, yieldPortions: x ?? 0 })} />}</Field>
          <Field label="ימי הכנה מראש">{(p) => <NumberInput {...p} value={v.prepLeadDays} onChange={(x) => setV({ ...v, prepLeadDays: x ?? 0 })} />}</Field>
          <Field label="תיאור" className="sm:col-span-3">{(p) => <Textarea {...p} rows={2} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />}</Field>
        </div>
        <fieldset>
          <legend className="label">אלרגנים</legend>
          <div className="flex flex-wrap gap-1.5">
            {ALLERGENS.map((a) => (
              <button key={a} type="button" aria-pressed={allergenSet.has(a)} onClick={() => toggleAllergen(a)}
                className={`h-8 rounded-full border px-3 text-xs font-semibold ${allergenSet.has(a) ? 'border-[var(--color-danger)] bg-[var(--color-danger-soft)] text-[var(--color-danger)]' : 'border-[var(--color-border-strong)]'}`}>{a}</button>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap gap-4">
          <Checkbox label="צמחוני" checked={v.isVegetarian} onChange={(c) => setV({ ...v, isVegetarian: c })} />
          <Checkbox label="טבעוני" checked={v.isVegan} onChange={(c) => setV({ ...v, isVegan: c, isVegetarian: c || v.isVegetarian })} />
          <Checkbox label="פעילה בקטלוג" checked={v.active} onChange={(c) => setV({ ...v, active: c })} />
        </div>
        <div>
          <h3 className="mb-1 text-sm font-bold">מתכון – כמות לכל {v.yieldPortions} מנות</h3>
          <p className="mb-2 text-xs text-[var(--color-muted)]">המערכת מחשבת חומרי גלם לאירוע: מנות ÷ תפוקה × כמות.</p>
          <ul className="space-y-2">
            {recipe.map((r, i) => {
              const it = items.find((x) => String(x.id) === r.itemId);
              return (
                <li key={i} className="flex items-center gap-2">
                  <Select aria-label="רכיב" value={r.itemId} onChange={(e) => setRecipe((x) => x.map((y, j) => (j === i ? { ...y, itemId: e.target.value } : y)))} placeholder="רכיב…" options={food.map((f) => ({ value: f.id, label: f.name }))} className="w-64" />
                  <input aria-label="כמות" type="number" min={0} step="any" className="input num w-28" value={r.qty} onChange={(e) => setRecipe((x) => x.map((y, j) => (j === i ? { ...y, qty: e.target.value } : y)))} />
                  <span className="w-12 text-sm text-[var(--color-muted)]">{it?.unit}</span>
                  <button onClick={() => setRecipe((x) => x.filter((_, j) => j !== i))} className="p-1 text-[var(--color-danger)]" aria-label="הסרה"><Trash2 className="size-4" /></button>
                </li>
              );
            })}
          </ul>
          <Button size="sm" className="mt-2" icon={<Plus className="size-4" />} onClick={() => setRecipe((x) => [...x, { itemId: '', qty: '' }])}>רכיב</Button>
        </div>
      </div>
    </Dialog>
  );
}

function Items() {
  const auth = useAuth();
  const q = useQuery({ queryKey: ['catalog', 'items'], queryFn: () => api.get<ItemRecord[]>('/catalog/items') });
  const [edit, setEdit] = useState<ItemRecord | 'new' | null>(null);
  const [kind, setKind] = useState('');
  const canEdit = auth.can('catalog', 2);
  return (
    <Card bodyClass="p-0" title="פריטים" actions={<>
      <Select aria-label="סוג" value={kind} onChange={(e) => setKind(e.target.value)} placeholder="כל הסוגים" options={optionsOf(ITEM_KIND)} className="h-8 w-36 py-0 text-sm" />
      {canEdit && <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit('new')}>פריט</Button>}
    </>}>
      <QueryView q={q}>
        {(list) => (
          <table className="table">
            <thead><tr><th>פריט</th><th>סוג</th><th>יחידה</th><th>קטגוריה</th><th>ספק ברירת מחדל</th><th className="text-end">מלאי מינימום</th><th className="text-end">מחיר ליחידה</th><th /></tr></thead>
            <tbody>
              {list.filter((i) => !kind || i.kind === kind).map((i) => (
                <tr key={i.id} className={i.active ? '' : 'opacity-50'}>
                  <td className="font-semibold">{i.name}</td><td>{ITEM_KIND[i.kind]}</td><td>{i.unit}</td><td>{i.category}</td><td>{i.supplierName ?? '—'}</td><td className="num text-end">{i.minStock || '—'}</td><td className="num text-end">{i.unitCost ? formatMoney(i.unitCost) : '—'}</td>
                  <td>{canEdit && <Button size="sm" variant="ghost" aria-label={`עריכת ${i.name}`} onClick={() => setEdit(i)}><Pencil className="size-4" /></Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </QueryView>
      {edit && <ItemDialog item={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </Card>
  );
}

function ItemDialog({ item, onClose }: { item: ItemRecord | null; onClose: () => void }) {
  const settings = useSettings();
  const suppliers = useQuery({ queryKey: ['purchasing', 'suppliers'], queryFn: () => api.get<SupplierRecord[]>('/purchasing/suppliers') });
  const [v, setV] = useState({ name: item?.name ?? '', kind: item?.kind ?? 'food', unit: item?.unit ?? 'ק״ג', category: item?.category ?? '', supplierId: item?.supplierId ? String(item.supplierId) : '', minStock: item?.minStock ?? 0, unitCost: item?.unitCost ?? 0, ownedQty: item?.ownedQty ?? 0, active: item ? !!item.active : true });
  const body = () => ({ ...v, supplierId: v.supplierId ? Number(v.supplierId) : null });
  const save = useAction(() => (item ? api.put(`/catalog/items/${item.id}`, body()) : api.post('/catalog/items', body())), { success: 'הפריט נשמר', invalidate: [['catalog'], ['inventory']], onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} title={item ? `עריכת ${item.name}` : 'פריט חדש'} footer={<><Button onClick={onClose}>ביטול</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>שמירה</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><FormError message={save.error?.message} /></div>
        <Field label="שם" required error={save.error?.fields.name}>{(p) => <Input {...p} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
        <Field label="סוג">{(p) => <Select {...p} value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as never })} options={optionsOf(ITEM_KIND)} />}</Field>
        <Field label="יחידה">{(p) => <Select {...p} value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value })} options={[...new Set([...settings.lists.units, v.unit])].map((u) => ({ value: u, label: u }))} />}</Field>
        <Field label="קטגוריה">{(p) => <Input {...p} value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })} />}</Field>
        <Field label="ספק ברירת מחדל">{(p) => <Select {...p} value={v.supplierId} onChange={(e) => setV({ ...v, supplierId: e.target.value })} placeholder="ללא" options={(suppliers.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />}</Field>
        <Field label="מלאי מינימום">{(p) => <NumberInput {...p} value={v.minStock} onChange={(x) => setV({ ...v, minStock: x ?? 0 })} />}</Field>
        <Field label={`מחיר ל${v.unit}`} hint="מתעדכן אוטומטית מהמחיר האחרון בהזמנת רכש" error={save.error?.fields.unitCost}>{(p) => <MoneyInput {...p} value={v.unitCost} onChange={(x) => setV({ ...v, unitCost: x ?? 0 })} />}</Field>
        {v.kind === 'equipment' && <Field label="כמות בבעלות" hint="לבדיקת התנגשויות בין אירועים באותו יום">{(p) => <NumberInput {...p} value={v.ownedQty} onChange={(x) => setV({ ...v, ownedQty: x ?? 0 })} />}</Field>}
        <Checkbox label="פעיל" checked={v.active} onChange={(c) => setV({ ...v, active: c })} />
      </div>
    </Dialog>
  );
}

interface Template { id: number; venue: keyof typeof VENUE_LABEL; eventType: string; itemId: number; itemName: string; unit: string; kind: string; perGuest: number; fixedQty: number }

function Templates() {
  const auth = useAuth();
  const q = useQuery({ queryKey: ['catalog', 'templates'], queryFn: () => api.get<Template[]>('/catalog/equipment-templates') });
  const items = useQuery({ queryKey: ['catalog', 'items'], queryFn: () => api.get<ItemRecord[]>('/catalog/items') });
  const canEdit = auth.can('equipment', 3);
  const equipVenues = VENUE_CODES.filter((x) => VENUE_RULES[x]?.equipment !== 'none');
  const [v, setV] = useState({ venue: equipVenues[0] ?? '', eventType: '*', itemId: '', perGuest: 0 as number | null, fixedQty: 0 as number | null });
  const add = useAction(() => api.post('/catalog/equipment-templates', { ...v, itemId: Number(v.itemId), perGuest: v.perGuest ?? 0, fixedQty: v.fixedQty ?? 0 }), { success: 'נוסף לתבנית', invalidate: [['catalog', 'templates']] });
  const del = useAction((id: number) => api.del(`/catalog/equipment-templates/${id}`), { invalidate: [['catalog', 'templates']] });
  return (
    <div className="space-y-5">
      {canEdit && (
        <Card title="הוספה לתבנית">
          <FormError message={add.error?.message} />
          <div className="flex flex-wrap items-end gap-3">
            <Field label="נקודה" className="w-40">{(p) => <Select {...p} value={v.venue} onChange={(e) => setV({ ...v, venue: e.target.value })} options={equipVenues.map((x) => ({ value: x, label: VENUE_LABEL[x] }))} />}</Field>
            <Field label="סוג אירוע" className="w-40">{(p) => <Select {...p} value={v.eventType} onChange={(e) => setV({ ...v, eventType: e.target.value })} options={[{ value: '*', label: 'כל הסוגים' }, ...optionsOf(EVENT_TYPES)]} />}</Field>
            <Field label="פריט" className="w-60">{(p) => <Select {...p} value={v.itemId} onChange={(e) => setV({ ...v, itemId: e.target.value })} placeholder="בחירה…" options={(items.data ?? []).filter((i) => i.kind !== 'food').map((i) => ({ value: i.id, label: i.name }))} />}</Field>
            <Field label="לאורח" className="w-24">{(p) => <NumberInput {...p} step="0.1" value={v.perGuest} onChange={(x) => setV({ ...v, perGuest: x })} />}</Field>
            <Field label="כמות קבועה" className="w-28">{(p) => <NumberInput {...p} value={v.fixedQty} onChange={(x) => setV({ ...v, fixedQty: x })} />}</Field>
            <Button variant="primary" disabled={!v.itemId} loading={add.isPending} onClick={() => add.mutate(undefined)}>הוספה</Button>
          </div>
          <p className="mt-2 text-xs text-[var(--color-muted)]">מוצגות רק נקודות שבהן הקייטרינג מביא ציוד (מוגדר בהגדרות הנקודה).</p>
        </Card>
      )}
      <QueryView q={q} empty={(l) => (l.length ? null : <Card><EmptyState title="אין תבניות" /></Card>)}>
        {(list) => (
          <div className="grid gap-5 lg:grid-cols-3">
            {equipVenues.map((venue) => (
              <Card key={venue} title={VENUE_LABEL[venue]} bodyClass="p-0">
                <table className="table">
                  <thead><tr><th>פריט</th><th>סוג אירוע</th><th className="text-end">כמות</th>{canEdit && <th />}</tr></thead>
                  <tbody>
                    {list.filter((t) => t.venue === venue).map((t) => (
                      <tr key={t.id}>
                        <td className="font-semibold">{t.itemName}</td>
                        <td className="text-sm">{t.eventType === '*' ? 'הכול' : EVENT_TYPES[t.eventType as keyof typeof EVENT_TYPES]}</td>
                        <td className="num text-end text-sm">{[t.perGuest ? `${t.perGuest} לאורח` : '', t.fixedQty ? `+${t.fixedQty}` : ''].filter(Boolean).join(' ')}</td>
                        {canEdit && <td><button onClick={() => del.mutate(t.id)} className="p-1 text-[var(--color-danger)]" aria-label="הסרה"><Trash2 className="size-4" /></button></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ))}
          </div>
        )}
      </QueryView>
    </div>
  );
}
