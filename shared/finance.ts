/**
 * Collection status per event. All amounts in agorot.
 */
import type { PaymentKind, PaymentStatus } from './domain.ts';
import { sumAgorot, type Agorot } from './money.ts';

export interface PaymentLine {
  kind: PaymentKind;
  amount: Agorot;
  dueDate: string | null;
  received: Agorot;
  receivedAt: string | null;
}

export interface CollectionSummary {
  contract: Agorot;
  scheduled: Agorot;
  received: Agorot;
  balance: Agorot;
  /** Scheduled amount whose due date has passed and is not fully received. */
  overdue: Agorot;
  status: PaymentStatus;
  nextDue: { kind: PaymentKind; dueDate: string | null; open: Agorot } | null;
}

export function summarizeCollection(contract: Agorot | null, lines: PaymentLine[], today: string): CollectionSummary {
  const c = contract ?? 0;
  const received = sumAgorot(lines.map((l) => l.received));
  const scheduled = sumAgorot(lines.map((l) => l.amount));
  const balance = c - received;
  const open = lines
    .filter((l) => l.received < l.amount)
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
  const overdue = sumAgorot(open.filter((l) => l.dueDate && l.dueDate < today).map((l) => l.amount - l.received));
  const deposit = lines.find((l) => l.kind === 'deposit');
  let status: PaymentStatus;
  if (c <= 0 && scheduled <= 0) status = 'none';
  else if (balance <= 0) status = 'paid';
  else if (deposit && deposit.received < deposit.amount) status = deposit.dueDate && deposit.dueDate < today ? 'deposit_late' : 'deposit_due';
  else status = overdue > 0 ? 'balance_late' : 'balance_due';
  const n = open[0];
  return {
    contract: c,
    scheduled,
    received,
    balance,
    overdue,
    status,
    nextDue: n ? { kind: n.kind, dueDate: n.dueDate, open: n.amount - n.received } : null,
  };
}
