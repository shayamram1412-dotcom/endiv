/** Task rows with one-tap actions (claim / complete) and a detail drawer with history. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Clock, Hand, CheckCircle2, ArrowLeftRight, AlertOctagon, CornerDownLeft, OctagonX, Play, Flag, Pencil, Trash2, RotateCcw } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../../lib/api.ts';
import { useAction } from '../../lib/query.ts';
import { useAuth, useDirectory, usersWithRole } from '../../lib/auth.tsx';
import { Badge, StatusPill } from '../../ui/Badge.tsx';
import { Button } from '../../ui/Button.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import { Field, Select, Textarea, FormError, Input, Checkbox, optionsOf } from '../../ui/form.tsx';
import { Loading } from '../../ui/layout.tsx';
import { ROLES } from '@shared/permissions.ts';
import { VENUE_LABEL, WORK_STAGES, WORK_STAGE_ORDER, type WorkStage } from '@shared/domain.ts';
import type { Role } from '@shared/permissions.ts';
import { formatTs, formatDay } from '@shared/dates.ts';
import type { TaskLogRecord, TaskRecord } from '@shared/types.ts';

const LOG_LABEL: Record<string, string> = {
  created: 'נוצרה', claimed: 'נלקחה לטיפול', released: 'הוחזרה לתור', transferred: 'הועברה', note: 'עדכון',
  completed: 'בוצעה', auto_completed: 'נסגרה אוטומטית לפי הנתונים', cancelled: 'בוטלה', blocked: 'סומנה כחסומה', unblocked: 'החסימה הוסרה', edited: 'נערכה', removed: 'הוסרה מהאירוע', reopened: 'נפתחה מחדש',
};

/** Can this user act on the task (same rule as the server: handler, role queue, or supervisor). */
function useCanAct() {
  const auth = useAuth();
  return (t: TaskRecord) => t.assigneeId === auth.me.id || auth.hasRole(t.role, t.venue) || auth.supervisor;
}

function dueLabel(t: TaskRecord): { text: string; tone: 'danger' | 'warn' | 'neutral' } | null {
  if (!t.dueAt) return null;
  const ms = new Date(t.dueAt).getTime() - Date.now();
  const h = Math.round(ms / 3_600_000);
  if (t.status === 'done' || t.status === 'cancelled') return { text: formatTs(t.dueAt), tone: 'neutral' };
  if (ms < 0) return { text: `באיחור ${Math.abs(h) >= 24 ? `${Math.round(-h / 24)} ימים` : `${Math.max(1, -h)} שעות`}`, tone: 'danger' };
  if (h < 24) return { text: `בעוד ${Math.max(1, h)} שעות`, tone: 'warn' };
  return { text: `עד ${formatDay(t.dueAt.slice(0, 10))}`, tone: 'neutral' };
}

export function TaskRows({ tasks, compact }: { tasks: TaskRecord[]; compact?: boolean }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const { me } = useAuth();
  const canAct = useCanAct();
  const claim = useAction((id: number) => api.post(`/tasks/${id}/claim`), { success: 'המשימה אצלך', invalidate: [['tasks'], ['dashboard']] });
  return (
    <>
      <ul className="divide-y divide-[var(--color-border)]">
        {tasks.map((t) => {
          const due = dueLabel(t);
          const mine = t.assigneeId === me.id;
          return (
            <li key={t.id} className={clsx('flex items-start gap-3 py-3', t.status === 'blocked' ? '-mx-2 rounded-lg border-s-4 border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-2' : t.escalated && t.status !== 'done' && 'bg-[color-mix(in_srgb,var(--color-danger-soft)_50%,transparent)] -mx-2 rounded-lg px-2')}>
              <div className="min-w-0 flex-1">
                <button onClick={() => setOpenId(t.id)} className="text-start font-semibold hover:text-[var(--color-brand)] hover:underline">{t.title}</button>
                {t.action !== t.title && <p className="mt-0.5 line-clamp-2 text-sm text-[var(--color-ink-2)]">{t.action}</p>}
                {t.status === 'blocked' && <p className="mt-1 text-sm font-semibold text-[var(--color-danger)]"><OctagonX className="me-1 inline size-4" aria-hidden />חסום: {t.blockedReason}{t.blockedByName ? ` (${t.blockedByName})` : ''}</p>}
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                  {due && <Badge tone={due.tone}><Clock className="size-3" aria-hidden />{due.text}</Badge>}
                  {t.status === 'blocked' && <Badge tone="danger">חסומה</Badge>}
                  {t.required ? <Badge tone="brand"><Flag className="size-3" aria-hidden />נדרש למוכנות</Badge> : null}
                  {!compact && t.stage && <Badge>{WORK_STAGES[t.stage]?.label}</Badge>}
                  {t.escalated && t.status !== 'done' && !t.overdue && <Badge tone="danger"><AlertOctagon className="size-3" aria-hidden />ללא מטפל</Badge>}
                  {t.eventId && <Link to={`/events/${t.eventId}`} className="font-semibold text-[var(--color-brand)] hover:underline">{t.eventTitle}</Link>}
                  {!t.eventId && t.clientId && <Link to={`/clients/${t.clientId}`} className="font-semibold text-[var(--color-brand)] hover:underline">{t.clientName}</Link>}
                  {!compact && <span className="text-[var(--color-muted)]">· {ROLES[t.role]}{t.venue ? ` · ${VENUE_LABEL[t.venue]}` : ''}</span>}
                  <span className="text-[var(--color-muted)]">· {t.assigneeName ? (mine ? 'אצלי' : t.assigneeName) : 'בתור – טרם נלקחה'}</span>
                </div>
              </div>
              <div className="flex shrink-0 gap-1.5">
                {t.status !== 'done' && t.status !== 'cancelled' && !t.assigneeId && canAct(t) && (
                  <Button size="sm" icon={<Hand className="size-3.5" />} loading={claim.isPending && claim.variables === t.id} onClick={() => claim.mutate(t.id)}>לקחת</Button>
                )}
                {t.status === 'done' && <StatusPill kind="task" value="done" />}
                <Button size="sm" variant="ghost" onClick={() => setOpenId(t.id)} aria-label={`פרטי המשימה ${t.title}`}>פרטים</Button>
              </div>
            </li>
          );
        })}
      </ul>
      {openId && <TaskDrawer id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

export function TaskDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const { me } = useAuth();
  const canActFn = useCanAct();
  const dir = useDirectory();
  const q = useQuery({ queryKey: ['task', id], queryFn: () => api.get<{ task: TaskRecord; log: TaskLogRecord[]; evidence: string; trigger: string; auto: boolean }>(`/tasks/${id}`) });
  const [note, setNote] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const inv = [['tasks'], ['task', id], ['dashboard'], ['event']];
  const claim = useAction(() => api.post(`/tasks/${id}/claim`), { success: 'המשימה אצלך', invalidate: inv });
  const release = useAction(() => api.post(`/tasks/${id}/release`), { success: 'הוחזרה לתור', invalidate: inv });
  const addNote = useAction(() => api.post(`/tasks/${id}/note`, { note }), { success: 'העדכון נשמר', invalidate: inv, onSuccess: () => setNote('') });
  const complete = useAction(() => api.post(`/tasks/${id}/complete`, { note }), { success: 'המשימה סומנה כבוצעה', invalidate: inv, onSuccess: () => { setNote(''); onClose(); } });
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockReason, setBlockReason] = useState('');
  const block = useAction(() => api.post(`/tasks/${id}/block`, { reason: blockReason }), { success: 'המשימה סומנה כחסומה – מנהל האירוע וההנהלה רואים אותה', invalidate: inv, onSuccess: () => { setBlockOpen(false); setBlockReason(''); } });
  const unblock = useAction(() => api.post(`/tasks/${id}/unblock`, { note }), { success: 'החסימה הוסרה', invalidate: inv, onSuccess: () => setNote('') });
  const transfer = useAction(() => api.post(`/tasks/${id}/transfer`, { userId: Number(transferTo), note }), { success: 'המשימה הועברה', invalidate: inv, onSuccess: () => setTransferTo('') });
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeReason, setRemoveReason] = useState('');
  const remove = useAction(() => api.del(`/tasks/${id}?reason=${encodeURIComponent(removeReason)}`), { success: 'המשימה הוסרה מהאירוע', invalidate: inv, onSuccess: onClose });
  const reopen = useAction(() => api.post(`/tasks/${id}/reopen`), { success: 'המשימה נפתחה מחדש', invalidate: inv });
  const t = q.data?.task;
  const canAct = !!t && canActFn(t);
  const open = t && t.status !== 'done' && t.status !== 'cancelled';
  const candidates = t ? usersWithRole(dir.data, t.role, t.venue).filter((u) => u.id !== t.assigneeId) : [];

  return (
    <Dialog open onClose={onClose} title={t?.title ?? 'משימה'} size="md"
      footer={!canAct ? undefined : t && !open ? <Button icon={<RotateCcw className="size-4" />} loading={reopen.isPending} onClick={() => reopen.mutate(undefined)}>פתיחה מחדש</Button> : open && (
        <>
          <Button variant="ghost" className="me-auto" icon={<Pencil className="size-4" />} onClick={() => setEditing((x) => !x)}>עריכה ומועד</Button>
          <Button variant="ghost" icon={<Trash2 className="size-4 text-[var(--color-danger)]" />} onClick={() => setRemoving((x) => !x)}>הסרה</Button>
          {t.assigneeId === me.id && <Button variant="ghost" icon={<CornerDownLeft className="size-4" />} loading={release.isPending} onClick={() => release.mutate(undefined)}>החזרה לתור</Button>}
          {!t.assigneeId && <Button icon={<Hand className="size-4" />} loading={claim.isPending} onClick={() => claim.mutate(undefined)}>לקחת אחריות</Button>}
          {t.status === 'blocked'
            ? <Button icon={<Play className="size-4" />} loading={unblock.isPending} onClick={() => unblock.mutate(undefined)}>הסרת חסימה</Button>
            : <Button variant="ghost" icon={<OctagonX className="size-4 text-[var(--color-danger)]" />} onClick={() => setBlockOpen(true)}>סימון כחסום</Button>}
          <Button variant="primary" icon={<CheckCircle2 className="size-4" />} loading={complete.isPending} onClick={() => complete.mutate(undefined)}>סימון כבוצע</Button>
        </>
      )}>
      {!q.data ? <Loading rows={3} /> : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            <StatusPill kind="task" value={t!.status} />
            <Badge>{ROLES[t!.role]}{t!.venue ? ` · ${VENUE_LABEL[t!.venue]}` : ''}</Badge>
            {t!.stage && <Badge tone="brand">{WORK_STAGES[t!.stage]?.label}</Badge>}
            {t!.required ? <Badge tone="brand">נדרש למוכנות</Badge> : null}
            {t!.dueAt && <Badge tone={t!.overdue ? 'danger' : 'neutral'}><Clock className="size-3" />יעד {formatTs(t!.dueAt)}</Badge>}
          </div>
          <p className="text-[15px]">{t!.action}</p>
          {t!.status === 'blocked' && (
            <div role="alert" className="rounded-[10px] border border-[var(--color-danger)] bg-[var(--color-danger-soft)] p-3 text-sm">
              <strong className="text-[var(--color-danger)]">חסום:</strong> {t!.blockedReason}
              <div className="text-xs text-[var(--color-muted)]">{t!.blockedByName} · {formatTs(t!.blockedAt)}</div>
            </div>
          )}
          {editing && t && <TaskEditForm t={t} onDone={() => setEditing(false)} />}
          {removing && (
            <div className="space-y-2 rounded-[10px] border border-[var(--color-danger)] p-3">
              <p className="text-sm">המשימה תוסר מהאירוע הזה בלבד (נשמרת בהיסטוריה ולא תיווצר שוב לאירוע). להסרה מכל האירועים – בתבנית העבודה או בהגדרות המשימות האוטומטיות.</p>
              <Field label="סיבת ההסרה" required error={remove.error?.fields.reason}>{(p) => <Input {...p} data-autofocus value={removeReason} onChange={(e) => setRemoveReason(e.target.value)} placeholder="למשל: לא רלוונטי לאירוע מגשים" />}</Field>
              <div className="flex justify-end gap-2">
                <Button size="sm" onClick={() => setRemoving(false)}>ביטול</Button>
                <Button size="sm" variant="danger" loading={remove.isPending} onClick={() => remove.mutate(undefined)}>הסרה מהאירוע</Button>
              </div>
            </div>
          )}
          {blockOpen && (
            <div className="space-y-2 rounded-[10px] border border-[var(--color-danger)] p-3">
              <Field label="מה חוסם ומי צריך להחליט?" required error={block.error?.fields.reason}>{(p) => <Textarea {...p} data-autofocus rows={2} value={blockReason} onChange={(e) => setBlockReason(e.target.value)} />}</Field>
              <div className="flex justify-end gap-2">
                <Button size="sm" onClick={() => setBlockOpen(false)}>ביטול</Button>
                <Button size="sm" variant="danger" loading={block.isPending} onClick={() => block.mutate(undefined)}>סימון כחסום</Button>
              </div>
            </div>
          )}
          {t!.eventId && <Link to={`/events/${t!.eventId}`} onClick={onClose} className="inline-block text-sm font-semibold text-[var(--color-brand)] underline">מעבר לאירוע: {t!.eventTitle}</Link>}
          {!t!.eventId && t!.clientId && <Link to={`/clients/${t!.clientId}`} onClick={onClose} className="inline-block text-sm font-semibold text-[var(--color-brand)] underline">מעבר לכרטיס הלקוח: {t!.clientName}</Link>}
          <div className="rounded-[10px] bg-[var(--color-surface-2)] p-3 text-sm">
            <div><span className="font-semibold">טריגר:</span> {q.data.trigger}</div>
            <div><span className="font-semibold">עדות לסיום:</span> {q.data.evidence}{q.data.auto && ' (נסגרת אוטומטית כשהנתון מתועד)'}</div>
            <div><span className="font-semibold">מטפל:</span> {t!.assigneeName ?? 'טרם נלקחה'}</div>
            {t!.evidence && <div><span className="font-semibold">תיעוד סיום:</span> {t!.evidence}</div>}
          </div>
          {!canAct && t && <p className="rounded-[10px] bg-[var(--color-surface-2)] p-3 text-sm">צפייה בלבד – המשימה באחריות {ROLES[t.role]}{t.assigneeName ? ` (${t.assigneeName})` : ''}.</p>}
          {open && canAct && (
            <>
              <Field label="הערה / עדכון טיפול" hint={q.data.auto ? 'לסגירה ידנית של משימה אוטומטית יש לפרט מה בוצע' : undefined}>
                {(p) => <Textarea {...p} value={note} onChange={(e) => setNote(e.target.value)} rows={2} />}
              </Field>
              <div className="flex flex-wrap items-end gap-2">
                <Button size="sm" disabled={!note.trim()} loading={addNote.isPending} onClick={() => addNote.mutate(undefined)}>שמירת עדכון</Button>
                <div className="ms-auto flex items-end gap-2">
                  <Field label="העברה למחליף מורשה" className="w-52">
                    {(p) => <Select {...p} value={transferTo} onChange={(e) => setTransferTo(e.target.value)} placeholder="בחירה…" options={candidates.map((u) => ({ value: u.id, label: u.name }))} />}
                  </Field>
                  <Button size="sm" icon={<ArrowLeftRight className="size-3.5" />} disabled={!transferTo} loading={transfer.isPending} onClick={() => transfer.mutate(undefined)}>העברה</Button>
                </div>
              </div>
              <FormError message={complete.error?.fields.note} />
            </>
          )}
          <div>
            <h3 className="mb-2 text-sm font-bold">היסטוריית ביצוע</h3>
            <ol className="space-y-2 border-s-2 border-[var(--color-border)] ps-3">
              {q.data.log.map((l) => (
                <li key={l.id} className="text-sm">
                  <span className="font-semibold">{LOG_LABEL[l.action] ?? l.action}</span>
                  <span className="text-[var(--color-muted)]"> · {l.userName ?? 'מערכת'} · {formatTs(l.at)}</span>
                  {l.note && <div className="text-[var(--color-ink-2)]">{l.note}</div>}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </Dialog>
  );
}

const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

/** Hand-edit any task: wording, stage, role, handler, due time, readiness and escalation (overrides the defaults). */
function TaskEditForm({ t, onDone }: { t: TaskRecord; onDone: () => void }) {
  const dir = useDirectory();
  const [v, setV] = useState({
    title: t.title, action: t.action, stage: t.stage, role: t.role, assigneeId: t.assigneeId ? String(t.assigneeId) : '',
    due: toLocalInput(t.dueAt), required: !!t.required, escalation: t.escalation ?? '',
  });
  const save = useAction(() => api.patch(`/tasks/${t.id}`, {
    version: t.version, title: v.title, action: v.action, stage: v.stage, role: v.role,
    assigneeId: v.assigneeId ? Number(v.assigneeId) : null, dueAt: v.due ? new Date(v.due).toISOString() : null,
    required: v.required, escalation: v.escalation || null,
  }), { success: 'המשימה עודכנה', invalidate: [['tasks'], ['task', t.id], ['event'], ['dashboard']], onSuccess: onDone });
  const shift = (h: number) => {
    const base = v.due ? new Date(v.due) : new Date();
    base.setHours(base.getHours() + h);
    setV({ ...v, due: toLocalInput(base.toISOString()) });
  };
  return (
    <div className="space-y-3 rounded-[10px] border border-[var(--color-brand)] p-3">
      <FormError message={save.error?.message} />
      <Field label="משימה" error={save.error?.fields.title}>{(p) => <Input {...p} data-autofocus value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />}</Field>
      <Field label="פירוט">{(p) => <Textarea {...p} rows={2} value={v.action} onChange={(e) => setV({ ...v, action: e.target.value })} />}</Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="שלב">{(p) => <Select {...p} value={v.stage} onChange={(e) => setV({ ...v, stage: e.target.value as WorkStage })} options={WORK_STAGE_ORDER.map((s) => ({ value: s, label: `${WORK_STAGES[s].n}. ${WORK_STAGES[s].label}` }))} />}</Field>
        <Field label="תפקיד אחראי">{(p) => <Select {...p} value={v.role} onChange={(e) => setV({ ...v, role: e.target.value as Role, assigneeId: '' })} options={optionsOf(ROLES)} />}</Field>
        <Field label="מטפל" hint="ריק = בתור של התפקיד">{(p) => <Select {...p} value={v.assigneeId} onChange={(e) => setV({ ...v, assigneeId: e.target.value })} placeholder="בתור" options={usersWithRole(dir.data, v.role, t.venue).map((u) => ({ value: u.id, label: u.name }))} />}</Field>
        <Field label="מועד יעד" error={save.error?.fields.dueAt}>{(p) => <Input {...p} type="datetime-local" value={v.due} onChange={(e) => setV({ ...v, due: e.target.value })} />}</Field>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-[var(--color-muted)]">הזזת המועד:</span>
        {[-24, -3, 3, 24, 72].map((h) => <Button key={h} size="sm" variant="ghost" onClick={() => shift(h)}>{h > 0 ? '+' : '−'}{Math.abs(h) >= 24 ? `${Math.abs(h) / 24} ימים` : `${Math.abs(h)} ש׳`}</Button>)}
        <Button size="sm" variant="ghost" onClick={() => setV({ ...v, due: '' })}>ללא מועד</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Checkbox label="נדרש למוכנות" checked={v.required} onChange={(c) => setV({ ...v, required: c })} />
        <Field label="הסלמה להנהלה">{(p) => <Select {...p} value={v.escalation} onChange={(e) => setV({ ...v, escalation: e.target.value as never })} placeholder="לפי ברירת המחדל בהגדרות" options={[{ value: 'always', label: 'תמיד כשאין מטפל או באיחור' }, { value: 'never', label: 'לא להסלים משימה זו' }]} />}</Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" onClick={onDone}>ביטול</Button>
        <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>שמירה</Button>
      </div>
    </div>
  );
}
