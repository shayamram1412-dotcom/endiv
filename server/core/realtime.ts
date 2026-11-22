/**
 * In-process change bus. Mutations publish what changed; connected browsers receive
 * invalidation hints over SSE and refetch through permission-checked endpoints.
 */
export interface ChangeHint {
  topic: 'event' | 'client' | 'task' | 'inventory' | 'purchasing' | 'catalog' | 'settings' | 'calendar' | 'finance';
  id?: number;
  eventId?: number | null;
  clientId?: number | null;
  by?: number;
}

type Listener = (h: ChangeHint) => void;
const listeners = new Set<Listener>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let pending: ChangeHint[] = [];
let scheduled = false;

/** Batched per tick so a request touching many rows sends one burst. */
export function publish(...hints: ChangeHint[]): void {
  pending.push(...hints);
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    const batch = pending;
    pending = [];
    scheduled = false;
    const seen = new Set<string>();
    for (const h of batch) {
      const key = JSON.stringify(h);
      if (seen.has(key)) continue;
      seen.add(key);
      for (const l of listeners) {
        try { l(h); } catch { /* a broken stream must not affect others */ }
      }
    }
  });
}
