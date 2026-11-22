/** Date helpers. Dates are ISO 'YYYY-MM-DD' in local (Israel) time; timestamps are ISO strings. */

const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function today(): string {
  return toISODate(new Date());
}
export function parseISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(s: string, n: number): string {
  const d = parseISODate(s);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / 86_400_000);
}
/** Sunday-based week start (Israeli work week). */
export function weekStart(s: string): string {
  const d = parseISODate(s);
  d.setDate(d.getDate() - d.getDay());
  return toISODate(d);
}
export function monthStart(s: string): string {
  return s.slice(0, 8) + '01';
}
export function nowISO(): string {
  return new Date().toISOString();
}
export function addHours(iso: string, h: number): string {
  return new Date(new Date(iso).getTime() + h * 3_600_000).toISOString();
}
export function isISODate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parseISODate(s).getTime());
}

const dayFmt = new Intl.DateTimeFormat('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' });
const longFmt = new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const tsFmt = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

export function formatDay(s: string | null | undefined): string {
  return s ? dayFmt.format(parseISODate(s)) : '—';
}
export function formatLongDay(s: string | null | undefined): string {
  return s ? longFmt.format(parseISODate(s)) : '—';
}
export function formatTs(iso: string | null | undefined): string {
  return iso ? tsFmt.format(new Date(iso)) : '—';
}
export function relativeDays(s: string, from = today()): string {
  const n = daysBetween(from, s);
  if (n === 0) return 'היום';
  if (n === 1) return 'מחר';
  if (n === -1) return 'אתמול';
  return n > 0 ? `בעוד ${n} ימים` : `לפני ${-n} ימים`;
}
