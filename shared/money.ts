/**
 * Money is always an integer number of agorot. Never do float arithmetic on shekels.
 */
export type Agorot = number;

export function assertAgorot(v: number): Agorot {
  if (!Number.isSafeInteger(v)) throw new Error(`סכום לא תקין: ${v}`);
  return v;
}

/** Parse user input like "12,500.50" or "₪ 1200" into agorot. Returns null for empty/invalid. */
export function parseShekels(input: string | number | null | undefined): Agorot | null {
  if (input === null || input === undefined) return null;
  const s = String(input).replace(/[₪,\s]/g, '');
  if (!s) return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  const negative = s.startsWith('-');
  const [whole, frac = ''] = s.replace('-', '').split('.');
  const value = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return negative ? -value : value;
}

const fmt = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 2, minimumFractionDigits: 0 });

export function formatMoney(a: Agorot | null | undefined): string {
  if (a === null || a === undefined) return '—';
  // Division only for display.
  return fmt.format(a / 100);
}

/** Agorot → editable string ("1250.5"). */
export function toShekelInput(a: Agorot | null | undefined): string {
  if (a === null || a === undefined) return '';
  const sign = a < 0 ? '-' : '';
  const abs = Math.abs(a);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return sign + whole + (frac ? '.' + String(frac).padStart(2, '0').replace(/0$/, '') : '');
}

export function sumAgorot(values: Array<Agorot | null | undefined>): Agorot {
  let total = 0;
  for (const v of values) if (v) total += v;
  return total;
}

/** Multiply agorot by an integer count (e.g. price per guest × guests). */
export function multiply(a: Agorot, count: number): Agorot {
  if (!Number.isInteger(count)) throw new Error('multiply expects an integer count');
  return a * count;
}
