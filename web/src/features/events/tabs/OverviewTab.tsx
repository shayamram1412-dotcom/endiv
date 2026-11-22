import { AvailabilityNote } from '../Availability.tsx';
import { Link } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, Save, Undo2, Ban, Lock, RotateCcw } from 'lucide-react';
import { api } from '../../../lib/api.ts';
import { useAction } from '../../../lib/query.ts';
import { useAuth, useDirectory, usersWithRole } from '../../../lib/auth.tsx';
import { useEditForm, ConflictPanel, UnsavedGuard } from '../../../lib/useEditForm.tsx';
import { useSettings } from '../../../lib/settings.ts';
import { useToast } from '../../../ui/Toast.tsx';
import { Card } from '../../../ui/layout.tsx';
import { Button } from '../../../ui/Button.tsx';
import { Badge } from '../../../ui/Badge.tsx';
import { Dialog } from '../../../ui/Dialog.tsx';
import { Field, FormError, Input, NumberInput, Select, Textarea, optionsOf } from '../../../ui/form.tsx';
import { EVENT_TYPES, INTAKE_STATUS, KOSHER, VENUE_EVENT_TYPES, VENUE_RULES, WORK_STAGES, WORK_STAGE_ORDER } from '@shared/domain.ts';
import { ROLES } from '@shared/permissions.ts';
import { formatTs } from '@shared/dates.ts';
import type { EventDetail, EventRecord } from '@shared/types.ts';

type Editable = Pick<EventRecord, 'title' | 'eventType' | 'serviceKind' | 'date' | 'startTime' | 'endTime' | 'deliveryTime' | 'guests' | 'kids' | 'vegetarian' | 'vegan' | 'menuType' | 'kosher' | 'address' | 'siteContactName' | 'siteContactPhone' | 'siteRequirements' | 'specialRequests' | 'notes' | 'salesRepId' | 'eventManagerId' | 'kitchenManagerId' | 'brandManagerId' | 'hallContactName' | 'hallContactPhone' | 'intakeMissing' | 'ubeyaRef' | 'workStage' | 'checkpointMinutes'>;

const pickEditable = (e: EventRecord): Editable => ({
  title: e.title, eventType: e.eventType, serviceKind: e.serviceKind, date: e.date, startTime: e.startTime, endTime: e.endTime, deliveryTime: e.deliveryTime,
  guests: e.guests, kids: e.kids, vegetarian: e.vegetarian, vegan: e.vegan, menuType: e.menuType, kosher: e.kosher, address: e.address,
  siteContactName: e.siteContactName, siteContactPhone: e.siteContactPhone, siteRequirements: e.siteRequirements, specialRequests: e.specialRequests, notes: e.notes,
  salesRepId: e.salesRepId, eventManagerId: e.eventManagerId, kitchenManagerId: e.kitchenManagerId, brandManagerId: e.brandManagerId,
  hallContactName: e.hallContactName, hallContactPhone: e.hallContactPhone, intakeMissing: e.intakeMissing, ubeyaRef: e.ubeyaRef, workStage: e.workStage ?? null, checkpointMinutes: e.checkpointMinutes ?? null,
});

export function OverviewTab({ d }: { d: EventDetail }) {
  const ev = d.event;
  const qc = useQueryClient();
  const toast = useToast();
  const auth = useAuth();
  const dir = useDirectory();
  const source = useMemo(() => pickEditable(ev), [ev]);
  const f = useEditForm<Editable>(source);
  const [saving, setSaving] = useState(false);
  const rules = VENUE_RULES[ev.venue];
  const canEdit = d.access.events >= 2 && ev.lifecycle !== 'closed';
  const v = f.values ?? source;
  const menuLocked = ev.menuStatus === 'approved' || ev.menuStatus === 'changed';
  const settings = useSettings();
  const skipped: string[] = (() => { try { return JSON.parse(ev.readinessSkip || '[]'); } catch { return []; } })();
  const skip = useAction((next: string[]) => api.patch(`/events/${ev.id}`, { changes: { readinessSkip: next } }), { success: 'צ׳קליסט המוכנות של האירוע עודכן', invalidate: [['event', ev.id], ['events']] });

  const save = async (allowOverbook = false) => {
    setSaving(true);
    try {
      const r = await api.patch<{ event: EventRecord; changed: string[] }>(`/events/${ev.id}`, { changes: f.changes, base: f.base(), allowOverbook });
      f.saved(pickEditable(r.event));
      toast.success(r.changed.length ? 'השינויים נשמרו' : 'לא היו שינויים');
      await qc.invalidateQueries({ queryKey: ['event', ev.id] });
    } catch (e) {
      f.handleError(e);
    } finally {
      setSaving(false);
    }
  };

  const people = ([
    ['salesRepId', 'sales', rules.track === 'direct'],
    ['eventManagerId', 'event_manager', true],
    ['kitchenManagerId', 'kitchen', true],
    ['brandManagerId', 'brand', rules.track === 'hall'],
  ] as const).filter(([, , show]) => show);

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
      <UnsavedGuard when={f.dirty} />
      <div className="space-y-5">
        <ConflictPanel conflicts={f.conflicts} onResolve={f.resolve} />
        <FormError message={f.conflicts.length ? null : f.formError} />
        <Card title="פרטי האירוע" actions={canEdit && f.dirty && (
          <>
            <Button size="sm" variant="ghost" icon={<Undo2 className="size-4" />} onClick={f.discard}>ביטול שינויים</Button>
            <Button size="sm" variant="primary" icon={<Save className="size-4" />} loading={saving} onClick={() => void save()}>שמירה</Button>
          </>
        )}>
          <fieldset disabled={!canEdit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="כותרת" className="sm:col-span-2 lg:col-span-3" error={f.errors.title}>{(p) => <Input {...p} value={v.title} onChange={(e) => f.set('title', e.target.value)} />}</Field>
            <Field label="סוג אירוע">{(p) => <Select {...p} value={v.eventType} onChange={(e) => f.set('eventType', e.target.value as never)} options={VENUE_EVENT_TYPES[ev.venue].map((t) => ({ value: t, label: EVENT_TYPES[t] }))} />}</Field>
            <div>
              <Field label="תאריך" error={f.errors.date}>{(p) => <Input {...p} type="date" value={v.date} onChange={(e) => f.set('date', e.target.value)} />}</Field>
              {v.date !== ev.date && <AvailabilityNote venue={ev.venue} date={v.date} excludeId={ev.id} />}
              {f.errors.date?.includes('מלא') && auth.supervisor && <Button size="sm" variant="danger" className="mt-1" loading={saving} onClick={() => void save(true)}>לקבוע בכל זאת ביום הזה</Button>}
            </div>
            {rules.siteDetails && <Field label="סוג שירות">{(p) => <Select {...p} value={v.serviceKind} onChange={(e) => f.set('serviceKind', e.target.value as never)} options={[{ value: 'full', label: 'אירוע מלא' }, { value: 'platters', label: 'מגשים / מסירה' }]} />}</Field>}
            {v.serviceKind === 'platters' ? (
              <Field label="שעת מסירה" error={f.errors.deliveryTime}>{(p) => <Input {...p} type="time" value={v.deliveryTime} onChange={(e) => f.set('deliveryTime', e.target.value)} />}</Field>
            ) : (
              <>
                <Field label="שעת התחלה" error={f.errors.startTime}>{(p) => <Input {...p} type="time" value={v.startTime} onChange={(e) => f.set('startTime', e.target.value)} />}</Field>
                <Field label="שעת סיום" error={f.errors.endTime}>{(p) => <Input {...p} type="time" value={v.endTime} onChange={(e) => f.set('endTime', e.target.value)} />}</Field>
              </>
            )}
            <Field label="אורחים" error={f.errors.guests} hint={menuLocked ? 'שינוי אחרי אישור התפריט יפתח בדיקה למטבח ולרכש' : undefined}>{(p) => <NumberInput {...p} value={v.guests} onChange={(x) => f.set('guests', x ?? 0)} />}</Field>
            <Field label="מתוכם ילדים">{(p) => <NumberInput {...p} value={v.kids} onChange={(x) => f.set('kids', x ?? 0)} />}</Field>
            <Field label="צמחונים">{(p) => <NumberInput {...p} value={v.vegetarian} onChange={(x) => f.set('vegetarian', x ?? 0)} />}</Field>
            <Field label="טבעונים">{(p) => <NumberInput {...p} value={v.vegan} onChange={(x) => f.set('vegan', x ?? 0)} />}</Field>
            <Field label="סוג תפריט">{(p) => <Input {...p} value={v.menuType} onChange={(e) => f.set('menuType', e.target.value)} />}</Field>
            <Field label="כשרות">{(p) => <Select {...p} value={v.kosher} onChange={(e) => f.set('kosher', e.target.value as never)} options={optionsOf(KOSHER)} />}</Field>
            {(rules.siteDetails || v.address) && (
              <>
                <Field label="כתובת" className="sm:col-span-2" error={f.errors.address}>{(p) => <Input {...p} value={v.address} onChange={(e) => f.set('address', e.target.value)} />}</Field>
                <Field label="איש קשר בשטח">{(p) => <Input {...p} value={v.siteContactName} onChange={(e) => f.set('siteContactName', e.target.value)} />}</Field>
                <Field label="טלפון בשטח" error={f.errors.siteContactPhone}>{(p) => <Input {...p} type="tel" dir="ltr" className="text-start" value={v.siteContactPhone} onChange={(e) => f.set('siteContactPhone', e.target.value)} />}</Field>
                <Field label="דרישות המקום" className="sm:col-span-2">{(p) => <Textarea {...p} rows={2} value={v.siteRequirements} onChange={(e) => f.set('siteRequirements', e.target.value)} />}</Field>
              </>
            )}
            <Field label="בקשות מיוחדות" className="sm:col-span-2 lg:col-span-3">{(p) => <Textarea {...p} rows={2} value={v.specialRequests} onChange={(e) => f.set('specialRequests', e.target.value)} />}</Field>
            <Field label="הערות פנימיות" className="sm:col-span-2 lg:col-span-3">{(p) => <Textarea {...p} rows={2} value={v.notes} onChange={(e) => f.set('notes', e.target.value)} />}</Field>
          </fieldset>
        </Card>

        <Card title="אחריות בפועל" actions={<span className="text-xs text-[var(--color-muted)]">שינוי כאן מנתב את המשימות הפתוחות</span>}>
          <fieldset disabled={!canEdit} className="grid gap-4 sm:grid-cols-2">
            {people.map(([field, role]) => (
              <Field key={field} label={ROLES[role]}>
                {(p) => <Select {...p} value={v[field] ?? ''} onChange={(e) => f.set(field, e.target.value ? Number(e.target.value) : null)} placeholder="לא שובץ"
                  options={usersWithRole(dir.data, role, ev.venue).map((u) => ({ value: u.id, label: u.name }))} />}
              </Field>
            ))}
            <Field label="שלב בתהליך" hint={`אוטומטי = לפי המשימות הפתוחות (כרגע: ${WORK_STAGES[d.progress.stage].label})`}>
              {(p) => <Select {...p} value={v.workStage ?? ''} onChange={(e) => f.set('workStage', (e.target.value || null) as never)} placeholder="אוטומטי"
                options={WORK_STAGE_ORDER.map((s) => ({ value: s, label: `${WORK_STAGES[s].n}. ${WORK_STAGES[s].label}` }))} />}
            </Field>
            <Field label="נקודת בקרה (דקות לפני תחילת האירוע)" hint={`ריק = ברירת המחדל בהגדרות (${settings.checkpointMinutes} דק׳)`}>
              {(p) => <NumberInput {...p} value={v.checkpointMinutes} onChange={(x) => f.set('checkpointMinutes', x)} />}
            </Field>
            {ev.serviceKind === 'full' && <Field label="מזהה האירוע ב-Ubeya" hint="השיבוץ עצמו מנוהל ב-Ubeya">{(p) => <Input {...p} dir="ltr" className="text-start" value={v.ubeyaRef} onChange={(e) => f.set('ubeyaRef', e.target.value)} />}</Field>}
          </fieldset>
        </Card>

        {rules.track === 'hall' && <IntakeCard d={d} canEdit={d.access.events >= 3} form={f} />}
      </div>

      <aside className="space-y-5">
        <Card title="צ׳קליסט מוכנות" actions={<Badge tone={d.readiness.pct === 100 ? 'ok' : 'warn'}>{d.readiness.label}</Badge>}>
          <ul className="space-y-2.5">
            {d.readiness.items.map((i) => (
              <li key={i.key} className={`flex items-start gap-2.5 ${i.na ? 'opacity-50' : ''}`}>
                {i.na ? <Circle className="mt-0.5 size-5 shrink-0 text-[var(--color-border)]" aria-label="לא רלוונטי" /> : i.done ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-[var(--color-ok)]" aria-label="הושלם" /> : <Circle className="mt-0.5 size-5 shrink-0 text-[var(--color-border-strong)]" aria-label="פתוח" />}
                <div className="min-w-0 flex-1 text-sm">
                  <div className={i.na ? 'line-through' : i.done ? 'text-[var(--color-ink-2)]' : 'font-semibold'}>{i.label}</div>
                  <div className="text-xs text-[var(--color-muted)]">{i.na ? 'סומן כלא רלוונטי לאירוע' : `${i.taskId ? 'משימה · ' : ''}${i.detail ? `${i.detail} · ` : ''}באחריות ${ROLES[i.owner]}`}</div>
                </div>
                {i.taskId ? (
                  <Link to={`/events/${ev.id}/tasks`} className="shrink-0 text-xs font-semibold text-[var(--color-brand)] hover:underline">{i.blocked ? 'חסומה – לטיפול' : 'למשימה'}</Link>
                ) : canEdit && (
                  <button type="button" className="shrink-0 text-xs font-semibold text-[var(--color-brand)] hover:underline" disabled={skip.isPending}
                    onClick={() => skip.mutate(i.na ? skipped.filter((k) => k !== i.key) : [...skipped, i.key])}>
                    {i.na ? 'החזרה' : 'לא רלוונטי'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Card>
        {d.collection && (
          <Card title="גבייה בקצרה">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-[var(--color-muted)]">סכום חוזה</dt><dd className="num text-end font-semibold">{(d.collection.contract / 100).toLocaleString('he-IL')} ₪</dd>
              <dt className="text-[var(--color-muted)]">התקבל</dt><dd className="num text-end">{(d.collection.received / 100).toLocaleString('he-IL')} ₪</dd>
              <dt className="text-[var(--color-muted)]">יתרה</dt><dd className="num text-end font-bold">{(d.collection.balance / 100).toLocaleString('he-IL')} ₪</dd>
            </dl>
          </Card>
        )}
        <LifecycleCard d={d} />
        <p className="text-xs text-[var(--color-muted)]">עודכן לאחרונה {formatTs(ev.updatedAt)} · גרסה {ev.version}</p>
      </aside>
    </div>
  );
}

function IntakeCard({ d, canEdit, form }: { d: EventDetail; canEdit: boolean; form: ReturnType<typeof useEditForm<Editable>> }) {
  const ev = d.event;
  const [missing, setMissing] = useState(ev.intakeMissing);
  const setStatus = useAction((intakeStatus: string) => api.patch(`/events/${ev.id}`, { changes: { intakeStatus, ...(intakeStatus === 'missing' ? { intakeMissing: missing } : {}) }, base: { intakeStatus: ev.intakeStatus } }),
    { success: 'מצב הקליטה עודכן', invalidate: [['event', ev.id], ['tasks'], ['dashboard']] });
  const v = form.values!;
  return (
    <Card title="קליטה מהאולם" actions={<Badge tone={ev.intakeStatus === 'verified' ? 'ok' : ev.intakeStatus === 'missing' ? 'danger' : 'warn'}>{INTAKE_STATUS[ev.intakeStatus ?? 'received']}</Badge>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="התקבל מהאולם">{(p) => <Input {...p} disabled value={ev.hallReceivedAt ? formatTs(ev.hallReceivedAt) : ''} />}</Field>
        <Field label="גורם משלם">{(p) => <Input {...p} disabled value={ev.payer} />}</Field>
        <Field label="איש קשר באולם">{(p) => <Input {...p} disabled={!canEdit} value={v.hallContactName} onChange={(e) => form.set('hallContactName', e.target.value)} />}</Field>
        <Field label="טלפון האולם">{(p) => <Input {...p} disabled={!canEdit} dir="ltr" className="text-start" value={v.hallContactPhone} onChange={(e) => form.set('hallContactPhone', e.target.value)} />}</Field>
      </div>
      {canEdit && ev.intakeStatus !== 'verified' && (
        <div className="mt-4 space-y-3 rounded-[10px] bg-[var(--color-surface-2)] p-3">
          <p className="text-sm">אמת תאריך, שעות, אורחים ואיש קשר מול האולם. אם חסר משהו – פרט ונפתח מעקב השלמה.</p>
          <Field label="מה חסר">{(p) => <Textarea {...p} rows={2} value={missing} onChange={(e) => setMissing(e.target.value)} />}</Field>
          <div className="flex flex-wrap gap-2">
            <Button variant="success" icon={<CheckCircle2 className="size-4" />} loading={setStatus.isPending && setStatus.variables === 'verified'} onClick={() => setStatus.mutate('verified')}>הפרטים אומתו</Button>
            <Button disabled={!missing.trim()} loading={setStatus.isPending && setStatus.variables === 'missing'} onClick={() => setStatus.mutate('missing')}>חסרים פרטים – פתיחת השלמה</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function LifecycleCard({ d }: { d: EventDetail }) {
  const ev = d.event;
  const auth = useAuth();
  const [dialog, setDialog] = useState<null | 'cancelled' | 'closed'>(null);
  const [reason, setReason] = useState('');
  const act = useAction((lifecycle: string) => api.post(`/events/${ev.id}/lifecycle`, { lifecycle, reason }),
    { success: 'מצב האירוע עודכן', invalidate: [['event', ev.id], ['events'], ['tasks'], ['dashboard']], onSuccess: () => { setDialog(null); setReason(''); } });
  const canApprove = auth.can('events', 3, ev.venue);
  if (!auth.can('events', 2, ev.venue)) return null;
  return (
    <Card title="מצב האירוע">
      <div className="flex flex-wrap gap-2">
        {(ev.lifecycle === 'completed' || (ev.lifecycle === 'planning' && ev.date < new Date().toISOString().slice(0, 10))) && (
          <Button icon={<Lock className="size-4" />} onClick={() => setDialog('closed')}>סגירת אירוע</Button>
        )}
        {ev.lifecycle === 'planning' && canApprove && <Button variant="ghost" icon={<Ban className="size-4" />} onClick={() => setDialog('cancelled')}>ביטול אירוע</Button>}
        {(ev.lifecycle === 'cancelled' || ev.lifecycle === 'closed') && canApprove && <Button icon={<RotateCcw className="size-4" />} loading={act.isPending} onClick={() => act.mutate('planning')}>פתיחה מחדש</Button>}
      </div>
      <p className="mt-2 text-xs text-[var(--color-muted)]">אירוע שהסתיים נשאר פתוח עד שכל הגבייה, החזרת הכלים והטיפול בלקוח הושלמו.</p>
      <Dialog open={!!dialog} onClose={() => setDialog(null)} title={dialog === 'cancelled' ? 'ביטול אירוע' : 'סגירת אירוע'} size="sm"
        footer={<>
          <Button onClick={() => setDialog(null)}>חזרה</Button>
          <Button variant={dialog === 'cancelled' ? 'danger' : 'primary'} loading={act.isPending} onClick={() => act.mutate(dialog!)}>{dialog === 'cancelled' ? 'ביטול האירוע' : 'סגירה'}</Button>
        </>}>
        <FormError message={act.error?.message} />
        <Field label={dialog === 'cancelled' ? 'סיבת ביטול' : 'הערת סגירה'} required={dialog === 'cancelled'} error={act.error?.fields.reason}>
          {(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        {dialog === 'cancelled' && <p className="mt-2 text-sm text-[var(--color-muted)]">משימות פתוחות של האירוע יבוטלו. ההחזר הכספי מטופל בנפרד לפי נוהל הביטול.</p>}
      </Dialog>
    </Card>
  );
}
