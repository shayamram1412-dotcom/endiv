import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Filters live in the URL, so "back to list" restores the filter and date the user came from,
 * and any filtered view can be shared as a link.
 */
export function useUrlState<T extends Record<string, string>>(defaults: T): [T, (patch: Partial<T>) => void] {
  const [params, setParams] = useSearchParams();
  const state = { ...defaults } as T;
  for (const k of Object.keys(defaults)) {
    const v = params.get(k);
    if (v !== null) (state as Record<string, string>)[k] = v;
  }
  const set = useCallback(
    (patch: Partial<T>) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined || v === '' || v === (defaults as Record<string, string>)[k]) next.delete(k);
          else next.set(k, v as string);
        }
        return next;
      }, { replace: true });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setParams],
  );
  return [state, set];
}
