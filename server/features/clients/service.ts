import { get, insert } from '../../core/db.ts';
import { HttpError } from '../../core/http.ts';
import { nowISO } from '../../../shared/dates.ts';
import type { ClientKind } from '../../../shared/domain.ts';

export const phoneDigits = (p: string) => {
  const d = p.replace(/\D/g, '');
  return d.startsWith('972') ? '0' + d.slice(3) : d;
};

export interface NewClient {
  name: string;
  phone: string;
  email?: string;
  kind?: ClientKind;
  company?: string;
  source?: string;
  notes?: string;
}

/** Create a client, refusing silent duplicates by phone number. */
export function createClient(c: NewClient, ownerId: number, allowDuplicate = false, canSee: (clientId: number) => boolean = () => true): number {
  const digits = phoneDigits(c.phone);
  if (digits && !allowDuplicate) {
    const dup = get<{ id: number; name: string }>('SELECT id, name FROM clients WHERE phone_digits = ?', digits);
    if (dup) {
      const visible = canSee(dup.id);
      throw new HttpError(409, visible ? `קיים כבר לקוח עם הטלפון הזה: ${dup.name}` : 'קיים כבר לקוח עם הטלפון הזה (בנקודה אחרת)', 'duplicate_client', { clientId: dup.id, name: visible ? dup.name : null, hidden: !visible });
    }
  }
  const now = nowISO();
  return insert('clients', {
    kind: c.kind ?? 'private',
    name: c.name,
    phone: c.phone,
    phone_digits: digits,
    email: c.email ?? '',
    company: c.company ?? '',
    source: c.source ?? '',
    notes: c.notes ?? '',
    owner_id: ownerId,
    created_at: now,
    updated_at: now,
  });
}
