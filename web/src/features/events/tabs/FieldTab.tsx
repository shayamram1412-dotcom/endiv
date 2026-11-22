/** Field reports and the confirmation dialog, shared by the execution screen (FieldView). */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Megaphone, Check } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../../../lib/api.ts';
import { useAction } from '../../../lib/query.ts';
import { useAuth } from '../../../lib/auth.tsx';
import { Card, EmptyState, QueryView } from '../../../ui/layout.tsx';
import { Button } from '../../../ui/Button.tsx';
import { Badge } from '../../../ui/Badge.tsx';
import { Dialog } from '../../../ui/Dialog.tsx';
import { Checkbox, Field, FormError, Select, Textarea, optionsOf } from '../../../ui/form.tsx';
import { CONFIRMATIONS, REPORT_KIND, REPORT_TARGET, VENUE_RULES, type ConfirmationKind } from '@shared/domain.ts';
import { formatTs } from '@shared/dates.ts';
import type { ConfirmationRecord, EventDetail, FieldReport } from '@shared/types.ts';

export const CONF_ROLE: Record<ConfirmationKind, 'kitchen' | 'event_manager' | 'ops'> = {
  kitchen_ready: 'kitchen', field_ready: 'event_manager', loaded: 'ops', unloaded: 'ops', executed: 'event_manager', rentals_returned: 'event_manager',
};

export function ReportsPanel({ eventId, reports, canReport, big }: { eventId: number; reports: { data: FieldReport[] | undefined; isLoading: boolean; error: unknown; refetch: () => unknown }; canReport: boolean; big?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Card title="דיווחים בזמן האירוע" actions={canReport && <Button size={big ? 'lg' : 'sm'} variant="primary" icon={<Megaphone className="size-4" />} onClick={() => setOpen(true)}>דיווח חדש</Button>}>
      <QueryView q={reports} empty={(l) => (l.length ? null : <EmptyState title="אין דיווחים" text="שינוי בשטח מגיע למטבח, בעיית מטבח מגיעה למנהל האירוע. כל דיווח נפרד." />)}>
        {(list) => <ul className="space-y-3">{list.map((r) => <ReportItem key={r.id} r={r} eventId={eventId} big={big} />)}</ul>}
      </QueryView>
      {open && <NewReportDialog eventId={eventId} onClose={() => setOpen(false)} />}
    </Card>
  );
}

function ReportItem({ r, eventId, big }: { r: FieldReport; eventId: number; big?: boolean }) {
  const [decision, setDecision] = useState('');
  const inv = [['event', eventId], ['field'], ['dashboard'], ['tasks']];
  const ack = useAction(() => api.post(`/reports/${r.id}/ack`), { success: 'אישרת קבלה', invalidate: inv });
  const resolve = useAction(() => api.post(`/reports/${r.id}/resolve`, { decision }), { success: 'הדיווח סומן כמטופל', invalidate: inv });
  const resolved = !!r.resolvedAt;
  return (
    <li className={clsx('rounded-[12px] border p-3', resolved ? 'border-[var(--color-border)] opacity-80' : r.urgent ? 'border-2 border-[var(--color-danger)]' : 'border-[var(--color-warn)]')}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={r.kind === 'shortage' || r.kind === 'issue' ? 'danger' : 'info'}>{REPORT_KIND[r.kind]}</Badge>
        <Badge>אל: {REPORT_TARGET[r.target]}</Badge>
        {r.urgent ? <Badge tone="danger">דחוף</Badge> : null}
        <span className="ms-auto text-xs text-[var(--color-muted)]">{r.reportedByName} · {formatTs(r.at)}</span>
      </div>
      <p className={clsx('mt-2', big ? 'text-lg' : 'text-[15px]')}>{r.content}</p>
      <div className="mt-2 space-y-0.5 text-xs text-[var(--color-muted)]">
        <div>אישור קבלה: {r.ackedAt ? `${r.ackedByName} · ${formatTs(r.ackedAt)}` : <strong className="text-[var(--color-warn)]">טרם נראה</strong>}</div>
        {resolved && <div>החלטה: <span className="text-[var(--color-ink)]">{r.decision}</span> · {r.resolvedByName} · {formatTs(r.resolvedAt)}</div>}
      </div>
      {!resolved && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          {!r.ackedAt && <Button size={big ? 'lg' : 'sm'} icon={<Check className="size-4" />} loading={ack.isPending} onClick={() => ack.mutate(undefined)}>ראיתי</Button>}
          <input aria-label="מה הוחלט" className="input min-w-48 flex-1" placeholder="מה הוחלט / איך טופל" value={decision} onChange={(e) => setDecision(e.target.value)} />
          <Button size={big ? 'lg' : 'sm'} variant="success" disabled={decision.trim().length < 2} loading={resolve.isPending} onClick={() => resolve.mutate(undefined)}>טופל</Button>
        </div>
      )}
    </li>
  );
}

export function NewReportDialog({ eventId, onClose }: { eventId: number; onClose: () => void }) {
  const auth = useAuth();
  const [kind, setKind] = useState('shortage');
  const [target, setTarget] = useState(auth.hasRole('kitchen') && !auth.hasRole('event_manager') ? 'event_manager' : 'kitchen');
  const [content, setContent] = useState('');
  const [urgent, setUrgent] = useState(false);
  const save = useAction(() => api.post(`/events/${eventId}/reports`, { kind, target, content, urgent }), { success: 'הדיווח נשלח', invalidate: [['event', eventId], ['field'], ['dashboard']], onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} title="דיווח מהשטח" size="sm" footer={<><Button onClick={onClose}>ביטול</Button><Button variant="primary" size="lg" loading={save.isPending} onClick={() => save.mutate(undefined)}>שליחה</Button></>}>
      <div className="space-y-4">
        <FormError message={save.error?.message} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="סוג">{(p) => <Select {...p} value={kind} onChange={(e) => setKind(e.target.value)} options={optionsOf(REPORT_KIND)} />}</Field>
          <Field label="אל">{(p) => <Select {...p} value={target} onChange={(e) => setTarget(e.target.value)} options={optionsOf(REPORT_TARGET)} />}</Field>
        </div>
        <Field label="מה קרה" required error={save.error?.fields.content}>{(p) => <Textarea {...p} rows={3} data-autofocus value={content} onChange={(e) => setContent(e.target.value)} placeholder="למשל: חסרות 20 מנות שניצל לילדים בשולחנות 8-12" />}</Field>
        <Checkbox label="דחוף" checked={urgent} onChange={setUrgent} />
      </div>
    </Dialog>
  );
}

export function ConfirmDialog({ eventId, kind, readiness, onClose }: { eventId: number; kind: ConfirmationKind; readiness: EventDetail['readiness']; onClose: () => void }) {
  const [note, setNote] = useState('');
  const save = useAction(() => api.post(`/events/${eventId}/confirm`, { kind, note }), { success: 'האישור נרשם', invalidate: [['event', eventId], ['tasks'], ['dashboard'], ['field']], onSuccess: onClose });
  const open = readiness.items.filter((i) => !i.done && !['kitchen_ready', 'field_ready', 'loaded'].includes(i.key));
  return (
    <Dialog open onClose={onClose} title={CONFIRMATIONS[kind]} size="sm" footer={<><Button onClick={onClose}>ביטול</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>אישור</Button></>}>
      <div className="space-y-3">
        <FormError message={save.error?.message} />
        {(kind === 'kitchen_ready' || kind === 'field_ready') && open.length > 0 && (
          <div className="rounded-[10px] bg-[var(--color-warn-soft)] p-3 text-sm text-[var(--color-warn)]">
            פריטים שעדיין פתוחים: {open.map((i) => i.label).join(', ')}. לאישור בכל זאת יש לפרט בהערה.
          </div>
        )}
        <Field label="הערה" error={save.error?.fields.note}>{(p) => <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}
