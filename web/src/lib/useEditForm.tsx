/**
 * Edit form with field-level concurrency:
 *  - tracks the values the user started from (`base`) and only sends changed fields;
 *  - on 409 shows which fields another user changed, with "keep mine" / "take theirs";
 *  - on failure keeps everything typed, so the user can retry;
 *  - warns before leaving with unsaved changes.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { ApiError } from './api.ts';
import { focusFirstError } from '../ui/form.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { Button } from '../ui/Button.tsx';
import { EVENT_FIELD_LABELS, formatValue } from './labels.ts';

export interface Conflict { field: string; yours: unknown; theirs: unknown }

export function useEditForm<T extends object>(source: T | undefined) {
  const [values, setValues] = useState<T | undefined>(source);
  const [base, setBase] = useState<T | undefined>(source);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const dirtyRef = useRef(false);

  const changes = (() => {
    if (!values || !base) return {} as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(values) as (keyof T & string)[]) {
      if ((values[k] ?? '') !== (base[k] ?? '')) out[k] = values[k];
    }
    return out;
  })();
  const dirty = Object.keys(changes).length > 0;
  dirtyRef.current = dirty;

  // Fresh server data flows in while the user has nothing pending.
  useEffect(() => {
    if (!source) return;
    if (!dirtyRef.current) { setValues(source); setBase(source); }
  }, [source]);

  const set = useCallback(<K extends keyof T>(k: K, v: T[K]) => {
    setValues((cur) => (cur ? { ...cur, [k]: v } : cur));
    setErrors((e) => { if (!e[k as string]) return e; const n = { ...e }; delete n[k as string]; return n; });
  }, []);

  const baseFor = (): Record<string, unknown> => {
    const b: Record<string, unknown> = {};
    for (const k of Object.keys(changes)) b[k] = (base as Record<string, unknown>)[k];
    return b;
  };

  const handleError = (e: unknown) => {
    if (!(e instanceof ApiError)) { setFormError('שגיאה בשמירה. הנתונים שהקלדת נשמרו בטופס.'); return; }
    setFormError(e.message);
    if (e.status === 409 && e.conflicts.length) setConflicts(e.conflicts);
    if (Object.keys(e.fields).length) setErrors(e.fields);
    focusFirstError();
  };

  const saved = (next?: T) => {
    setErrors({}); setConflicts([]); setFormError(null);
    if (next) { setValues(next); setBase(next); }
    else setBase(values);
  };

  const resolve = (field: string, choice: 'mine' | 'theirs') => {
    const c = conflicts.find((x) => x.field === field);
    if (!c) return;
    setBase((b) => (b ? { ...b, [field]: c.theirs } : b));
    if (choice === 'theirs') setValues((v) => (v ? { ...v, [field]: c.theirs } : v));
    setConflicts((l) => l.filter((x) => x.field !== field));
    if (conflicts.length <= 1) setFormError(null);
  };

  const discard = () => { setValues(base); setErrors({}); setConflicts([]); setFormError(null); };

  return { values, set, changes, base: baseFor, dirty, errors, conflicts, formError, handleError, saved, resolve, discard };
}

export function ConflictPanel({ conflicts, onResolve, labels = EVENT_FIELD_LABELS, format }: {
  conflicts: Conflict[]; onResolve: (field: string, choice: 'mine' | 'theirs') => void; labels?: Record<string, string>; format?: (field: string, v: unknown) => string;
}) {
  if (!conflicts.length) return null;
  const f = format ?? ((_: string, v: unknown) => formatValue(v));
  return (
    <div role="alert" className="rounded-[10px] border border-[var(--color-warn)] bg-[var(--color-warn-soft)] p-3">
      <p className="mb-2 text-sm font-bold text-[var(--color-warn)]">משתמש אחר שינה את השדות האלה בזמן שערכת. בחר מה לשמור:</p>
      <ul className="space-y-2">
        {conflicts.map((c) => (
          <li key={c.field} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-28 font-semibold">{labels[c.field] ?? c.field}</span>
            <span>שלך: <strong>{f(c.field, c.yours)}</strong></span>
            <span>· עדכני: <strong>{f(c.field, c.theirs)}</strong></span>
            <span className="ms-auto flex gap-1.5">
              <Button size="sm" onClick={() => onResolve(c.field, 'theirs')}>לקחת את העדכני</Button>
              <Button size="sm" variant="primary" onClick={() => onResolve(c.field, 'mine')}>להשאיר את שלי</Button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Blocks in-app navigation and tab close while there are unsaved changes. */
export function UnsavedGuard({ when }: { when: boolean }) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => when && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!when) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [when]);
  return (
    <Dialog open={blocker.state === 'blocked'} onClose={() => blocker.reset?.()} title="יש שינויים שלא נשמרו" size="sm"
      footer={<>
        <Button onClick={() => blocker.reset?.()}>חזרה לעריכה</Button>
        <Button variant="danger" onClick={() => blocker.proceed?.()}>יציאה בלי לשמור</Button>
      </>}>
      <p className="text-sm">השינויים שהקלדת עדיין לא נשמרו. לצאת בכל זאת?</p>
    </Dialog>
  );
}
