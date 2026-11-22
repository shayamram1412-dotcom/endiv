import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileSignature, Plus, MapPin, Printer } from 'lucide-react';
import { api } from '../../../lib/api.ts';
import { useAction } from '../../../lib/query.ts';
import { useAuth, useDirectory, usersWithRole } from '../../../lib/auth.tsx';
import { AvailabilityNote } from '../Availability.tsx';
import { Card, EmptyState, QueryView } from '../../../ui/layout.tsx';
import { Button } from '../../../ui/Button.tsx';
import { Badge, StatusPill } from '../../../ui/Badge.tsx';
import { Dialog } from '../../../ui/Dialog.tsx';
import { Checkbox, Field, FormError, Input, MoneyInput, NumberInput, Select, Textarea } from '../../../ui/form.tsx';
import { DIRECT_PIPELINE, SALES_STATUS } from '@shared/domain.ts';
import { useSettings } from '../../../lib/settings.ts';
import { addDays, formatDay, formatTs, today } from '@shared/dates.ts';
import { formatMoney } from '@shared/money.ts';
import type { EventDetail, MeetingRecord, QuoteRecord } from '@shared/types.ts';

export function SalesTab({ d }: { d: EventDetail }) {
  const settings = useSettings();
  const ev = d.event;
  const canEdit = d.access.sales >= 2;
  const canSign = d.access.sales >= 3;
  const quotes = useQuery({ queryKey: ['event', ev.id, 'quotes'], queryFn: () => api.get<QuoteRecord[]>(`/sales/events/${ev.id}/quotes`) });
  const clientQ = useQuery({ queryKey: ['client', ev.clientId], enabled: !!ev.clientId && d.access.clients >= 1, queryFn: () => api.get<{ meetings: MeetingRecord[] }>(`/clients/${ev.clientId}`) });
  const tours = (clientQ.data?.meetings ?? []).filter((m) => m.eventId === ev.id && m.kind === 'tour');
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [lostReason, setLostReason] = useState(ev.lostReason);

  const setStatus = useAction((salesStatus: string) => api.patch(`/events/${ev.id}`, { changes: { salesStatus, ...(salesStatus === 'lost' ? { lostReason } : {}) }, base: { salesStatus: ev.salesStatus } }),
    { success: 'מצב המכירה עודכן', invalidate: [['event', ev.id], ['pipeline'], ['tasks']] });
  const setSource = useAction((changes: Record<string, string>) => api.patch(`/events/${ev.id}`, { changes }), { success: 'נשמר', invalidate: [['event', ev.id]] });
  const stepIndex = DIRECT_PIPELINE.indexOf(ev.salesStatus);

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
      <div className="space-y-5">
        <Card title="שלב המכירה">
          <ol className="mb-4 grid grid-cols-4 gap-1" aria-label="שלבי המכירה">
            {DIRECT_PIPELINE.map((s, i) => (
              <li key={s} className={`rounded-lg px-2 py-2 text-center text-xs font-bold ${ev.salesStatus === 'lost' ? 'bg-[var(--color-surface-2)] text-[var(--color-muted)]' : i <= stepIndex ? 'bg-[var(--color-brand)] text-[var(--color-on-brand)]' : 'bg-[var(--color-surface-2)] text-[var(--color-muted)]'}`} aria-current={i === stepIndex ? 'step' : undefined}>
                {SALES_STATUS[s]}
              </li>
            ))}
          </ol>
          {ev.salesStatus === 'signed' ? (
            <p className="text-sm">החוזה נחתם ב-{formatDay(ev.contractSignedAt)}{ev.contractTotal !== null ? ` · ${formatMoney(ev.contractTotal)}` : ''}. האירוע סגור מסחרית – המשך טיפול בטעימות ובמקדמה.</p>
          ) : canEdit && (
            <div className="flex flex-wrap items-end gap-2">
              {(['lead', 'quoted', 'tour'] as const).filter((s) => s !== ev.salesStatus).map((s) => (
                <Button key={s} size="sm" onClick={() => setStatus.mutate(s)} loading={setStatus.isPending && setStatus.variables === s}>העברה ל{SALES_STATUS[s]}</Button>
              ))}
              {canSign && ev.salesStatus !== 'lost' && <Button size="sm" variant="primary" icon={<FileSignature className="size-4" />} onClick={() => setSignOpen(true)}>חוזה נחתם</Button>}
              {ev.salesStatus !== 'lost' && (
                <div className="ms-auto flex items-end gap-2">
                  <Field label="סיבת אי-סגירה" className="w-52">{(p) => <Input {...p} value={lostReason} onChange={(e) => setLostReason(e.target.value)} />}</Field>
                  <Button size="sm" variant="ghost" disabled={!lostReason.trim()} onClick={() => setStatus.mutate('lost')}>סימון כלא נסגר</Button>
                </div>
              )}
              {ev.salesStatus === 'lost' && <p className="text-sm text-[var(--color-muted)]">סיבה: {ev.lostReason || '—'}</p>}
            </div>
          )}
        </Card>

        <Card title="הצעות מחיר" actions={canEdit && ev.salesStatus !== 'signed' && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setQuoteOpen(true)}>גרסה חדשה</Button>} bodyClass="p-0">
          <QueryView q={quotes} empty={(l) => (l.length ? null : <EmptyState title="טרם נשלחה הצעה" text="הצעה וסיור יכולים להתקיים לפני החתימה." />)}>
            {(list) => (
              <table className="table">
                <thead><tr><th>גרסה</th><th>תאריך</th><th className="text-end">אורחים</th><th className="text-end">לאורח</th><th className="text-end">סה״כ</th><th>פירוט</th><th>מצב</th></tr></thead>
                <tbody>
                  {list.map((q) => (
                    <tr key={q.id} className={q.status === 'superseded' ? 'text-[var(--color-muted)]' : ''}>
                      <td className="font-bold">v{q.version}{q.status !== 'superseded' && <Link to={`/print/quote/${ev.id}/${q.id}`} className="mt-1 flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-[var(--color-brand)] hover:underline"><Printer className="size-3.5" aria-hidden />הדפסה ושליחה</Link>}</td>
                      <td className="whitespace-nowrap">{formatTs(q.createdAt)}<div className="text-xs text-[var(--color-muted)]">{q.createdByName}</div></td>
                      <td className="num text-end">{q.guests}</td>
                      <td className="num text-end">{formatMoney(q.perGuest)}</td>
                      <td className="num text-end font-semibold">{formatMoney(q.total)}</td>
                      <td className="max-w-xs text-sm">{q.description}</td>
                      <td>{q.status === 'superseded' ? <Badge>הוחלפה</Badge> : <Badge tone="info">בתוקף</Badge>}</td>

                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </QueryView>
        </Card>
      </div>

      <aside className="space-y-5">
        <Card title="סיור" actions={canEdit && <Button size="sm" icon={<MapPin className="size-4" />} onClick={() => setTourOpen(true)}>תיאום סיור</Button>}>
          {tours.length ? (
            <ul className="space-y-3">
              {tours.map((t) => <TourItem key={t.id} t={t} eventId={ev.id} canEdit={canEdit} />)}
            </ul>
          ) : <p className="text-sm text-[var(--color-muted)]">לא תואם סיור. סיור מתקיים לפי הצורך עם המנהל המבצע.</p>}
        </Card>
        <Card title="שיווק">
          <div className="space-y-3">
            <Field label="מקור הפנייה">{(p) => <Select {...p} disabled={!canEdit} value={ev.source} onChange={(e) => setSource.mutate({ source: e.target.value })} placeholder="לא ידוע" options={settings.lists.leadSources.map((x) => ({ value: x, label: x }))} />}</Field>
            <Field label="קמפיין">{(p) => <Input {...p} disabled={!canEdit} defaultValue={ev.campaign} onBlur={(e) => e.target.value !== ev.campaign && setSource.mutate({ campaign: e.target.value })} />}</Field>
          </div>
        </Card>
      </aside>

      {quoteOpen && <QuoteDialog d={d} onClose={() => setQuoteOpen(false)} />}
      {signOpen && <SignDialog d={d} lastQuote={quotes.data?.find((q) => q.status === 'sent') ?? null} onClose={() => setSignOpen(false)} />}
      {tourOpen && <MeetingDialog kind="tour" eventId={ev.id} venue={ev.venue} maxDate={ev.date} onClose={() => setTourOpen(false)} />}
    </div>
  );
}

function TourItem({ t, eventId, canEdit }: { t: MeetingRecord; eventId: number; canEdit: boolean }) {
  const [notes, setNotes] = useState(t.notes);
  const upd = useAction((body: Record<string, unknown>) => api.patch(`/meetings/${t.id}`, body), { success: 'נשמר', invalidate: [['client'], ['event', eventId], ['calendar']] });
  return (
    <li className="rounded-[10px] border border-[var(--color-border)] p-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold">{formatDay(t.date)} {t.time}</span>
        <Badge tone={t.status === 'done' ? 'ok' : t.status === 'cancelled' ? 'neutral' : 'info'}>{t.status === 'done' ? 'התקיים' : t.status === 'cancelled' ? 'בוטל' : 'מתוכנן'}</Badge>
      </div>
      <div className="text-xs text-[var(--color-muted)]">מנהל: {t.managerName ?? '—'}</div>
      {canEdit && (
        <div className="mt-2 space-y-2">
          <Field label="התרשמות מהסיור">{(p) => <Textarea {...p} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => upd.mutate({ notes, status: 'done' })} loading={upd.isPending}>שמירה וסימון שהתקיים</Button>
            {t.status === 'scheduled' && <Button size="sm" variant="ghost" onClick={() => upd.mutate({ status: 'cancelled' })}>ביטול</Button>}
          </div>
        </div>
      )}
    </li>
  );
}

function QuoteDialog({ d, onClose }: { d: EventDetail; onClose: () => void }) {
  const ev = d.event;
  const [guests, setGuests] = useState<number | null>(ev.guests);
  const fd = useSettings().formDefaults;
  const [perGuest, setPerGuest] = useState<number | null>(fd.quotePerGuest[ev.eventType] || null);
  const [total, setTotal] = useState<number | null>(null);
  const [description, setDescription] = useState('');
  const computed = perGuest !== null && guests ? perGuest * guests : null;
  const save = useAction(() => api.post(`/sales/events/${ev.id}/quotes`, { guests: guests ?? 0, perGuest, total: total ?? computed ?? 0, description }),
    { success: 'ההצעה נשמרה כגרסה חדשה', invalidate: [['event', ev.id]], onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} title="הצעת מחיר – גרסה חדשה" footer={<><Button onClick={onClose}>ביטול</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>שמירה</Button></>}>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormError message={save.error?.message} />
        <Field label="אורחים">{(p) => <NumberInput {...p} value={guests} onChange={setGuests} />}</Field>
        <Field label="מחיר לאורח">{(p) => <MoneyInput {...p} value={perGuest} onChange={setPerGuest} />}</Field>
        <Field label="סה״כ" hint={computed !== null ? `לפי חישוב: ${formatMoney(computed)}` : undefined} error={save.error?.fields.total}>{(p) => <MoneyInput {...p} value={total ?? computed} onChange={setTotal} />}</Field>
        <Field label="פירוט / תוספות / הנחה" className="sm:col-span-3" error={save.error?.fields.description}>{(p) => <Textarea {...p} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}

function SignDialog({ d, lastQuote, onClose }: { d: EventDetail; lastQuote: QuoteRecord | null; onClose: () => void }) {
  const ev = d.event;
  const [total, setTotal] = useState<number | null>(lastQuote?.total ?? null);
  const settings = useSettings();
  const [deposit, setDeposit] = useState<number | null>(lastQuote ? Math.round((lastQuote.total * settings.depositPct) / 100) : null);
  const [signedAt, setSignedAt] = useState(today());
  const [depositDue, setDepositDue] = useState(addDays(today(), settings.depositDueDays));
  const [finalDue, setFinalDue] = useState(addDays(ev.date, settings.finalDueDays));
  const auth = useAuth();
  const [overbook, setOverbook] = useState(false);
  const sign = useAction(() => api.post(`/events/${ev.id}/sign`, { signedAt, contractTotal: total ?? 0, deposit: deposit ?? 0, depositDue, finalDue, version: ev.version, allowOverbook: overbook }),
    { success: 'החוזה נרשם. נפתחו משימות טעימות ומעקב מקדמה', invalidate: [['event', ev.id], ['tasks'], ['pipeline'], ['dashboard']], onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} title="רישום חוזה חתום" footer={<><Button onClick={onClose}>ביטול</Button><Button variant="primary" loading={sign.isPending} onClick={() => sign.mutate(undefined)}>רישום החתימה</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><FormError message={sign.error?.message} /><AvailabilityNote venue={ev.venue} date={ev.date} excludeId={ev.id} /></div>
        {sign.error?.fields.allowOverbook && auth.supervisor && <div className="sm:col-span-2"><Checkbox label="לקבוע בכל זאת – יהיו ביום הזה יותר אירועים מהמקסימום שהוגדר" checked={overbook} onChange={setOverbook} /></div>}
        <Field label="מועד חתימה" required>{(p) => <Input {...p} type="date" value={signedAt} onChange={(e) => setSignedAt(e.target.value)} />}</Field>
        <Field label="סכום חוזה" required error={sign.error?.fields.contractTotal}>{(p) => <MoneyInput {...p} value={total} onChange={setTotal} />}</Field>
        <Field label="מקדמה" error={sign.error?.fields.deposit}>{(p) => <MoneyInput {...p} value={deposit} onChange={setDeposit} />}</Field>
        <Field label="מועד מקדמה">{(p) => <Input {...p} type="date" value={depositDue} onChange={(e) => setDepositDue(e.target.value)} />}</Field>
        <Field label="מועד תשלום סופי">{(p) => <Input {...p} type="date" value={finalDue} onChange={(e) => setFinalDue(e.target.value)} />}</Field>
      </div>
      <p className="mt-3 text-sm text-[var(--color-muted)]">החתימה מגדירה את האירוע כסגור מסחרית. ייפתחו משימה לנציגה לתיאום טעימות ומשימה להנהלת החשבונות למעקב המקדמה. יש לצרף את החוזה החתום בלשונית המסמכים.</p>
    </Dialog>
  );
}

export function MeetingDialog({ kind, eventId, venue, maxDate, onClose }: { kind: 'tour' | 'tasting'; eventId: number; venue: EventDetail['event']['venue']; maxDate: string; onClose: () => void }) {
  const dir = useDirectory();
  const fd = useSettings().formDefaults;
  const [date, setDate] = useState(addDays(today(), fd.meetingLeadDays));
  const [time, setTime] = useState(kind === 'tasting' ? fd.tastingTime : fd.tourTime);
  const [managerId, setManagerId] = useState('');
  const [notes, setNotes] = useState('');
  const save = useAction(() => api.post('/meetings', { kind, eventId, date, time, managerId: managerId ? Number(managerId) : null, notes }),
    { success: kind === 'tour' ? 'הסיור תואם' : 'הטעימות תואמו', invalidate: [['client'], ['event', eventId], ['calendar'], ['tasks']], onSuccess: onClose });
  const managers = kind === 'tasting' ? usersWithRole(dir.data, 'kitchen', venue) : [...usersWithRole(dir.data, 'event_manager', venue), ...usersWithRole(dir.data, 'brand', venue)];
  return (
    <Dialog open onClose={onClose} title={kind === 'tour' ? 'תיאום סיור' : 'תיאום טעימות'} size="sm" footer={<><Button onClick={onClose}>ביטול</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>שמירה ביומן</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><FormError message={save.error?.message} /></div>
        <Field label="תאריך" error={save.error?.fields.date}>{(p) => <Input {...p} type="date" max={maxDate} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        <Field label="שעה">{(p) => <Input {...p} type="time" value={time} onChange={(e) => setTime(e.target.value)} />}</Field>
        <Field label={kind === 'tasting' ? 'מנהל הטעימות' : 'המנהל המבצע את הסיור'} className="sm:col-span-2">{(p) => <Select {...p} value={managerId} onChange={(e) => setManagerId(e.target.value)} placeholder="בחירה…" options={[...new Map(managers.map((u) => [u.id, u])).values()].map((u) => ({ value: u.id, label: u.name }))} />}</Field>
        <Field label="הערות" className="sm:col-span-2">{(p) => <Textarea {...p} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}

