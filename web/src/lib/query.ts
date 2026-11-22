/**
 * Server state: React Query cache + live invalidation from the server's SSE change stream,
 * so the kitchen board and event pages update without reloads.
 */
import { QueryClient, useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ApiError } from './api.ts';
import { useToast } from '../ui/Toast.tsx';
import { focusFirstError } from '../ui/form.tsx';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

interface Hint { topic: string; id?: number; eventId?: number | null; clientId?: number | null }

const TOPIC_KEYS: Record<string, string[]> = {
  event: ['events', 'event', 'dashboard', 'calendar', 'kitchen', 'field', 'tasks', 'client', 'pipeline'],
  client: ['clients', 'client', 'calendar', 'dashboard'],
  task: ['tasks', 'task', 'dashboard', 'event'],
  inventory: ['inventory', 'kitchen', 'event', 'dashboard', 'purchasing'],
  purchasing: ['purchasing', 'inventory', 'calendar', 'tasks'],
  catalog: ['catalog'],
  calendar: ['calendar', 'events', 'dashboard'],
  finance: ['finance', 'event', 'dashboard', 'events'],
  settings: ['settings'],
};

let pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
function invalidate(keys: string[]) {
  keys.forEach((k) => pending.add(k));
  if (timer) return;
  timer = setTimeout(() => {
    const batch = pending;
    pending = new Set();
    timer = null;
    for (const k of batch) void queryClient.invalidateQueries({ queryKey: [k] });
  }, 250);
}

/** Connect to the change stream while signed in. Reconnects automatically (EventSource). */
export function useLiveUpdates(enabled: boolean): 'live' | 'connecting' | 'offline' {
  const [state, setState] = useState<'live' | 'connecting' | 'offline'>('connecting');
  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource('/api/stream');
    es.addEventListener('hello', () => setState('live'));
    es.addEventListener('change', (e) => {
      try {
        const h = JSON.parse((e as MessageEvent).data) as Hint;
        invalidate(TOPIC_KEYS[h.topic] ?? []);
      } catch { /* ignore malformed hint */ }
    });
    es.onerror = () => setState(es.readyState === EventSource.CLOSED ? 'offline' : 'connecting');
    es.onopen = () => setState('live');
    return () => es.close();
  }, [enabled]);
  return state;
}

/**
 * Mutation with toast feedback and cache refresh. `optimistic` patches cached data immediately and
 * rolls back automatically if the server rejects.
 */
export function useAction<TVars, TResult = unknown>(
  fn: (v: TVars) => Promise<TResult>,
  opts: {
    success?: string | ((r: TResult) => string);
    invalidate?: QueryKey[];
    optimistic?: { key: QueryKey; update: (old: unknown, vars: TVars) => unknown };
    onSuccess?: (r: TResult, v: TVars) => void;
    onError?: (e: ApiError) => void;
    silentError?: boolean;
  } = {},
) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<TResult, ApiError, TVars, { prev?: unknown }>({
    mutationFn: fn,
    onMutate: async (vars) => {
      if (!opts.optimistic) return {};
      await qc.cancelQueries({ queryKey: opts.optimistic.key });
      const prev = qc.getQueryData(opts.optimistic.key);
      qc.setQueryData(opts.optimistic.key, (old: unknown) => opts.optimistic!.update(old, vars));
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (opts.optimistic && ctx && 'prev' in ctx) qc.setQueryData(opts.optimistic.key, ctx.prev);
      if (!opts.silentError) toast.error(e.message);
      if (e.status === 422 || e.status === 409) focusFirstError();
      opts.onError?.(e);
    },
    onSuccess: (r, v) => {
      if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(r) : opts.success);
      opts.onSuccess?.(r, v);
    },
    onSettled: () => {
      for (const k of opts.invalidate ?? []) void qc.invalidateQueries({ queryKey: k });
    },
  });
}
