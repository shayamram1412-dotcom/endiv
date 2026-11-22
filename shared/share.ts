/**
 * Sharing documents by WhatsApp (click-to-chat link — no integration, the user sends it from their phone).
 */
import { formatMoney, type Agorot } from './money.ts';

/** Israeli local number (05x…) → international digits (9725x…). Empty → no recipient (pick in WhatsApp). */
export function waNumber(phone: string | null | undefined): string {
  const d = (phone ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('972')) return d;
  if (d.startsWith('0')) return `972${d.slice(1)}`;
  return d;
}

export function whatsappUrl(phone: string | null | undefined, text: string): string {
  const n = waNumber(phone);
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}

export function quoteMessage(o: { business: string; clientName: string; title: string; date: string; guests: number; perGuest: Agorot | null; total: Agorot; version: number; link?: string }): string {
  return [
    `שלום ${o.clientName},`,
    `מצורפת הצעת המחיר מ${o.business} לאירוע "${o.title}" (${o.date}).`,
    `${o.guests} אורחים${o.perGuest ? ` · ${formatMoney(o.perGuest)} לאורח` : ''} · סה״כ ${formatMoney(o.total)} (גרסה ${o.version}).`,
    o.link ? `לצפייה והדפסה: ${o.link}` : '',
    'נשמח לעמוד לשירותך בכל שאלה.',
  ].filter(Boolean).join('\n');
}

export function poMessage(o: { business: string; id: number; date: string; time: string; warehouse: string; lines: { name: string; qty: number; unit: string }[]; note: string }): string {
  return [
    `הזמנת רכש #${o.id} מ${o.business}`,
    `אספקה: ${o.date}${o.time ? ` בשעה ${o.time}` : ''} · ${o.warehouse}`,
    '',
    ...o.lines.map((l) => `• ${l.name} – ${l.qty} ${l.unit}`),
    '',
    o.note,
  ].join('\n');
}
