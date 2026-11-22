/**
 * Phone-first screens for the event manager on site. First screen: time, guests, approved menu,
 * allergies, contact, shortages and urgent tasks. Report / acknowledge / confirm in one tap.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Phone, Clock, Users2, MapPin, AlertTriangle, Megaphone, CheckCircle2, ArrowRight, ChefHat } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { useAction } from '../../lib/query.ts';
import { useAuth } from '../../lib/auth.tsx';
import { Card, EmptyState, ErrorState, Loading, PageHeader } from '../../ui/layout.tsx';
import { Button } from '../../ui/Button.tsx';
import { Badge, Progress, VenueTag } from '../../ui/Badge.tsx';
import { ReportsPanel, NewReportDialog, ConfirmDialog, CONF_ROLE } from '../events/tabs/FieldTab.tsx';
import { EventCard, useEventList } from '../events/shared.tsx';
import { AUDIENCE, CONFIRMATIONS, DIETARY_KIND, STAFF_ROLES, VENUE_RULES, type VenueCode, type DietaryKind, type ConfirmationKind } from '@shared/domain.ts';
import { addDays, formatLongDay, today, formatTs } from '@shared/dates.ts';
import type { ConfirmationRecord, FieldReport, StaffingLine } from '@shared/types.ts';
import type { Readiness } from '@shared/readiness.ts';
import { RunOfShow } from './RunOfShow.tsx';

export function FieldHomePage() {
  const q = useEventList({ from: today(), to: addDays(today(), 3), mine: '1' });
  const all = useEventList({ from: today(), to: addDays(today(), 1) });
  const list = (q.data?.length ? q.data : all.data) ?? [];
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="ביצוע בשטח" subtitle={q.data?.length ? 'האירועים שבאחריותך בימים הקרובים' : 'האירועים של היום ומחר'} />
      {q.isLoading ? <Loading /> : !list.length ? <EmptyState title="אין אירועים קרובים" /> : (
        <div className="space-y-3">{list.filter((e) => e.serviceKind === 'full').map((e) => <EventCard key={e.id} e={e} to={`/field/${e.id}`} />)}</div>
      )}
    </div>
  );
}

interface FieldBundle {
  event: { id: number; title: string; venue: VenueCode; date: string; startTime: string; endTime: string; deliveryTime: string; guests: number; kids: number; vegetarian: number; vegan: number; address: string; siteContactName: string; siteContactPhone: string; specialRequests: string; kosher: string; menuStatus: string; menuVersion: number; serviceKind: string; lifecycle: string };
  client: { name: string; phone: string } | null;
  contacts: { name: string; phone: string; role: string }[];
  menuApproved: boolean;
  menu: { dishName: string; category: string; portions: number; notes: string; allergens: string; audience: keyof typeof AUDIENCE }[];
  dietary: { kind: DietaryKind; count: number; description: string }[];
  staffing: StaffingLine[];
  reports: FieldReport[];
  tasks: { id: number; title: string; action: string; dueAt: string | null; assigneeName: string | null }[];
  readiness: Readiness;
  confirmations: ConfirmationRecord[];
}

/** Phone route: /field/:id. */
export function FieldEventPage() {
  return <FieldView id={Number(useParams().id)} />;
}

/**
 * The one execution screen. Used on its own on the phone and embedded as the event's "ביצוע" tab,
 * so the field team and the office look at the same thing.
 */
export function FieldView({ id, embedded }: { id: number; embedded?: boolean }) {
  const auth = useAuth();
  const q = useQuery({ queryKey: ['field', id], queryFn: () => api.get<FieldBundle>(`/events/${id}/field`), refetchInterval: 30_000 });
  const [report, setReport] = useState(false);
  const [confirmKind, setConfirmKind] = useState<ConfirmationKind | null>(null);
  const inv = [['field', id], ['event', id], ['tasks'], ['dashboard']];
  const unconfirm = useAction((k: ConfirmationKind) => api.del(`/events/${id}/confirm/${k}`), { success: 'האישור בוטל', invalidate: inv });
  const ack = useAction(() => api.post(`/events/${id}/menu/ack`, { role: 'event_manager' }), { success: 'אישרת קבלת שינוי בתפריט', invalidate: inv });
  if (q.isLoading) return <Loading rows={6} />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const ev = d.event;
  const allergies = d.dietary.filter((x) => x.kind !== 'kids');
  const openReports = d.reports.filter((r) => !r.resolvedAt);
  const staffGaps = d.staffing.filter((s) => s.required > 0 && (s.assigned < s.required || (s.arrived !== null && s.arrived < s.assigned)));
  const has = (k: ConfirmationKind) => d.confirmations.some((c) => c.kind === k);
  const isEM = auth.hasRole('event_manager', ev.venue) || auth.supervisor;
  const mayConfirm = (k: ConfirmationKind) => auth.hasRole(CONF_ROLE[k], ev.venue) || auth.supervisor;
  const kinds: ConfirmationKind[] = ['kitchen_ready', ...(ev.serviceKind === 'full' ? ['field_ready' as const] : []), 'executed'];

  return (
    <div className={embedded ? 'mx-auto max-w-3xl' : 'mx-auto max-w-xl pb-24'}>
      {!embedded && <Link to={`/events/${id}`} className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-muted)]"><ArrowRight className="size-4" />לכרטיס המלא</Link>}
      {!embedded && <header className="card mb-4 p-4">
        <VenueTag venue={ev.venue} />
        <h1 className="mt-1 text-2xl font-extrabold">{ev.title}</h1>
        <p className="text-sm text-[var(--color-ink-2)]">{formatLongDay(ev.date)}</p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-[12px] bg-[var(--color-surface-2)] p-3"><Clock className="mb-1 size-5 text-[var(--color-muted)]" aria-hidden /><div className="num text-2xl font-extrabold">{ev.startTime || ev.deliveryTime || '—'}</div><div className="text-xs text-[var(--color-muted)]">{ev.endTime ? `עד ${ev.endTime}` : 'שעה'}</div></div>
          <div className="rounded-[12px] bg-[var(--color-surface-2)] p-3"><Users2 className="mb-1 size-5 text-[var(--color-muted)]" aria-hidden /><div className="num text-2xl font-extrabold">{ev.guests}</div><div className="text-xs text-[var(--color-muted)]">אורחים{ev.kids ? ` · ${ev.kids} ילדים` : ''}{ev.vegetarian ? ` · ${ev.vegetarian} צמח׳` : ''}{ev.vegan ? ` · ${ev.vegan} טבע׳` : ''}</div></div>
        </div>
        <div className="mt-3"><Progress pct={d.readiness.pct} label={d.readiness.label} /></div>
      </header>}

      {(allergies.length > 0 || ev.specialRequests) && (
        <section className="mb-4 rounded-[14px] border-2 border-[var(--color-danger)] bg-[var(--color-danger-soft)] p-4" aria-label="אלרגיות והנחיות">
          <h2 className="mb-1 flex items-center gap-2 font-extrabold text-[var(--color-danger)]"><AlertTriangle className="size-5" />אלרגיות והנחיות</h2>
          <ul className="space-y-1 text-[15px]">
            {allergies.map((a, i) => <li key={i}><strong>{DIETARY_KIND[a.kind]}{a.count ? ` (${a.count})` : ''}</strong>{a.description ? ` – ${a.description}` : ''}</li>)}
            {ev.specialRequests && <li>{ev.specialRequests}</li>}
          </ul>
        </section>
      )}

      {ev.menuStatus === 'changed' && (
        <section className="mb-4 rounded-[14px] border-2 border-[var(--color-warn)] bg-[var(--color-warn-soft)] p-4">
          <p className="font-bold text-[var(--color-warn)]">התפריט עודכן (גרסה {ev.menuVersion})</p>
          <div className="mt-2 flex gap-2">
            <Link to={`/events/${id}/menu`} className="text-sm font-semibold underline">מה השתנה?</Link>
            {isEM && <Button size="lg" variant="primary" className="ms-auto" loading={ack.isPending} onClick={() => ack.mutate(undefined)}>קיבלתי את השינוי</Button>}
          </div>
        </section>
      )}

      <div className="mb-4 grid grid-cols-2 gap-2">
        <Button size="lg" variant="danger" icon={<Megaphone className="size-5" />} onClick={() => setReport(true)}>דיווח חוסר / שינוי</Button>
        {d.client?.phone ? <a href={`tel:${d.client.phone}`} className="inline-flex h-12 items-center justify-center gap-2 rounded-[10px] border border-[var(--color-border-strong)] bg-[var(--color-surface)] font-semibold"><Phone className="size-5" />{d.client.name}</a> : <span />}
      </div>

      {(ev.address || ev.siteContactPhone || d.contacts.length > 0) && (
        <Card title="אנשי קשר ומקום" className="mb-4">
          {ev.address && <p className="mb-2 flex items-center gap-2"><MapPin className="size-4" /><a className="underline" href={`https://maps.google.com/?q=${encodeURIComponent(ev.address)}`} target="_blank" rel="noreferrer">{ev.address}</a></p>}
          <ul className="space-y-2">
            {ev.siteContactPhone && <li><a href={`tel:${ev.siteContactPhone}`} className="flex items-center justify-between rounded-[10px] bg-[var(--color-surface-2)] p-3 font-semibold"><span>{ev.siteContactName || 'איש קשר בשטח'}</span><span className="num">{ev.siteContactPhone}</span></a></li>}
            {d.contacts.map((c, i) => <li key={i}><a href={`tel:${c.phone}`} className="flex items-center justify-between rounded-[10px] bg-[var(--color-surface-2)] p-3 font-semibold"><span>{c.name}{c.role ? ` · ${c.role}` : ''}</span><span className="num">{c.phone}</span></a></li>)}
          </ul>
        </Card>
      )}

      {(openReports.length > 0 || staffGaps.length > 0 || d.tasks.length > 0) && (
        <Card title="פתוח עכשיו" className="mb-4">
          <ul className="space-y-2 text-[15px]">
            {staffGaps.map((s) => <li key={s.id} className="flex items-center gap-2"><Badge tone="danger">צוות</Badge>{STAFF_ROLES[s.role]}: שובצו {s.assigned}/{s.required}{s.arrived !== null ? `, הגיעו ${s.arrived}` : ''}</li>)}
            {d.tasks.slice(0, 5).map((t) => <li key={t.id} className="flex items-start gap-2"><Badge tone="info">משימה</Badge><span>{t.title}{t.action && t.action !== t.title && <span className="block text-sm text-[var(--color-muted)]">{t.action}</span>}</span></li>)}
          </ul>
        </Card>
      )}

      <RunOfShow eventId={id} isToday={ev.date === today()} />

      <div className="mb-4">
        <ReportsPanel eventId={id} reports={{ data: d.reports, isLoading: false, error: null, refetch: q.refetch }} canReport={false} big={!embedded} />
      </div>

      <Card title={d.menuApproved ? `תפריט מאושר · גרסה ${ev.menuVersion}` : 'תפריט – טרם אושר'} className="mb-4" bodyClass="p-0">
        <ul className="divide-y divide-[var(--color-border)]">
          {d.menu.map((m, i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{m.dishName}{m.audience !== 'all' && <Badge className="ms-1">{AUDIENCE[m.audience]}</Badge>}</div>
                {(m.notes || m.allergens) && <div className="text-sm text-[var(--color-ink-2)]">{[m.notes, m.allergens && `אלרגנים: ${m.allergens}`].filter(Boolean).join(' · ')}</div>}
              </div>
              <span className="num text-lg font-bold">{m.portions}</span>
            </li>
          ))}
        </ul>
      </Card>

      {!embedded && d.staffing.length > 0 && (
        <Card title="צוות (סיכום מ-Ubeya)" className="mb-4" bodyClass="p-0">
          <table className="table">
            <thead><tr><th>תפקיד</th><th className="text-end">נדרש</th><th className="text-end">שובץ</th><th className="text-end">הגיע</th></tr></thead>
            <tbody>{d.staffing.filter((s) => s.required > 0).map((s) => <tr key={s.id}><td className="font-semibold">{STAFF_ROLES[s.role]}</td><td className="num text-end">{s.required}</td><td className="num text-end">{s.assigned}</td><td className="num text-end">{s.arrived ?? '—'}</td></tr>)}</tbody>
          </table>
          <Link to={`/events/${id}/staff`} className="block border-t border-[var(--color-border)] px-4 py-2 text-sm font-semibold text-[var(--color-brand)]">עדכון הגעה</Link>
        </Card>
      )}

      <Card title="אישורים" className="mb-4">
        <ul className="space-y-2">
          {kinds.map((k) => {
            const c = d.confirmations.find((x) => x.kind === k);
            return (
              <li key={k} className="flex items-center gap-2">
                {c ? <CheckCircle2 className="size-6 shrink-0 text-[var(--color-ok)]" aria-label="אושר" /> : k === 'kitchen_ready' ? <ChefHat className="size-6 shrink-0 text-[var(--color-muted)]" aria-hidden /> : <span className="size-5 shrink-0 rounded-full border-2 border-[var(--color-border-strong)]" aria-label="טרם אושר" />}
                <span className="flex-1 font-semibold">{CONFIRMATIONS[k]}{c && <span className="block text-xs font-normal text-[var(--color-muted)]">{c.userName} · {formatTs(c.at)}{c.note ? ` · ${c.note}` : ''}</span>}</span>
                {mayConfirm(k) && (c
                  ? <Button size="sm" variant="ghost" loading={unconfirm.isPending && unconfirm.variables === k} onClick={() => unconfirm.mutate(k)}>ביטול</Button>
                  : <Button size={embedded ? 'md' : 'lg'} variant="primary" onClick={() => setConfirmKind(k)}>אישור</Button>)}
              </li>
            );
          })}
          {VENUE_RULES[ev.venue]?.loadCheck && (['loaded', 'unloaded'] as const).map((k) => {
            const c = d.confirmations.find((x) => x.kind === k);
            return <li key={k} className="text-sm text-[var(--color-muted)]">{CONFIRMATIONS[k]}: {c ? `${c.userName} · ${formatTs(c.at)}` : 'ממתין (בלשונית הציוד)'}</li>;
          })}
        </ul>
        {!has('executed') && <p className="mt-2 text-xs text-[var(--color-muted)]">סיום ביצוע פותח את משימות הסגירה: החזרת כלים, גבייה ושיחת משוב.</p>}
      </Card>
      {confirmKind && <ConfirmDialog eventId={id} kind={confirmKind} readiness={d.readiness} onClose={() => setConfirmKind(null)} />}
      {report && <NewReportDialog eventId={id} onClose={() => setReport(false)} />}
    </div>
  );
}
