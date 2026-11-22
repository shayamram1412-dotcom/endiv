/**
 * Menu builder used at the tasting: add dishes, per-guest factor or fixed count, audience (kids / veg / vegan),
 * dietary instructions; approve on the spot. After approval every change creates a version with a diff
 * and the kitchen and event manager each confirm receipt.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, CheckCircle2, ChevronUp, ChevronDown, Save, CalendarPlus, History } from 'lucide-react';
import clsx from 'clsx';
import { api, ApiError } from '../../../lib/api.ts';
import { useAction } from '../../../lib/query.ts';
import { useAuth } from '../../../lib/auth.tsx';
import { UnsavedGuard } from '../../../lib/useEditForm.tsx';
import { useToast } from '../../../ui/Toast.tsx';
import { Card, EmptyState, Loading, ErrorState } from '../../../ui/layout.tsx';
import { Button } from '../../../ui/Button.tsx';
import { Badge } from '../../../ui/Badge.tsx';
import { Field, FormError, Input, NumberInput, Select, Textarea, optionsOf } from '../../../ui/form.tsx';
import { AUDIENCE, DIETARY_KIND, type Audience, type DietaryKind } from '@shared/domain.ts';
import { ROLES } from '@shared/permissions.ts';
import { formatDay, formatTs } from '@shared/dates.ts';
import { portionsFor, DEFAULT_FACTORS } from '@shared/kitchen.ts';
import type { DishRecord, EventDetail, MeetingRecord, MenuView } from '@shared/types.ts';
import { MeetingDialog } from './SalesTab.tsx';

interface Line { dishId: number; dishName: string; category: string; allergens: string; audience: Audience; perGuest: number; qtyOverride: number | null; notes: string }
interface Diet { kind: DietaryKind; count: number; description: string }

export function MenuTab({ d }: { d: EventDetail }) {
  const ev = d.event;
  const qc = useQueryClient();
  const toast = useToast();
  const auth = useAuth();
  const menuQ = useQuery({ queryKey: ['event', ev.id, 'menu'], queryFn: () => api.get<MenuView>(`/events/${ev.id}/menu`) });
  const dishesQ = useQuery({ queryKey: ['catalog', 'dishes'], queryFn: () => api.get<DishRecord[]>('/catalog/dishes') });
  const settingsQ = useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ kitchen: typeof DEFAULT_FACTORS }>('/admin/settings') });
  const clientQ = useQuery({ queryKey: ['client', ev.clientId], enabled: !!ev.clientId && d.access.clients >= 1, queryFn: () => api.get<{ meetings: MeetingRecord[] }>(`/clients/${ev.clientId}`) });
  const tastings = (clientQ.data?.meetings ?? []).filter((m) => m.eventId === ev.id && m.kind === 'tasting');

  const [lines, setLines] = useState<Line[]>([]);
  const [diet, setDiet] = useState<Diet[]>([]);
  const [counts, setCounts] = useState({ kids: ev.kids, vegetarian: ev.vegetarian, vegan: ev.vegan });
  const [reason, setReason] = useState('');
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const [pick, setPick] = useState('');
  const [tastingOpen, setTastingOpen] = useState(false);
  const [showVersions, setShowVersions] = useState(false);

  useEffect(() => {
    if (!menuQ.data || dirty) return;
    setLines(menuQ.data.lines.map((l) => ({ dishId: l.dishId, dishName: l.dishName, category: l.category, allergens: l.allergens, audience: l.audience, perGuest: l.perGuest, qtyOverride: l.qtyOverride, notes: l.notes })));
    setDiet(menuQ.data.dietary.map((x) => ({ kind: x.kind, count: x.count, description: x.description })));
    setCounts({ kids: ev.kids, vegetarian: ev.vegetarian, vegan: ev.vegan });
  }, [menuQ.data, dirty, ev.kids, ev.vegetarian, ev.vegan]);

  const canEdit = d.access.menu >= 2 && ev.lifecycle === 'planning';
  const canApprove = d.access.menu >= 3;
  const approved = ev.menuStatus === 'approved' || ev.menuStatus === 'changed';
  const factors = settingsQ.data?.kitchen ?? DEFAULT_FACTORS;
  const guestCounts = { guests: ev.guests, kids: counts.kids, vegetarian: counts.vegetarian, vegan: counts.vegan };
  const touch = () => setDirty(true);
  const updLine = (i: number, p: Partial<Line>) => { setLines((l) => l.map((x, j) => (j === i ? { ...x, ...p } : x))); touch(); };
  const move = (i: number, dir: -1 | 1) => { setLines((l) => { const n = [...l]; const [x] = n.splice(i, 1); n.splice(i + dir, 0, x); return n; }); touch(); };

  const dishOptions = useMemo(() => {
    const byCat = new Map<string, DishRecord[]>();
    for (const dsh of dishesQ.data ?? []) if (dsh.active) byCat.set(dsh.category, [...(byCat.get(dsh.category) ?? []), dsh]);
    return byCat;
  }, [dishesQ.data]);

  const addDish = (id: number) => {
    const dsh = dishesQ.data?.find((x) => x.id === id);
    if (!dsh) return;
    const audience: Audience = dsh.category === 'ילדים' ? 'kids' : dsh.isVegan && dsh.defaultPerGuest === 0 ? 'vegan' : 'all';
    setLines((l) => [...l, { dishId: dsh.id, dishName: dsh.name, category: dsh.category, allergens: dsh.allergens, audience, perGuest: dsh.defaultPerGuest || 1, qtyOverride: null, notes: '' }]);
    setPick('');
    touch();
  };

  const save = async (approve: boolean) => {
    setSaving(true); setError(null);
    try {
      const r = await api.put<{ versioned: number | null }>(`/events/${ev.id}/menu`, {
        eventVersion: menuQ.data!.eventVersion, approve, reason,
        lines: lines.map((l) => ({ dishId: l.dishId, audience: l.audience, perGuest: l.perGuest, qtyOverride: l.qtyOverride, notes: l.notes })),
        dietary: diet, ...counts,
      });
      setDirty(false); setReason('');
      toast.success(r.versioned ? (approved ? `נשמרה גרסה ${r.versioned}. המטבח ומנהל האירוע יתבקשו לאשר קבלה` : 'התפריט אושר') : 'התפריט נשמר כטיוטה');
      await qc.invalidateQueries({ queryKey: ['event', ev.id] });
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
      if (e instanceof ApiError && e.details?.stale) toast.error('התפריט עודכן על ידי משתמש אחר – רענן לפני השמירה');
    } finally { setSaving(false); }
  };

  const meeting = useAction(({ id, status }: { id: number; status: string }) => api.patch(`/meetings/${id}`, { status }), { success: 'הטעימות עודכנו', invalidate: [['client'], ['event', ev.id], ['calendar'], ['tasks']] });
  const ack = useAction((role: 'kitchen' | 'event_manager') => api.post(`/events/${ev.id}/menu/ack`, { role }), { success: 'אישור הקבלה נרשם', invalidate: [['event', ev.id], ['tasks'], ['dashboard']] });

  if (menuQ.isLoading) return <Loading rows={6} />;
  if (menuQ.error) return <ErrorState error={menuQ.error} retry={() => menuQ.refetch()} />;
  const m = menuQ.data!;
  const current = m.versions.find((v) => v.version === m.version);
  const pendingAcks = current?.acks.filter((a) => !a.ackedAt) ?? [];

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
      <UnsavedGuard when={dirty} />
      <div className="space-y-5">
        {ev.menuStatus === 'changed' && current && (
          <div role="alert" className="rounded-[14px] border-2 border-[var(--color-danger)] bg-[var(--color-danger-soft)] p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <strong className="text-[var(--color-danger)]">שינוי בתפריט מאושר – גרסה {current.version}</strong>
              <span className="text-sm">{current.approvedByName} · {formatTs(current.approvedAt)}{current.reason ? ` · ${current.reason}` : ''}</span>
            </div>
            <ChangeList changes={current.changes} />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {current.acks.map((a) => (
                <Badge key={a.role} tone={a.ackedAt ? 'ok' : 'warn'}>{ROLES[a.role]}: {a.ackedAt ? `התקבל (${a.userName}, ${formatTs(a.ackedAt)})` : 'ממתין לאישור קבלה'}</Badge>
              ))}
              {pendingAcks.filter((a) => auth.hasRole(a.role, ev.venue) || auth.supervisor).map((a) => (
                <Button key={a.role} size="sm" variant="primary" icon={<CheckCircle2 className="size-4" />} loading={ack.isPending && ack.variables === a.role} onClick={() => ack.mutate(a.role as 'kitchen' | 'event_manager')}>
                  אישור קבלה – {ROLES[a.role]}
                </Button>
              ))}
            </div>
          </div>
        )}

        <Card title="תפריט האירוע" actions={<>
          <Badge tone={approved ? 'ok' : 'warn'}>{approved ? `מאושר · גרסה ${m.version}` : ev.menuStatus === 'draft' ? 'טיוטה' : 'טרם נקבע'}</Badge>
        </>} bodyClass="p-0">
          {lines.length === 0 ? (
            <EmptyState title="לא נבחרו מנות" text="אפשר להתחיל לתכנן גם כשהתפריט הסופי עדיין פתוח." />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>מנה</th><th>קהל</th><th>לאורח</th><th>כמות קבועה</th><th className="text-end">מנות</th><th>הנחיות</th>{canEdit && <th><span className="sr-only">פעולות</span></th>}</tr></thead>
                <tbody>
                  {lines.map((l, i) => {
                    const portions = portionsFor(l, guestCounts, ev.eventType, factors);
                    return (
                      <tr key={`${l.dishId}-${l.audience}-${i}`}>
                        <td className="min-w-44">
                          <div className="font-semibold">{l.dishName}</div>
                          <div className="text-xs text-[var(--color-muted)]">{l.category}{l.allergens ? ` · אלרגנים: ${l.allergens}` : ''}</div>
                        </td>
                        <td><Select aria-label="קהל" disabled={!canEdit} value={l.audience} onChange={(e) => updLine(i, { audience: e.target.value as Audience })} options={optionsOf(AUDIENCE)} className="w-32" /></td>
                        <td><input aria-label="מנות לאורח" type="number" step="0.05" min={0} disabled={!canEdit || l.qtyOverride !== null} className="input num w-20" value={l.perGuest} onChange={(e) => updLine(i, { perGuest: Number(e.target.value) })} /></td>
                        <td><input aria-label="כמות קבועה" type="number" min={0} disabled={!canEdit} placeholder="—" className="input num w-24" value={l.qtyOverride ?? ''} onChange={(e) => updLine(i, { qtyOverride: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                        <td className="num text-end text-base font-bold">{portions}</td>
                        <td><input aria-label="הנחיות למנה" disabled={!canEdit} className="input min-w-40" value={l.notes} onChange={(e) => updLine(i, { notes: e.target.value })} placeholder="למשל: ללא אגוזים" /></td>
                        {canEdit && (
                          <td className="whitespace-nowrap">
                            <button className="p-1 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="העלאה"><ChevronUp className="size-4" /></button>
                            <button className="p-1 disabled:opacity-30" disabled={i === lines.length - 1} onClick={() => move(i, 1)} aria-label="הורדה"><ChevronDown className="size-4" /></button>
                            <button className="p-1 text-[var(--color-danger)]" onClick={() => { setLines((x) => x.filter((_, j) => j !== i)); touch(); }} aria-label={`הסרת ${l.dishName}`}><Trash2 className="size-4" /></button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] p-3">
              <label htmlFor="add-dish" className="text-sm font-semibold">הוספת מנה</label>
              <select id="add-dish" className="input w-72" value={pick} onChange={(e) => { setPick(e.target.value); if (e.target.value) addDish(Number(e.target.value)); }}>
                <option value="">בחירה מהקטלוג…</option>
                {[...dishOptions.entries()].map(([cat, ds]) => (
                  <optgroup key={cat} label={cat}>{ds.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>
                ))}
              </select>
              <span className="text-xs text-[var(--color-muted)]">מנות = קהל × לאורח × מקדם סוג האירוע + {factors.bufferPct}% מרווח. כמות קבועה גוברת על החישוב.</span>
            </div>
          )}
        </Card>

        <Card title="הנחיות תזונתיות, אלרגיות וכשרות">
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <Field label="ילדים">{(p) => <NumberInput {...p} disabled={!canEdit} value={counts.kids} onChange={(v) => { setCounts((c) => ({ ...c, kids: v ?? 0 })); touch(); }} />}</Field>
            <Field label="צמחונים">{(p) => <NumberInput {...p} disabled={!canEdit} value={counts.vegetarian} onChange={(v) => { setCounts((c) => ({ ...c, vegetarian: v ?? 0 })); touch(); }} />}</Field>
            <Field label="טבעונים">{(p) => <NumberInput {...p} disabled={!canEdit} value={counts.vegan} onChange={(v) => { setCounts((c) => ({ ...c, vegan: v ?? 0 })); touch(); }} />}</Field>
          </div>
          <ul className="space-y-2">
            {diet.map((x, i) => (
              <li key={i} className="grid grid-cols-[140px_90px_1fr_auto] items-center gap-2">
                <Select aria-label="סוג" disabled={!canEdit} value={x.kind} onChange={(e) => { setDiet((l) => l.map((y, j) => (j === i ? { ...y, kind: e.target.value as DietaryKind } : y))); touch(); }} options={optionsOf(DIETARY_KIND)} />
                <input aria-label="מספר סועדים" type="number" min={0} disabled={!canEdit} className="input num" value={x.count} onChange={(e) => { setDiet((l) => l.map((y, j) => (j === i ? { ...y, count: Number(e.target.value) } : y))); touch(); }} />
                <input aria-label="תיאור" disabled={!canEdit} className="input" value={x.description} placeholder="פירוט (למשל: אלרגיה לבוטנים – שולחן 12)" onChange={(e) => { setDiet((l) => l.map((y, j) => (j === i ? { ...y, description: e.target.value } : y))); touch(); }} />
                {canEdit && <button onClick={() => { setDiet((l) => l.filter((_, j) => j !== i)); touch(); }} className="p-1 text-[var(--color-danger)]" aria-label="הסרה"><Trash2 className="size-4" /></button>}
              </li>
            ))}
          </ul>
          {canEdit && <Button size="sm" className="mt-3" icon={<Plus className="size-4" />} onClick={() => { setDiet((l) => [...l, { kind: 'allergy', count: 1, description: '' }]); touch(); }}>הוספת הנחיה</Button>}
          {!diet.length && !canEdit && <p className="text-sm text-[var(--color-muted)]">אין הנחיות מיוחדות.</p>}
        </Card>

        {canEdit && (dirty || !approved) && (
          <div className="card sticky bottom-3 z-10 space-y-3 p-4 shadow-[var(--shadow-pop)]">
            {error && <FormError message={error.message} />}
            {approved && dirty && (
              <Field label="סיבת השינוי" required error={error?.fields.reason} hint="שינוי בתפריט מאושר יוצר גרסה חדשה ומבקש אישור קבלה מהמטבח וממנהל האירוע">
                {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="למשל: הלקוח הוסיף 6 טבעונים" />}
              </Field>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              {dirty && <Button onClick={() => { setDirty(false); setError(null); }}>ביטול שינויים</Button>}
              {!approved && <Button icon={<Save className="size-4" />} loading={saving} disabled={!dirty} onClick={() => void save(false)}>שמירת טיוטה</Button>}
              {approved
                ? <Button variant="primary" icon={<Save className="size-4" />} loading={saving} disabled={!dirty} onClick={() => void save(false)}>שמירת שינוי ושליחה לאישור קבלה</Button>
                : canApprove && <Button variant="primary" icon={<CheckCircle2 className="size-4" />} loading={saving} disabled={!lines.length} onClick={() => void save(true)}>אישור התפריט</Button>}
            </div>
          </div>
        )}
      </div>

      <aside className="space-y-5">
        <Card title="טעימות" actions={d.access.menu >= 2 && (ev.salesStatus === 'signed' || ev.salesStatus === 'hall') && <Button size="sm" icon={<CalendarPlus className="size-4" />} onClick={() => setTastingOpen(true)}>תיאום</Button>}>
          {ev.salesStatus !== 'signed' && ev.salesStatus !== 'hall' ? <p className="text-sm text-[var(--color-muted)]">הטעימות מתקיימות לאחר חתימת החוזה.</p>
            : tastings.length ? (
              <ul className="space-y-2 text-sm">
                {tastings.map((t) => (
                  <li key={t.id} className="flex items-center justify-between">
                    <span><strong>{formatDay(t.date)} {t.time}</strong> · {t.managerName ?? 'ללא מנהל'}</span>
                    <span className="flex items-center gap-1">
                      <Badge tone={t.status === 'done' ? 'ok' : t.status === 'cancelled' ? 'neutral' : 'info'}>{t.status === 'done' ? 'התקיימו' : t.status === 'cancelled' ? 'בוטלו' : 'מתוכננות'}</Badge>
                      {t.status === 'scheduled' && d.access.menu >= 2 && <>
                        <button className="text-xs font-semibold text-[var(--color-brand)] hover:underline" onClick={() => meeting.mutate({ id: t.id, status: 'done' })}>התקיימו</button>
                        <button className="text-xs text-[var(--color-muted)] hover:underline" onClick={() => meeting.mutate({ id: t.id, status: 'cancelled' })}>ביטול</button>
                      </>}
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-[var(--color-muted)]">טרם תואמו טעימות.</p>}
        </Card>
        <Card title="גרסאות התפריט" actions={m.versions.length > 0 && <Button size="sm" variant="ghost" icon={<History className="size-4" />} onClick={() => setShowVersions((s) => !s)}>{showVersions ? 'הסתרה' : 'הצגה'}</Button>}>
          {!m.versions.length ? <p className="text-sm text-[var(--color-muted)]">טרם אושרה גרסה.</p> : (
            <ol className="space-y-3">
              {(showVersions ? m.versions : m.versions.slice(0, 1)).map((v) => (
                <li key={v.id} className="rounded-[10px] border border-[var(--color-border)] p-3">
                  <div className="flex items-center justify-between text-sm"><strong>גרסה {v.version}</strong><span className="text-xs text-[var(--color-muted)]">{formatTs(v.approvedAt)}</span></div>
                  <div className="mb-1 text-xs text-[var(--color-muted)]">{v.approvedByName}{v.reason ? ` · ${v.reason}` : ''}</div>
                  <ChangeList changes={v.changes} />
                  {v.acks.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{v.acks.map((a) => <Badge key={a.role} tone={a.ackedAt ? 'ok' : 'warn'}>{ROLES[a.role]} {a.ackedAt ? '✓' : '…'}</Badge>)}</div>}
                </li>
              ))}
            </ol>
          )}
        </Card>
      </aside>
      {tastingOpen && <MeetingDialog kind="tasting" eventId={ev.id} venue={ev.venue} maxDate={ev.date} onClose={() => setTastingOpen(false)} />}
    </div>
  );
}

function ChangeList({ changes }: { changes: { type: string; label: string; before?: string; after?: string }[] }) {
  if (!changes.length) return <p className="text-xs text-[var(--color-muted)]">ללא שינוי בתוכן</p>;
  return (
    <ul className="space-y-1 text-sm">
      {changes.map((c, i) => (
        <li key={i} className="flex flex-wrap gap-1">
          <span className={clsx('font-bold', c.type === 'added' ? 'text-[var(--color-ok)]' : c.type === 'removed' ? 'text-[var(--color-danger)]' : 'text-[var(--color-warn)]')}>
            {c.type === 'added' ? '+ נוסף' : c.type === 'removed' ? '− הוסר' : '~ שונה'}:
          </span>
          <span className="font-semibold">{c.label}</span>
          {c.before && c.type === 'changed' && <span className="text-[var(--color-muted)] line-through">{c.before}</span>}
          {(c.after || (c.type === 'removed' && c.before)) && <span>{c.type === 'removed' ? '' : `→ ${c.after}`}</span>}
        </li>
      ))}
    </ul>
  );
}

