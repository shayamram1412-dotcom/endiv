/**
 * Clean A4 documents: client quote, supplier purchase order, event sheet.
 * "Print" also saves as PDF from the browser dialog; WhatsApp opens a ready message to the recipient.
 */
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Printer, ArrowRight, MessageCircle } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { useSettings } from '../../lib/settings.ts';
import { ErrorState, Loading } from '../../ui/layout.tsx';
import { Button } from '../../ui/Button.tsx';
import { AUDIENCE, DIETARY_KIND, EVENT_TYPES, KOSHER, STAFF_ROLES, VENUE_LABEL, type StaffRole, type DietaryKind } from '@shared/domain.ts';
import { ROLES, type Role } from '@shared/permissions.ts';
import { formatMoney } from '@shared/money.ts';
import { formatDay, formatLongDay } from '@shared/dates.ts';
import { poMessage, quoteMessage, whatsappUrl } from '@shared/share.ts';
import type { EventDetail, MenuView, PurchaseOrderRecord, QuoteRecord, SupplierRecord, EventRecord } from '@shared/types.ts';

function Sheet({ back, share, children }: { back: string; share?: { phone: string | null | undefined; text: string; label: string }; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-[var(--color-surface-2)] print:bg-white">
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2">
        <Link to={back} className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-muted)]"><ArrowRight className="size-4" />חזרה</Link>
        <span className="ms-auto" />
        {share && (
          <a href={whatsappUrl(share.phone, share.text)} target="_blank" rel="noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 text-sm font-semibold">
            <MessageCircle className="size-4" />{share.label}
          </a>
        )}
        <Button variant="primary" icon={<Printer className="size-4" />} onClick={() => window.print()}>הדפסה / PDF</Button>
      </div>
      <article className="print-sheet mx-auto my-6 max-w-[210mm] bg-white p-10 text-[13px] leading-relaxed text-black shadow-sm print:my-0 print:p-0 print:shadow-none">{children}</article>
    </div>
  );
}

function Letterhead({ title, sub }: { title: string; sub?: string }) {
  const b = useSettings().business;
  return (
    <header className="mb-6 flex items-start justify-between border-b-2 border-black pb-3">
      <div>
        <div className="text-2xl font-extrabold">{b.name}</div>
        <div className="text-xs">{[b.legalName, b.taxId && `ח.פ./ע.מ. ${b.taxId}`, b.address, b.phone, b.email].filter(Boolean).join(' · ')}</div>
      </div>
      <div className="text-end">
        <div className="text-lg font-bold">{title}</div>
        {sub && <div className="text-xs">{sub}</div>}
      </div>
    </header>
  );
}

const H = ({ children }: { children: ReactNode }) => <h2 className="mb-1.5 mt-5 border-b border-neutral-300 pb-0.5 text-sm font-bold">{children}</h2>;

function useDoc<T>(key: unknown[], path: string, enabled = true) {
  return useQuery({ queryKey: key, queryFn: () => api.get<T>(path), enabled });
}

// ---------------------------------------------------------------- client quote

export function QuotePrintPage() {
  const { eventId, quoteId } = useParams();
  const settings = useSettings();
  const ev = useDoc<EventDetail>(['event', Number(eventId)], `/events/${eventId}`);
  const quotes = useDoc<QuoteRecord[]>(['event', Number(eventId), 'quotes'], `/sales/events/${eventId}/quotes`);
  const menu = useDoc<MenuView>(['event', Number(eventId), 'menu'], `/events/${eventId}/menu`, (ev.data?.access.menu ?? 0) >= 1);
  if (ev.isLoading || quotes.isLoading) return <Loading rows={8} />;
  if (ev.error || quotes.error || !ev.data) return <ErrorState error={ev.error ?? quotes.error} />;
  const e = ev.data.event;
  const q = quotes.data?.find((x) => x.id === Number(quoteId));
  if (!q) return <ErrorState error={new Error('ההצעה לא נמצאה')} />;
  const byCat = new Map<string, string[]>();
  for (const l of menu.data?.lines ?? []) byCat.set(l.category, [...(byCat.get(l.category) ?? []), `${l.dishName}${l.audience !== 'all' ? ` (${AUDIENCE[l.audience]})` : ''}`]);
  const text = quoteMessage({ business: settings.business.name, clientName: ev.data.client?.name ?? '', title: e.title, date: formatDay(e.date), guests: q.guests, perGuest: q.perGuest, total: q.total, version: q.version });
  return (
    <Sheet back={`/events/${e.id}/sales`} share={{ phone: ev.data.client?.phone, text, label: 'שליחה ללקוח בוואטסאפ' }}>
      <Letterhead title="הצעת מחיר" sub={`גרסה ${q.version} · ${formatDay(q.createdAt.slice(0, 10))}`} />
      <p className="mb-1"><strong>לכבוד:</strong> {ev.data.client?.name}{ev.data.client?.company ? ` · ${ev.data.client.company}` : ''}</p>
      <p><strong>האירוע:</strong> {e.title} · {EVENT_TYPES[e.eventType as keyof typeof EVENT_TYPES] ?? e.eventType}</p>
      <p><strong>מועד ומקום:</strong> {formatLongDay(e.date)}{e.startTime ? ` · ${e.startTime}` : ''} · {VENUE_LABEL[e.venue]}{e.address ? ` · ${e.address}` : ''}</p>
      <p><strong>כשרות:</strong> {KOSHER[e.kosher as keyof typeof KOSHER] ?? e.kosher}</p>
      {byCat.size > 0 && (
        <>
          <H>התפריט</H>
          {[...byCat].map(([cat, dishes]) => <p key={cat}><strong>{cat}:</strong> {dishes.join(' · ')}</p>)}
        </>
      )}
      {q.description && (<><H>פירוט</H><p className="whitespace-pre-line">{q.description}</p></>)}
      <H>המחיר</H>
      <table className="w-full border-collapse text-[13px]">
        <tbody>
          <tr className="border-b border-neutral-200"><td className="py-1">מספר אורחים</td><td className="num py-1 text-end">{q.guests}</td></tr>
          {q.perGuest !== null && <tr className="border-b border-neutral-200"><td className="py-1">מחיר לאורח</td><td className="num py-1 text-end">{formatMoney(q.perGuest)}</td></tr>}
          <tr className="text-base font-bold"><td className="py-1.5">סה״כ</td><td className="num py-1.5 text-end">{formatMoney(q.total)}</td></tr>
        </tbody>
      </table>
      {settings.business.quoteTerms && (<><H>תנאים</H><p className="whitespace-pre-line text-xs">{settings.business.quoteTerms}</p></>)}
      <div className="mt-12 grid grid-cols-2 gap-10 text-xs">
        <div className="border-t border-black pt-1">חתימת הלקוח ותאריך</div>
        <div className="border-t border-black pt-1">בשם {settings.business.name}</div>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- supplier purchase order

export function OrderPrintPage() {
  const id = Number(useParams().id);
  const settings = useSettings();
  const o = useDoc<PurchaseOrderRecord>(['purchasing', 'order', id], `/purchasing/orders/${id}`);
  const suppliers = useDoc<SupplierRecord[]>(['purchasing', 'suppliers'], '/purchasing/suppliers');
  if (o.isLoading) return <Loading rows={8} />;
  if (o.error || !o.data) return <ErrorState error={o.error} />;
  const po = o.data;
  const sup = suppliers.data?.find((s) => s.id === po.supplierId);
  const total = po.lines.reduce((a, l) => a + Math.round((l.unitPrice ?? 0) * l.qty), 0);
  const priced = po.lines.some((l) => l.unitPrice);
  const text = poMessage({ business: settings.business.name, id: po.id, date: formatDay(po.expectedDate), time: po.expectedTime, warehouse: po.warehouseName ?? '', lines: po.lines.map((l) => ({ name: l.itemName, qty: l.qty, unit: l.unit })), note: settings.business.poNote });
  return (
    <Sheet back={`/purchasing/${po.id}`} share={{ phone: sup?.phone, text, label: 'שליחה לספק בוואטסאפ' }}>
      <Letterhead title={`הזמנת רכש #${po.id}`} sub={formatDay(po.createdAt.slice(0, 10))} />
      <p><strong>לכבוד:</strong> {po.supplierName}{sup?.contact ? ` · ${sup.contact}` : ''}{sup?.phone ? ` · ${sup.phone}` : ''}</p>
      <p><strong>אספקה:</strong> {formatLongDay(po.expectedDate)}{po.expectedTime ? ` בשעה ${po.expectedTime}` : ''} · {po.warehouseName}</p>
      {po.responsibleName && <p><strong>איש קשר אצלנו:</strong> {po.responsibleName}</p>}
      <H>פריטים</H>
      <table className="w-full border-collapse">
        <thead><tr className="border-b border-black text-start"><th className="py-1 text-start">פריט</th><th className="py-1 text-end">כמות</th>{priced && <><th className="py-1 text-end">מחיר ליח׳</th><th className="py-1 text-end">סה״כ</th></>}</tr></thead>
        <tbody>
          {po.lines.map((l) => (
            <tr key={l.id} className="border-b border-neutral-200">
              <td className="py-1">{l.itemName}</td><td className="num py-1 text-end">{l.qty} {l.unit}</td>
              {priced && <><td className="num py-1 text-end">{formatMoney(l.unitPrice)}</td><td className="num py-1 text-end">{formatMoney(Math.round((l.unitPrice ?? 0) * l.qty))}</td></>}
            </tr>
          ))}
          {priced && <tr className="font-bold"><td className="py-1.5" colSpan={3}>סה״כ (לפני אישור הספק)</td><td className="num py-1.5 text-end">{formatMoney(total)}</td></tr>}
        </tbody>
      </table>
      {po.notes && (<><H>הערות</H><p>{po.notes}</p></>)}
      {settings.business.poNote && <p className="mt-6 text-xs">{settings.business.poNote}</p>}
    </Sheet>
  );
}

// ---------------------------------------------------------------- event sheet

interface SheetData {
  event: EventRecord; venueName: string;
  client: { name: string; phone: string } | null;
  eventManager: { name: string; phone: string } | null; kitchenManager: { name: string; phone: string } | null;
  menu: { dishName: string; category: string; portions: number; notes: string; allergens: string; audience: keyof typeof AUDIENCE }[];
  dietary: { kind: DietaryKind; count: number; description: string }[];
  staffing: { role: StaffRole; required: number; assigned: number }[];
  show: { time: string; title: string; role: string; notes: string }[];
  equipment: { label: string; unit: string; planned: number; notes: string }[];
  transport: { vehicleName: string; plate: string; driver: string; departTime: string; returnTime: string; notes: string }[];
}

export function EventSheetPrintPage() {
  const id = Number(useParams().id);
  const q = useDoc<SheetData>(['event', id, 'sheet'], `/events/${id}/sheet`);
  if (q.isLoading) return <Loading rows={8} />;
  if (q.error || !q.data) return <ErrorState error={q.error} />;
  const d = q.data;
  const e = d.event;
  return (
    <Sheet back={`/events/${id}`}>
      <Letterhead title="דף אירוע" sub={`${formatLongDay(e.date)} · ${d.venueName}`} />
      <div className="grid grid-cols-2 gap-x-8 gap-y-0.5">
        <p><strong>אירוע:</strong> {e.title}</p>
        <p><strong>שעות:</strong> {[e.deliveryTime && `הגעה ${e.deliveryTime}`, e.startTime && `התחלה ${e.startTime}`, e.endTime && `סיום ${e.endTime}`].filter(Boolean).join(' · ') || '—'}</p>
        <p><strong>אורחים:</strong> {e.guests}{e.kids ? ` · ${e.kids} ילדים` : ''}{e.vegetarian ? ` · ${e.vegetarian} צמחונים` : ''}{e.vegan ? ` · ${e.vegan} טבעונים` : ''}</p>
        <p><strong>כשרות:</strong> {KOSHER[e.kosher as keyof typeof KOSHER] ?? e.kosher}</p>
        {d.client && <p><strong>לקוח:</strong> {d.client.name}{d.client.phone ? ` · ${d.client.phone}` : ''}</p>}
        {e.address && <p><strong>כתובת:</strong> {e.address}</p>}
        {(e.siteContactName || e.siteContactPhone) && <p><strong>איש קשר בשטח:</strong> {e.siteContactName} {e.siteContactPhone}</p>}
        {d.eventManager && <p><strong>מנהל אירוע:</strong> {d.eventManager.name} {d.eventManager.phone}</p>}
        {d.kitchenManager && <p><strong>מנהל מטבח:</strong> {d.kitchenManager.name} {d.kitchenManager.phone}</p>}
      </div>
      {(d.dietary.filter((x) => x.kind !== 'kids').length > 0 || e.specialRequests) && (
        <div className="mt-4 border-2 border-black p-2">
          <strong>אלרגיות והנחיות:</strong>{' '}
          {d.dietary.filter((x) => x.kind !== 'kids').map((x) => `${DIETARY_KIND[x.kind]}${x.count ? ` (${x.count})` : ''}${x.description ? ` – ${x.description}` : ''}`).join(' · ')}
          {e.specialRequests && <div>{e.specialRequests}</div>}
        </div>
      )}
      {d.show.length > 0 && (
        <>
          <H>לו״ז האירוע</H>
          <table className="w-full border-collapse">
            <tbody>{d.show.map((r, i) => (
              <tr key={i} className="border-b border-neutral-200"><td className="num w-16 py-0.5 pe-3 font-bold">{r.time}</td><td className="py-0.5">{r.title}{r.notes ? ` – ${r.notes}` : ''}</td><td className="py-0.5 text-end text-xs">{r.role ? ROLES[r.role as Role] : ''}</td></tr>
            ))}</tbody>
          </table>
        </>
      )}
      {d.menu.length > 0 && (
        <>
          <H>תפריט ומנות</H>
          <table className="w-full border-collapse">
            <tbody>{d.menu.map((m, i) => (
              <tr key={i} className="border-b border-neutral-200"><td className="py-0.5">{m.dishName}{m.audience !== 'all' ? ` (${AUDIENCE[m.audience]})` : ''}{m.notes ? ` – ${m.notes}` : ''}{m.allergens ? <span className="text-xs"> · אלרגנים: {m.allergens}</span> : null}</td><td className="num w-20 py-0.5 text-end font-bold">{m.portions}</td></tr>
            ))}</tbody>
          </table>
        </>
      )}
      <div className="grid grid-cols-2 gap-8">
        {d.staffing.length > 0 && (
          <div>
            <H>צוות</H>
            {d.staffing.map((s) => <p key={s.role}>{STAFF_ROLES[s.role]}: {s.required}{s.assigned < s.required ? ` (שובצו ${s.assigned})` : ''}</p>)}
          </div>
        )}
        {d.transport.length > 0 && (
          <div>
            <H>הובלה</H>
            {d.transport.map((t, i) => <p key={i}>{t.vehicleName}{t.plate ? ` (${t.plate})` : ''}{t.driver ? ` · ${t.driver}` : ''} · {t.departTime || '—'}–{t.returnTime || '—'}</p>)}
          </div>
        )}
      </div>
      {d.equipment.length > 0 && (
        <>
          <H>ציוד</H>
          <div className="columns-2 gap-8">{d.equipment.map((x, i) => <p key={i}>☐ {x.label}: {x.planned} {x.unit}{x.notes ? ` – ${x.notes}` : ''}</p>)}</div>
        </>
      )}
    </Sheet>
  );
}
