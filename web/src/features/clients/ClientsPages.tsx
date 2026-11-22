import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Phone, Mail, Plus, PhoneCall, UserPlus, ArrowRight, Trash2, Save, CalendarClock } from 'lucide-react';
import { api, qs } from '../../lib/api.ts';
import { useAction } from '../../lib/query.ts';
import { useAuth } from '../../lib/auth.tsx';
import { useUrlState } from '../../lib/useUrlState.ts';
import { useEditForm, ConflictPanel, UnsavedGuard } from '../../lib/useEditForm.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { useSettings } from '../../lib/settings.ts';
import { Card, EmptyState, ErrorState, Loading, PageHeader, QueryView } from '../../ui/layout.tsx';
import { Button, LinkButton } from '../../ui/Button.tsx';
import { Badge, StatusPill, VenueTag } from '../../ui/Badge.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import { Checkbox, Field, FormError, Input, Select, Textarea, optionsOf } from '../../ui/form.tsx';
import { SalesOrIntake } from '../events/shared.tsx';
import { DocumentsPanel } from '../events/tabs/DocumentsPanel.tsx';
import { TaskRows } from '../tasks/TaskList.tsx';
import { ExportButton } from '../process/ProcessPages.tsx';
import { ACTIVITY_KIND, CLIENT_KIND, MEETING_KIND, type VenueCode } from '@shared/domain.ts';
import { formatDay, formatTs, today, addDays } from '@shared/dates.ts';
import type { ActivityRecord, ClientRecord, ContactRecord, EventListItem, MeetingRecord, TaskRecord } from '@shared/types.ts';

interface ClientRow extends ClientRecord { eventCount: number; nextEvent: string | null; lastActivity: string | null; nextCall: string | null; venues: string | null }

export function ClientsListPage() {
  const auth = useAuth();
  const [s, set] = useUrlState({ q: '', kind: '' });
  const q = useQuery({ queryKey: ['clients', s], queryFn: () => api.get<ClientRow[]>(`/clients${qs(s)}`) });
  const [open, setOpen] = useState(false);
  return (
    <div>
      <PageHeader title="לקוחות ומפיקים" subtitle="כרטיס לקוח מרכז את כל האירועים, התפריט לכל אירוע, השיחות, ההבטחות והמסמכים."
        actions={<><ExportButton kind="clients" />{auth.can('clients', 2) && <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setOpen(true)}>לקוח חדש</Button>}</>} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input aria-label="חיפוש" placeholder="שם, טלפון, חברה או מייל" value={s.q} onChange={(e) => set({ q: e.target.value })} className="w-72" />
        <Select aria-label="סוג לקוח" value={s.kind} onChange={(e) => set({ kind: e.target.value })} placeholder="כל הסוגים" options={optionsOf(CLIENT_KIND)} className="w-40" />
      </div>
      <Card bodyClass="p-0">
        <QueryView q={q} empty={(l) => (l.length ? null : <EmptyState title="לא נמצאו לקוחות" />)}>
          {(list) => (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>לקוח</th><th>טלפון</th><th>סוג</th><th className="text-end">אירועים</th><th>אירוע הבא</th><th>שיחה מתוכננת</th><th>פעילות אחרונה</th></tr></thead>
                <tbody>
                  {list.map((c) => (
                    <tr key={c.id}>
                      <td><Link to={`/clients/${c.id}`} className="font-semibold hover:text-[var(--color-brand)] hover:underline">{c.name}</Link>{c.company && <div className="text-xs text-[var(--color-muted)]">{c.company}</div>}</td>
                      <td className="num">{c.phone}</td>
                      <td><Badge tone={c.kind === 'producer' ? 'brand' : 'neutral'}>{CLIENT_KIND[c.kind]}</Badge></td>
                      <td className="num text-end">{c.eventCount}</td>
                      <td>{c.nextEvent ? formatDay(c.nextEvent) : '—'}</td>
                      <td>{c.nextCall ? <Badge tone={c.nextCall.slice(0, 10) <= today() ? 'danger' : 'info'}>{formatDay(c.nextCall.slice(0, 10))}</Badge> : '—'}</td>
                      <td className="text-sm text-[var(--color-muted)]">{c.lastActivity ? formatTs(c.lastActivity) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </QueryView>
      </Card>
      {open && <NewClientDialog onClose={() => setOpen(false)} />}
    </div>
  );
}

function NewClientDialog({ onClose }: { onClose: () => void }) {
  const settings = useSettings();
  const nav = useNavigate();
  const [v, setV] = useState({ name: '', phone: '', email: '', kind: 'private', company: '', source: '', notes: '' });
  const save = useAction(() => api.post<{ id: number }>('/clients', v), { success: 'כרטיס הלקוח נפתח', invalidate: [['clients']], onSuccess: (r) => { onClose(); nav(`/clients/${r.id}`); } });
  const dup = save.error?.code === 'duplicate_client' ? (save.error.details as unknown as { clientId: number; name: string }) : null;
  return (
    <Dialog open onClose={onClose} title="לקוח חדש" footer={<><Button onClick={onClose}>ביטול</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>פתיחת כרטיס</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FormError message={save.error?.message} />
          {dup && <Link to={`/clients/${dup.clientId}`} onClick={onClose} className="mt-2 inline-block text-sm font-semibold text-[var(--color-brand)] underline">מעבר לכרטיס של {dup.name}</Link>}
        </div>
        <Field label="שם" required error={save.error?.fields.name}>{(p) => <Input {...p} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
        <Field label="טלפון" required error={save.error?.fields.phone}>{(p) => <Input {...p} type="tel" dir="ltr" className="text-start" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />}</Field>
        <Field label="סוג">{(p) => <Select {...p} value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })} options={optionsOf(CLIENT_KIND)} />}</Field>
        <Field label="מייל" error={save.error?.fields.email}>{(p) => <Input {...p} type="email" dir="ltr" className="text-start" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />}</Field>
        <Field label="חברה">{(p) => <Input {...p} value={v.company} onChange={(e) => setV({ ...v, company: e.target.value })} />}</Field>
        <Field label="מקור">{(p) => <Select {...p} value={v.source} onChange={(e) => setV({ ...v, source: e.target.value })} placeholder="לא ידוע" options={settings.lists.leadSources.map((x) => ({ value: x, label: x }))} />}</Field>
      </div>
    </Dialog>
  );
}

interface ClientDetail {
  client: ClientRecord; contacts: ContactRecord[]; events: EventListItem[]; menus: Record<number, string[]>;
  activities: ActivityRecord[]; meetings: MeetingRecord[]; canEdit: boolean; canSell: boolean;
}

export function ClientPage() {
  const id = Number(useParams().id);
  const q = useQuery({ queryKey: ['client', id], queryFn: () => api.get<ClientDetail>(`/clients/${id}`) });
  const tasks = useQuery({ queryKey: ['tasks', { client: id }], queryFn: () => api.get<TaskRecord[]>(`/tasks?client=${id}`) });
  const auth = useAuth();
  if (q.isLoading) return <Loading rows={8} />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const upcomingCalls = d.activities.filter((a) => a.nextActionAt && !a.nextActionDone);

  return (
    <div>
      <Link to="/clients" onClick={(e) => { if (window.history.length > 1) { e.preventDefault(); window.history.back(); } }} className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-muted)] hover:text-[var(--color-ink)]"><ArrowRight className="size-4" />חזרה</Link>
      <PageHeader eyebrow={CLIENT_KIND[d.client.kind]} title={d.client.name}
        actions={<>
          {d.client.phone && <a href={`tel:${d.client.phone}`} className="num inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-[var(--color-border-strong)] px-3 text-sm font-semibold"><Phone className="size-4" />{d.client.phone}</a>}
          {d.client.email && <a href={`mailto:${d.client.email}`} className="inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-[var(--color-border-strong)] px-3 text-sm font-semibold"><Mail className="size-4" />מייל</a>}
          {auth.can('sales', 2) && <LinkButton to={`/events/new`} variant="primary" icon={<Plus className="size-4" />}>אירוע נוסף</LinkButton>}
        </>}>
        {d.client.company && <p className="text-sm text-[var(--color-ink-2)]">{d.client.company}</p>}
      </PageHeader>

      <div className="grid gap-5 xl:grid-cols-[1fr_400px]">
        <div className="space-y-5">
          {upcomingCalls.length > 0 && (
            <div className="rounded-[14px] border border-[var(--color-info)] bg-[var(--color-info-soft)] p-4">
              <div className="mb-1 flex items-center gap-2 font-bold text-[var(--color-info)]"><CalendarClock className="size-4" />מתי לחזור</div>
              {upcomingCalls.map((a) => <div key={a.id} className="text-sm"><strong>{formatTs(a.nextActionAt)}</strong> · {a.nextAction} <span className="text-[var(--color-muted)]">({a.userName})</span></div>)}
            </div>
          )}
          <Card title={`אירועים (${d.events.length})`}>
            {!d.events.length ? <EmptyState title="אין אירועים עדיין" /> : (
              <ul className="space-y-3">
                {d.events.map((e) => (
                  <li key={e.id} className="rounded-[12px] border border-[var(--color-border)] p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={`/events/${e.id}`} className="font-bold hover:text-[var(--color-brand)] hover:underline">{e.title}</Link>
                      <VenueTag venue={e.venue as VenueCode} />
                      <span className="text-sm text-[var(--color-ink-2)]">{formatDay(e.date)} · {e.guests} אורחים</span>
                      <span className="ms-auto flex gap-1.5"><SalesOrIntake e={e} /><StatusPill kind="menu" value={e.menuStatus} /></span>
                    </div>
                    <div className="mt-2 text-sm">
                      <span className="font-semibold text-[var(--color-muted)]">תפריט: </span>
                      {d.menus[e.id]?.length ? d.menus[e.id].join(' · ') : <span className="text-[var(--color-muted)]">ייקבע בטעימות</span>}
                      {d.menus[e.id]?.length ? <Link to={`/events/${e.id}/menu`} className="ms-2 text-xs font-semibold text-[var(--color-brand)]">לתפריט המלא</Link> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <ActivityLog d={d} />
          <DocumentsPanel eventId={null} clientId={d.client.id} canEdit={d.canEdit} events={d.events.map((e) => ({ id: e.id, title: e.title }))} />
        </div>
        <aside className="space-y-5">
          <ClientDetailsCard client={d.client} canEdit={d.canEdit} />
          <ContactsCard clientId={d.client.id} contacts={d.contacts} canEdit={d.canEdit} />
          {(tasks.data?.length ?? 0) > 0 && <Card title="משימות פתוחות" bodyClass="px-4 py-1"><TaskRows tasks={tasks.data!} compact /></Card>}
          {d.meetings.length > 0 && (
            <Card title="סיורים וטעימות">
              <ul className="space-y-2 text-sm">
                {d.meetings.map((m) => <li key={m.id} className="flex justify-between gap-2"><span><strong>{MEETING_KIND[m.kind]}</strong>{m.eventTitle ? ` · ${m.eventTitle}` : ''}</span><span className="text-[var(--color-muted)]">{formatDay(m.date)} {m.time}</span></li>)}
              </ul>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

function ActivityLog({ d }: { d: ClientDetail }) {
  const [kind, setKind] = useState('call');
  const [content, setContent] = useState('');
  const [outcome, setOutcome] = useState('');
  const [eventId, setEventId] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [nextAt, setNextAt] = useState('');
  const save = useAction(() => api.post(`/clients/${d.client.id}/activities`, { kind, content, outcome, eventId: eventId ? Number(eventId) : null, nextAction, nextActionAt: nextAt || null }), {
    success: 'הפעילות תועדה', invalidate: [['client', d.client.id], ['tasks'], ['calendar'], ['dashboard']],
    onSuccess: () => { setContent(''); setOutcome(''); setNextAction(''); setNextAt(''); },
  });
  const canLog = d.canEdit || d.canSell;
  return (
    <Card title="שיחות, הערות והיסטוריית שירות">
      {canLog && (
        <div className="mb-5 space-y-3 rounded-[12px] bg-[var(--color-surface-2)] p-3">
          <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
            <Field label="סוג">{(p) => <Select {...p} value={kind} onChange={(e) => setKind(e.target.value)} options={optionsOf(ACTIVITY_KIND)} />}</Field>
            <Field label="שיוך לאירוע">{(p) => <Select {...p} value={eventId} onChange={(e) => setEventId(e.target.value)} placeholder="כללי ללקוח" options={d.events.map((e) => ({ value: e.id, label: `${e.title} (${formatDay(e.date)})` }))} />}</Field>
          </div>
          <Field label="מה נאמר / מה הובטח" required error={save.error?.fields.content}>{(p) => <Textarea {...p} rows={2} value={content} onChange={(e) => setContent(e.target.value)} />}</Field>
          <Field label="תוצאה">{(p) => <Input {...p} value={outcome} onChange={(e) => setOutcome(e.target.value)} />}</Field>
          <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
            <Field label="הפעולה הבאה" error={save.error?.fields.nextAction}>{(p) => <Input {...p} value={nextAction} onChange={(e) => setNextAction(e.target.value)} placeholder="למשל: לחזור עם הצעה מעודכנת" />}</Field>
            <Field label="מתי" hint="תיווצר משימה ביומן">{(p) => <Input {...p} type="datetime-local" min={`${today()}T00:00`} value={nextAt} onChange={(e) => setNextAt(e.target.value)} />}</Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {[1, 3, 7].map((n) => <Button key={n} size="sm" variant="ghost" onClick={() => setNextAt(`${addDays(today(), n)}T10:00`)}>בעוד {n === 1 ? 'יום' : `${n} ימים`}</Button>)}
            <Button className="ms-auto" variant="primary" icon={<PhoneCall className="size-4" />} loading={save.isPending} disabled={content.trim().length < 2} onClick={() => save.mutate(undefined)}>תיעוד</Button>
          </div>
          <FormError message={save.error && !Object.keys(save.error.fields).length ? save.error.message : null} />
        </div>
      )}
      {!d.activities.length ? <EmptyState title="אין עדיין פעילות" /> : (
        <ol className="space-y-4 border-s-2 border-[var(--color-border)] ps-4">
          {d.activities.map((a) => (
            <li key={a.id} className="relative">
              <span className="absolute -start-[23px] top-1.5 size-3 rounded-full border-2 border-[var(--color-surface)] bg-[var(--color-brand)]" aria-hidden />
              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted)]">
                <Badge tone={a.kind === 'complaint' ? 'danger' : a.kind === 'feedback' ? 'ok' : 'neutral'}>{ACTIVITY_KIND[a.kind]}</Badge>
                <span className="font-semibold text-[var(--color-ink-2)]">{a.userName}</span>
                <span>{formatTs(a.at)}</span>
                {a.eventTitle && <Link to={`/events/${a.eventId}`} className="font-semibold text-[var(--color-brand)]">{a.eventTitle}</Link>}
              </div>
              <p className="mt-1 text-[15px]">{a.content}</p>
              {a.outcome && <p className="text-sm text-[var(--color-ink-2)]">תוצאה: {a.outcome}</p>}
              {a.nextAction && <p className="text-sm"><span className={a.nextActionDone ? 'line-through text-[var(--color-muted)]' : 'font-semibold text-[var(--color-info)]'}>המשך: {a.nextAction}{a.nextActionAt ? ` · ${formatTs(a.nextActionAt)}` : ''}</span></p>}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function ClientDetailsCard({ client, canEdit }: { client: ClientRecord; canEdit: boolean }) {
  const settings = useSettings();
  const qc = useQueryClient();
  const toast = useToast();
  const src = useMemo(() => ({ name: client.name, phone: client.phone, email: client.email, kind: client.kind, company: client.company, source: client.source, notes: client.notes }), [client]);
  const f = useEditForm(src);
  const [busy, setBusy] = useState(false);
  const v = f.values ?? src;
  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/clients/${client.id}`, { changes: f.changes, base: f.base() });
      f.saved();
      toast.success('פרטי הלקוח נשמרו');
      await qc.invalidateQueries({ queryKey: ['client', client.id] });
    } catch (e) { f.handleError(e); } finally { setBusy(false); }
  };
  return (
    <Card title="פרטי לקוח" actions={canEdit && f.dirty && <Button size="sm" variant="primary" icon={<Save className="size-4" />} loading={busy} onClick={() => void save()}>שמירה</Button>}>
      <UnsavedGuard when={f.dirty} />
      <ConflictPanel conflicts={f.conflicts} onResolve={f.resolve} />
      <FormError message={f.conflicts.length ? null : f.formError} />
      <fieldset disabled={!canEdit} className="space-y-3">
        <Field label="שם" error={f.errors.name}>{(p) => <Input {...p} value={v.name} onChange={(e) => f.set('name', e.target.value)} />}</Field>
        <Field label="טלפון" error={f.errors.phone}>{(p) => <Input {...p} dir="ltr" className="text-start" value={v.phone} onChange={(e) => f.set('phone', e.target.value)} />}</Field>
        <Field label="מייל" error={f.errors.email}>{(p) => <Input {...p} dir="ltr" className="text-start" value={v.email} onChange={(e) => f.set('email', e.target.value)} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="סוג">{(p) => <Select {...p} value={v.kind} onChange={(e) => f.set('kind', e.target.value as never)} options={optionsOf(CLIENT_KIND)} />}</Field>
          <Field label="מקור">{(p) => <Select {...p} value={v.source} onChange={(e) => f.set('source', e.target.value)} placeholder="לא ידוע" options={settings.lists.leadSources.map((x) => ({ value: x, label: x }))} />}</Field>
        </div>
        <Field label="חברה">{(p) => <Input {...p} value={v.company} onChange={(e) => f.set('company', e.target.value)} />}</Field>
        <Field label="הערות קבועות">{(p) => <Textarea {...p} rows={3} value={v.notes} onChange={(e) => f.set('notes', e.target.value)} />}</Field>
      </fieldset>
    </Card>
  );
}

function ContactsCard({ clientId, contacts, canEdit }: { clientId: number; contacts: ContactRecord[]; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ name: '', role: '', phone: '', email: '', isEndClient: false });
  const add = useAction(() => api.post(`/clients/${clientId}/contacts`, v), { success: 'איש הקשר נוסף', invalidate: [['client', clientId]], onSuccess: () => { setOpen(false); setV({ name: '', role: '', phone: '', email: '', isEndClient: false }); } });
  const del = useAction((cid: number) => api.del(`/clients/${clientId}/contacts/${cid}`), { invalidate: [['client', clientId]] });
  return (
    <Card title="אנשי קשר" actions={canEdit && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>הוספה</Button>}>
      {!contacts.length ? <p className="text-sm text-[var(--color-muted)]">אין אנשי קשר נוספים.</p> : (
        <ul className="space-y-2.5">
          {contacts.map((c) => (
            <li key={c.id} className="flex items-start gap-2">
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-semibold">{c.name} {c.isEndClient ? <Badge tone="brand">לקוח סופי</Badge> : null}</div>
                <div className="text-xs text-[var(--color-muted)]">{c.role}{c.phone && <> · <a className="num" href={`tel:${c.phone}`}>{c.phone}</a></>}{c.email && ` · ${c.email}`}</div>
              </div>
              {canEdit && <button onClick={() => del.mutate(c.id)} className="p-1 text-[var(--color-danger)]" aria-label={`הסרת ${c.name}`}><Trash2 className="size-4" /></button>}
            </li>
          ))}
        </ul>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title="איש קשר" size="sm" footer={<><Button onClick={() => setOpen(false)}>ביטול</Button><Button variant="primary" loading={add.isPending} onClick={() => add.mutate(undefined)}>הוספה</Button></>}>
        <div className="space-y-3">
          <Field label="שם" required error={add.error?.fields.name}>{(p) => <Input {...p} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
          <Field label="תפקיד">{(p) => <Input {...p} value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })} placeholder="מפיקה, מנהלת רווחה…" />}</Field>
          <Field label="טלפון" error={add.error?.fields.phone}>{(p) => <Input {...p} dir="ltr" className="text-start" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />}</Field>
          <Field label="מייל" error={add.error?.fields.email}>{(p) => <Input {...p} dir="ltr" className="text-start" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />}</Field>
          <Checkbox label="איש קשר מטעם הלקוח הסופי" checked={v.isEndClient} onChange={(c) => setV({ ...v, isEndClient: c })} />
        </div>
      </Dialog>
    </Card>
  );
}
