/**
 * The work process (8 stages): event checklist by stage, process map, roles & accountability,
 * the business-editable work template, and data export.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Download, Flag, OctagonX, Users2, Clock, Workflow } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../../lib/api.ts';
import { useAction } from '../../lib/query.ts';
import { useAuth, useDirectory, usersWithRole } from '../../lib/auth.tsx';
import { Card, EmptyState, PageHeader, QueryView } from '../../ui/layout.tsx';
import { Button, LinkButton, buttonClass } from '../../ui/Button.tsx';
import { Badge } from '../../ui/Badge.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import { Checkbox, Field, FormError, Input, NumberInput, Select, Textarea, optionsOf } from '../../ui/form.tsx';
import { TaskRows } from '../tasks/TaskList.tsx';
import { ROLES, type Role } from '@shared/permissions.ts';
import { DONE_WHEN, EVENT_TYPES, TIMING_ANCHOR, VENUE_LABEL, WORK_STAGES, WORK_STAGE_ORDER, type VenueCode, type WorkStage } from '@shared/domain.ts';
import { formatTs } from '@shared/dates.ts';
import type { EventDetail, EventProgress, TaskRecord, TaskTemplate } from '@shared/types.ts';

// ---------------------------------------------------------------- small pieces

export function StageBadge({ stage, auto }: { stage: WorkStage; auto?: boolean }) {
  return <Badge tone="brand"><span className="num">{WORK_STAGES[stage].n}</span>/8 · {WORK_STAGES[stage].label}{auto === false ? ' (ידני)' : ''}</Badge>;
}

/** Eight-step strip: done / current / ahead, with open counts per stage. */
export function StageStrip({ progress, onPick, active }: { progress: EventProgress; onPick?: (s: WorkStage) => void; active?: WorkStage | null }) {
  const current = WORK_STAGES[progress.stage].n;
  return (
    <ol className="grid grid-cols-4 gap-1 sm:grid-cols-8" aria-label="שלבי התהליך">
      {progress.byStage.map((s) => {
        const n = WORK_STAGES[s.stage].n;
        const state = s.blocked ? 'blocked' : n < current && s.open === 0 ? 'done' : n === current ? 'current' : s.open === 0 && s.done > 0 ? 'done' : 'ahead';
        return (
          <li key={s.stage}>
            <button type="button" onClick={() => onPick?.(s.stage)} aria-pressed={active === s.stage} aria-current={n === current ? 'step' : undefined}
              className={clsx('w-full rounded-lg px-1.5 py-1.5 text-start text-[11px] leading-tight transition-colors',
                state === 'blocked' ? 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]'
                  : state === 'done' ? 'bg-[var(--color-brand)] text-[var(--color-on-brand)]'
                  : state === 'current' ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)] ring-2 ring-[var(--color-brand)]'
                  : 'bg-[var(--color-surface-2)] text-[var(--color-muted)]',
                active === s.stage && 'outline outline-2 outline-offset-1 outline-[var(--color-ink)]')}>
              <span className="num font-bold">{n}</span> <span className="font-semibold">{WORK_STAGES[s.stage].label}</span>
              <span className="block opacity-80">{s.open ? `${s.open} פתוחות${s.blocked ? ` · ${s.blocked} חסומות` : ''}` : s.done ? 'הושלם' : '—'}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** Live countdown to the control point ("everything closed one hour before"). */
export function Checkpoint({ progress, compact }: { progress: EventProgress; compact?: boolean }) {
  if (!progress.checkpointAt) return <span className="text-xs text-[var(--color-muted)]">לא הוגדרה שעת התחלה – אין נקודת בקרה</span>;
  const ms = new Date(progress.checkpointAt).getTime() - Date.now();
  const late = ms < 0;
  const h = Math.floor(Math.abs(ms) / 3_600_000);
  const d = Math.floor(h / 24);
  const left = d >= 1 ? `${d === 1 ? 'יום' : `${d} ימים`} ו-${h % 24} שעות` : `${h} שעות ו-${Math.floor((Math.abs(ms) % 3_600_000) / 60_000)} דק׳`;
  const ok = progress.requiredOpen === 0;
  return (
    <div className={clsx('flex flex-wrap items-center gap-2', compact ? 'text-xs' : 'text-sm')}>
      <Clock className="size-4" aria-hidden />
      <span>נקודת בקרה {formatTs(progress.checkpointAt)}</span>
      {ok ? <Badge tone="ok">כל הנדרש סגור</Badge>
        : late ? <Badge tone="danger">עברה נקודת הבקרה · {progress.requiredOpen} פתוחות</Badge>
        : <Badge tone={d >= 1 ? 'info' : 'warn'}>נותרו {left} · {progress.requiredOpen} נדרשות פתוחות</Badge>}
    </div>
  );
}

export function ExportButton({ kind, label = 'ייצוא לאקסל' }: { kind: 'events' | 'tasks' | 'clients' | 'receivables'; label?: string }) {
  return <a href={`/api/process/export/${kind}`} download className={buttonClass('secondary', 'md')}><Download className="size-4" aria-hidden />{label}</a>;
}

// ---------------------------------------------------------------- event checklist (tab)

export function EventProcessTab({ d }: { d: EventDetail }) {
  const ev = d.event;
  const [stage, setStage] = useState<WorkStage | null>(null);
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ['tasks', { event: ev.id }], queryFn: () => api.get<TaskRecord[]>(`/tasks?event=${ev.id}&status=all`) });
  const p = d.progress;
  return (
    <div className="space-y-5">
      <Card title={<span className="flex items-center gap-2"><Workflow className="size-4" />התקדמות בתהליך</span>} actions={<>
        <Badge tone={p.taskPct === 100 ? 'ok' : 'info'}>{p.tasksDone}/{p.tasksTotal} משימות · {p.taskPct}%</Badge>
        {p.blocked > 0 && <Badge tone="danger">{p.blocked} חסומות</Badge>}
        {d.access.tasks >= 2 && <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>משימה</Button>}
      </>}>
        <StageStrip progress={p} active={stage} onPick={(s) => setStage((x) => (x === s ? null : s))} />
        <div className="mt-3"><Checkpoint progress={p} /></div>
      </Card>
      <QueryView q={q} empty={(l) => (l.length ? null : <Card><EmptyState title="אין משימות לאירוע" text="משימות נוצרות מתבנית העבודה ומאירועים בתהליך." /></Card>)}>
        {(list) => (
          <div className="space-y-4">
            {WORK_STAGE_ORDER.filter((s) => !stage || s === stage).map((s) => {
              const items = list.filter((t) => t.stage === s && t.status !== 'cancelled');
              if (!items.length) return null;
              const open = items.filter((t) => t.status !== 'done');
              return (
                <Card key={s} title={`${WORK_STAGES[s].n}. ${WORK_STAGES[s].label}`} bodyClass="px-4 py-1"
                  actions={<span className="text-xs text-[var(--color-muted)]">{items.length - open.length}/{items.length} הושלמו</span>}>
                  <TaskRows tasks={[...open, ...items.filter((t) => t.status === 'done')]} compact />
                </Card>
              );
            })}
          </div>
        )}
      </QueryView>
      {adding && <AddTaskDialog eventId={ev.id} venue={ev.venue} startAt={p.startAt} defaultStage={stage ?? p.stage} onClose={() => setAdding(false)} />}
    </div>
  );
}

export function AddTaskDialog({ eventId, venue, startAt, defaultStage, onClose }: { eventId: number; venue: VenueCode; startAt: string | null; defaultStage: WorkStage; onClose: () => void }) {
  const dir = useDirectory();
  const [v, setV] = useState({ title: '', action: '', stage: defaultStage, role: 'event_manager' as Role, assigneeId: '', due: '', required: true });
  const toLocal = (iso: string) => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const before = (h: number) => startAt && setV((x) => ({ ...x, due: toLocal(new Date(new Date(startAt).getTime() - h * 3_600_000).toISOString()) }));
  const save = useAction(() => api.post('/tasks', {
    title: v.title, action: v.action, stage: v.stage, role: v.role, eventId, assigneeId: v.assigneeId ? Number(v.assigneeId) : null,
    dueAt: v.due ? new Date(v.due).toISOString() : null, required: v.required,
  }), { success: 'המשימה נוספה לאירוע', invalidate: [['tasks'], ['event', eventId], ['dashboard']], onSuccess: onClose });
  const people = usersWithRole(dir.data, v.role, venue);
  return (
    <Dialog open onClose={onClose} title="משימה לאירוע" footer={<><Button onClick={onClose}>ביטול</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>הוספה</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><FormError message={save.error?.message} /></div>
        <Field label="משימה" required className="sm:col-span-2" error={save.error?.fields.title}>{(p) => <Input {...p} data-autofocus value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="למשל: תיאום רכב הובלה" />}</Field>
        <Field label="פירוט" className="sm:col-span-2">{(p) => <Textarea {...p} rows={2} value={v.action} onChange={(e) => setV({ ...v, action: e.target.value })} />}</Field>
        <Field label="שלב">{(p) => <Select {...p} value={v.stage} onChange={(e) => setV({ ...v, stage: e.target.value as WorkStage })} options={WORK_STAGE_ORDER.map((s) => ({ value: s, label: `${WORK_STAGES[s].n}. ${WORK_STAGES[s].label}` }))} />}</Field>
        <Field label="תפקיד אחראי">{(p) => <Select {...p} value={v.role} onChange={(e) => setV({ ...v, role: e.target.value as Role, assigneeId: '' })} options={optionsOf(ROLES).filter((o) => o.value !== 'owner')} />}</Field>
        <Field label="מטפל" hint="ריק = לתור של התפקיד">{(p) => <Select {...p} value={v.assigneeId} onChange={(e) => setV({ ...v, assigneeId: e.target.value })} placeholder="לתור" options={people.map((u) => ({ value: u.id, label: u.name }))} />}</Field>
        <Field label="יעד">{(p) => <Input {...p} type="datetime-local" value={v.due} onChange={(e) => setV({ ...v, due: e.target.value })} />}</Field>
        {startAt && (
          <div className="flex flex-wrap gap-1.5 sm:col-span-2">
            <span className="self-center text-xs text-[var(--color-muted)]">לפני תחילת האירוע:</span>
            {[1, 3, 24, 72].map((h) => <Button key={h} size="sm" variant="ghost" onClick={() => before(h)}>{h < 24 ? `${h} ש׳` : `${h / 24} ימים`}</Button>)}
          </div>
        )}
        <Checkbox label="נדרש למוכנות" hint="נספר באחוז המוכנות ובנקודת הבקרה" checked={v.required} onChange={(c) => setV({ ...v, required: c })} />
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- process map page

interface StageSummary { stage: WorkStage; label: string; desc: string; templates: number; open: number; blocked: number; overdue: number; done: number; events: number }

export function ProcessMapPage() {
  const auth = useAuth();
  const q = useQuery({ queryKey: ['tasks', 'process-map'], queryFn: () => api.get<StageSummary[]>('/process/map') });
  return (
    <div>
      <PageHeader title="מפת תהליכי העבודה" subtitle="שמונת השלבים מפנייה ועד סגירה ותשלומים. כל כרטיס מוביל למשימות הפתוחות בשלב, בכל האירועים שבתחום שלך."
        actions={<>
          <LinkButton to="/roles" icon={<Users2 className="size-4" />}>בעלי תפקידים</LinkButton>
          {auth.can('process', 1) && <LinkButton to="/process/templates" variant="primary" icon={<Pencil className="size-4" />}>תבנית העבודה</LinkButton>}
        </>} />
      <QueryView q={q} rows={4}>
        {(list) => (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {list.map((s) => (
              <Link key={s.stage} to={`/tasks?view=queue&stage=${s.stage}`} className={clsx('card block p-4 transition-colors hover:border-[var(--color-brand)]', s.blocked > 0 && 'border-[var(--color-danger)]')}>
                <div className="num text-2xl font-extrabold text-[var(--color-warn)]">{String(WORK_STAGES[s.stage].n).padStart(2, '0')}</div>
                <h2 className="mt-1 text-lg font-bold">{s.label}</h2>
                <p className="min-h-10 text-sm text-[var(--color-ink-2)]">{s.desc}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge tone={s.open ? 'info' : 'ok'}>{s.open} פתוחות</Badge>
                  {s.blocked > 0 && <Badge tone="danger"><OctagonX className="size-3" />{s.blocked} חסומות</Badge>}
                  {s.overdue > 0 && <Badge tone="warn">{s.overdue} באיחור</Badge>}
                </div>
                <div className="mt-2 text-xs text-[var(--color-muted)]">{s.events} אירועים בשלב · {s.templates} משימות בתבנית</div>
              </Link>
            ))}
          </div>
        )}
      </QueryView>
    </div>
  );
}

// ---------------------------------------------------------------- roles page

interface RoleSummary { role: Role; label: string; desc: string; people: { id: number; name: string; venue: string | null }[]; open: number; blocked: number; overdue: number; unclaimed: number }

export function RolesPage() {
  const q = useQuery({ queryKey: ['tasks', 'roles'], queryFn: () => api.get<RoleSummary[]>('/process/roles') });
  return (
    <div>
      <PageHeader title="בעלי תפקידים ואחריות" subtitle="תפקידים לפני שמות: מה כל תפקיד מחזיק, מי ממלא אותו כרגע, וכמה פתוח אצלו. אדם יכול למלא כמה תפקידים." />
      <QueryView q={q} rows={4}>
        {(list) => (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((r) => (
              <Link key={r.role} to={`/tasks?view=queue&role=${r.role}`} className={clsx('card block p-4 transition-colors hover:border-[var(--color-brand)]', r.blocked > 0 && 'border-[var(--color-danger)]')}>
                <Badge tone="brand">בעל תפקיד</Badge>
                <h2 className="mt-2 text-lg font-bold">{r.label}</h2>
                <p className="text-sm text-[var(--color-ink-2)]">{r.desc}</p>
                <div className="mt-3 text-sm">
                  <span className="font-semibold">ממלאים: </span>
                  {r.people.length ? r.people.map((p) => `${p.name.split(' – ')[0]}${p.venue ? ` (${p.venue})` : ''}`).join(', ') : <span className="font-semibold text-[var(--color-danger)]">אין אף אחד – משימות התפקיד ייתקעו בתור</span>}
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge tone={r.open ? 'info' : 'ok'}>{r.open} משימות פתוחות</Badge>
                  {r.blocked > 0 && <Badge tone="danger">{r.blocked} חסומות</Badge>}
                  {r.overdue > 0 && <Badge tone="warn">{r.overdue} באיחור</Badge>}
                  {r.unclaimed > 0 && <Badge>{r.unclaimed} טרם נלקחו</Badge>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </QueryView>
    </div>
  );
}

// ---------------------------------------------------------------- template editor

const offsetLabel = (h: number) => {
  if (h === 0) return 'בתחילת האירוע';
  const abs = Math.abs(h);
  const txt = abs % 24 === 0 ? `${abs / 24} ימים` : abs > 24 ? `${Math.floor(abs / 24)} ימים ו-${abs % 24} ש׳` : `${abs} ש׳`;
  return h < 0 ? `${txt} לפני` : `${txt} אחרי`;
};

const timingLabel = (h: number, anchor: keyof typeof TIMING_ANCHOR) => {
  const what = TIMING_ANCHOR[anchor];
  if (h === 0) return `ב${what}`;
  const abs = Math.abs(h);
  const txt = abs % 24 === 0 ? `${abs / 24} ימים` : abs > 24 ? `${Math.floor(abs / 24)} ימים ו-${abs % 24} ש׳` : `${abs} ש׳`;
  return `${txt} ${h < 0 ? 'לפני' : 'אחרי'} ${what}`;
};

export function TemplatesPage() {
  const auth = useAuth();
  const canEdit = auth.can('process', 3);
  const q = useQuery({ queryKey: ['settings', 'templates'], queryFn: () => api.get<TaskTemplate[]>('/process/templates') });
  const [edit, setEdit] = useState<TaskTemplate | 'new' | null>(null);
  const [newStage, setNewStage] = useState<WorkStage>('inquiry');
  return (
    <div>
      <PageHeader title="תבנית העבודה" eyebrow="תהליך עבודה"
        subtitle="אילו משימות מקבל כל אירוע, באיזה שלב, לאיזה תפקיד ומתי ביחס לשעת האירוע. שינוי כאן חל מיד על כל האירועים הפתוחים – בלי מתכנת."
        actions={<LinkButton to="/process">למפת התהליכים</LinkButton>} />
      <div className="mb-4 rounded-[10px] bg-[var(--color-surface-2)] p-3 text-sm">
        משימה שמחוברת ל"נסגרת כאשר" נסגרת לבד כשהנתון מתועד במערכת (למשל "התפריט אושר"), כך שהרשימה לא סותרת את המציאות. מעבר לכך המערכת פותחת משימות אוטומטיות לפי אירועים בתהליך (חוזה נחתם, חוסר במלאי, דיווח מהשטח).
      </div>
      <QueryView q={q} rows={6}>
        {(list) => (
          <div className="space-y-4">
            {WORK_STAGE_ORDER.map((s) => {
              const items = list.filter((t) => t.stage === s);
              return (
                <Card key={s} title={`${WORK_STAGES[s].n}. ${WORK_STAGES[s].label}`} bodyClass="p-0"
                  actions={canEdit && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => { setNewStage(s); setEdit('new'); }}>משימה לשלב</Button>}>
                  {!items.length ? <p className="px-4 py-3 text-sm text-[var(--color-muted)]">אין משימות תבנית בשלב זה.</p> : (
                    <div className="overflow-x-auto">
                      <table className="table">
                        <thead><tr><th>משימה</th><th>תפקיד</th><th>מתי</th><th>חל על</th><th>נסגרת כאשר</th><th /></tr></thead>
                        <tbody>
                          {items.map((t) => (
                            <tr key={t.id} className={t.active ? '' : 'opacity-50'}>
                              <td><div className="font-semibold">{t.title}{t.required ? <Flag className="ms-1 inline size-3.5 text-[var(--color-brand)]" aria-label="נדרש למוכנות" /> : null}</div>{t.action && t.action !== t.title && <div className="text-xs text-[var(--color-muted)]">{t.action}</div>}</td>
                              <td className="whitespace-nowrap text-sm">{ROLES[t.role]}</td>
                              <td className="whitespace-nowrap text-sm">{timingLabel(t.offsetHours, t.anchor ?? 'event_start')}</td>
                              <td className="text-sm">{[t.venue ? VENUE_LABEL[t.venue] : 'כל הנקודות', t.eventType !== '*' ? EVENT_TYPES[t.eventType as keyof typeof EVENT_TYPES] : '', t.serviceKind === 'full' ? 'אירוע מלא' : t.serviceKind === 'platters' ? 'מגשים' : ''].filter(Boolean).join(' · ')}</td>
                              <td className="text-sm">{t.doneWhen ? DONE_WHEN[t.doneWhen] : <span className="text-[var(--color-muted)]">סימון ידני</span>}</td>
                              <td>{canEdit && <Button size="sm" variant="ghost" aria-label={`עריכת ${t.title}`} onClick={() => setEdit(t)}><Pencil className="size-4" /></Button>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </QueryView>
      {edit && <TemplateDialog t={edit === 'new' ? null : edit} stage={newStage} onClose={() => setEdit(null)} />}
    </div>
  );
}

function TemplateDialog({ t, stage, onClose }: { t: TaskTemplate | null; stage: WorkStage; onClose: () => void }) {
  const initialOffset = t?.offsetHours ?? -24;
  const [v, setV] = useState({
    title: t?.title ?? '', action: t?.action ?? '', stage: t?.stage ?? stage, role: (t?.role ?? 'event_manager') as Role,
    venue: t?.venue ?? '', eventType: t?.eventType ?? '*', serviceKind: t?.serviceKind ?? '*', required: t ? !!t.required : true,
    doneWhen: t?.doneWhen ?? '', active: t ? !!t.active : true, sort: t?.sort ?? 0, anchor: t?.anchor ?? 'event_start',
    amount: Math.abs(initialOffset) % 24 === 0 && initialOffset !== 0 ? Math.abs(initialOffset) / 24 : Math.abs(initialOffset),
    unit: Math.abs(initialOffset) % 24 === 0 && initialOffset !== 0 ? 'days' : 'hours', dir: initialOffset > 0 ? 'after' : 'before',
  });
  const offsetHours = useMemo(() => (v.dir === 'after' ? 1 : -1) * (v.unit === 'days' ? v.amount * 24 : v.amount), [v.amount, v.unit, v.dir]);
  const payload = () => ({ title: v.title, action: v.action, stage: v.stage, role: v.role, venue: v.venue || null, eventType: v.eventType, serviceKind: v.serviceKind, offsetHours, anchor: v.anchor, required: v.required, doneWhen: v.doneWhen || null, active: v.active, sort: v.sort });
  const inv = [['settings', 'templates'], ['tasks'], ['event'], ['dashboard']];
  const save = useAction(() => (t ? api.put(`/process/templates/${t.id}`, payload()) : api.post('/process/templates', payload())), { success: 'התבנית עודכנה והוחלה על האירועים הפתוחים', invalidate: inv, onSuccess: onClose });
  const del = useAction(() => api.del(`/process/templates/${t!.id}`), { success: 'המשימה הוסרה מהתבנית', invalidate: inv, onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} size="lg" title={t ? `עריכת "${t.title}"` : 'משימה חדשה בתבנית'}
      footer={<>
        {t && <Button variant="ghost" className="me-auto" icon={<Trash2 className="size-4 text-[var(--color-danger)]" />} loading={del.isPending}
          onClick={() => { if (window.confirm('להסיר את המשימה מהתבנית? משימות פתוחות שנוצרו ממנה יבוטלו. אפשר במקום זאת להשבית אותה.')) del.mutate(undefined); }}>הסרה</Button>}
        <Button onClick={onClose}>ביטול</Button>
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>שמירה</Button>
      </>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><FormError message={save.error?.message} /></div>
        <Field label="משימה" required className="sm:col-span-2" error={save.error?.fields.title}>{(p) => <Input {...p} data-autofocus value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />}</Field>
        <Field label="פירוט / הנחיה" className="sm:col-span-2">{(p) => <Textarea {...p} rows={2} value={v.action} onChange={(e) => setV({ ...v, action: e.target.value })} />}</Field>
        <Field label="שלב">{(p) => <Select {...p} value={v.stage} onChange={(e) => setV({ ...v, stage: e.target.value as WorkStage })} options={WORK_STAGE_ORDER.map((s) => ({ value: s, label: `${WORK_STAGES[s].n}. ${WORK_STAGES[s].label}` }))} />}</Field>
        <Field label="תפקיד אחראי">{(p) => <Select {...p} value={v.role} onChange={(e) => setV({ ...v, role: e.target.value as Role })} options={optionsOf(ROLES).filter((o) => o.value !== 'owner')} />}</Field>
        <fieldset className="sm:col-span-2">
          <legend className="label">מועד יעד</legend>
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-24"><NumberInput aria-label="כמות" value={v.amount} onChange={(x) => setV({ ...v, amount: x ?? 0 })} /></div>
            <Select aria-label="יחידה" value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value })} options={[{ value: 'hours', label: 'שעות' }, { value: 'days', label: 'ימים' }]} className="w-28" />
            <Select aria-label="לפני או אחרי" value={v.dir} onChange={(e) => setV({ ...v, dir: e.target.value })} options={[{ value: 'before', label: 'לפני' }, { value: 'after', label: 'אחרי' }]} className="w-28" />
            <Select aria-label="נמדד מ" value={v.anchor} onChange={(e) => setV({ ...v, anchor: e.target.value as never })} options={optionsOf(TIMING_ANCHOR)} className="w-60" />
            <span className="text-xs text-[var(--color-muted)]">{timingLabel(offsetHours, v.anchor as keyof typeof TIMING_ANCHOR)}</span>
          </div>
          {save.error?.fields.offsetHours && <p className="mt-1 text-xs font-medium text-[var(--color-danger)]">{save.error.fields.offsetHours}</p>}
        </fieldset>
        <Field label="נקודה">{(p) => <Select {...p} value={v.venue} onChange={(e) => setV({ ...v, venue: e.target.value })} placeholder="כל הנקודות" options={optionsOf(VENUE_LABEL)} />}</Field>
        <Field label="סוג אירוע">{(p) => <Select {...p} value={v.eventType} onChange={(e) => setV({ ...v, eventType: e.target.value })} options={[{ value: '*', label: 'כל הסוגים' }, ...optionsOf(EVENT_TYPES)]} />}</Field>
        <Field label="סוג שירות">{(p) => <Select {...p} value={v.serviceKind} onChange={(e) => setV({ ...v, serviceKind: e.target.value })} options={[{ value: '*', label: 'הכול' }, { value: 'full', label: 'אירוע מלא' }, { value: 'platters', label: 'מגשים / מסירה' }]} />}</Field>
        <Field label="נסגרת אוטומטית כאשר" hint="ריק = סימון ידני של בעל התפקיד">{(p) => <Select {...p} value={v.doneWhen} onChange={(e) => setV({ ...v, doneWhen: e.target.value })} placeholder="סימון ידני" options={optionsOf(DONE_WHEN)} />}</Field>
        <Checkbox label="נדרש למוכנות" hint="נספר בבדיקת המוכנות ובנקודת הבקרה" checked={v.required} onChange={(c) => setV({ ...v, required: c })} />
        <Checkbox label="פעילה" hint="השבתה עוצרת יצירה לאירועים חדשים" checked={v.active} onChange={(c) => setV({ ...v, active: c })} />
      </div>
    </Dialog>
  );
}
