/**
 * Stock allocation between events. Physical balance is allocated to demands by event date (earliest first).
 * Example from the spec: balance 100, demands 70 + 60 → second event is short 30.
 */
import { q } from './kitchen.ts';

export interface Demand {
  eventId: number;
  date: string;
  title?: string;
  qty: number;
}

export interface AllocationRow extends Demand {
  allocated: number;
  short: number;
}

export interface Allocation {
  balance: number;
  totalNeed: number;
  /** Ordered from suppliers but not received yet. */
  incoming: number;
  /** Missing after using the physical balance. */
  shortage: number;
  /** Missing even after the open orders arrive → must be ordered. */
  uncovered: number;
  rows: AllocationRow[];
}

export function allocate(balance: number, demands: Demand[], incoming = 0): Allocation {
  const sorted = [...demands].sort((a, b) => a.date.localeCompare(b.date) || a.eventId - b.eventId);
  let left = Math.max(0, balance);
  const rows: AllocationRow[] = sorted.map((d) => {
    const allocated = q(Math.min(left, d.qty));
    left = q(left - allocated);
    return { ...d, allocated, short: q(d.qty - allocated) };
  });
  const totalNeed = q(sorted.reduce((s, d) => s + d.qty, 0));
  const shortage = q(Math.max(0, totalNeed - Math.max(0, balance)));
  return { balance, totalNeed, incoming, shortage, uncovered: q(Math.max(0, shortage - incoming)), rows };
}

export interface ReceiptResult {
  received: number;
  gap: number;
  status: 'received' | 'partial' | 'over';
}

/** Compare ordered vs. received for one purchase line (partial delivery leaves the gap open). */
export function receiptGap(ordered: number, receivedTotal: number): ReceiptResult {
  const gap = q(ordered - receivedTotal);
  return { received: receivedTotal, gap: Math.max(0, gap), status: gap > 0 ? 'partial' : gap < 0 ? 'over' : 'received' };
}

/** Loading vs unloading vs returned counts for one equipment / food line. */
export function countGap(expected: number | null, counted: number | null): number | null {
  if (expected === null || counted === null) return null;
  return q(expected - counted);
}
