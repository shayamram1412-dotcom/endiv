/** The event's run of show: a default from settings (shifted to this event's start), editable per event. */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, RotateCcw } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { useAction } from '../../lib/query.ts';
import { Card, QueryView } from '../../ui/layout.tsx';
import { Button } from '../../ui/Button.tsx';
import { Badge } from '../../ui/Badge.tsx';
import { FormError, Input, Select } from '../../ui/form.tsx';
import { ROLES, type Role } from '@shared/permissions.ts';

interface Row { time: string; title: string; role: string; notes: string }
interface View { rows: Row[]; isDefault: boolean; canEdit: boolean }

const nowHHMM = () => new Date().toTimeString().slice(0, 5);

export function RunOfShow({ eventId, isToday }: { eventId: number; isToday?: boolean }) {
  const key = ['event', eventId, 'run-of-show'];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<View>(`/events/${eventId}/run-of-show`) });
  const [draft, setDraft] = useState<Row[] | null>(null);
  const save = useAction(() => api.put(`/events/${eventId}/run-of-show`, { rows: (draft ?? []).filter((r) => r.time || r.title) }), { success: 'הלו״ז נשמר', invalidate: [key, ['field', eventId]], onSuccess: () => setDraft(null) });
  const reset = useAction(() => api.del(`/events/${eventId}/run-of-show`), { success: 'הוחזר לברירת המחדל', invalidate: [key], onSuccess: () => setDraft(null) });
  const set = (i: number, p: Partial<Row>) => setDraft((d) => (d ?? []).map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <Card title="לו״ז האירוע" className="mb-4" actions={q.data?.canEdit && (draft ? <>
      <Button size="sm" onClick={() => setDraft(null)}>ביטול</Button>
      <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>שמירה</Button>
    </> : <>
      {!q.data.isDefault && <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} loading={reset.isPending} onClick={() => reset.mutate(undefined)}>ברירת מחדל</Button>}
      <Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => setDraft(q.data!.rows.map(({ time, title, role, notes }) => ({ time, title, role, notes })))}>עריכה</Button>
    </>)}>
      <QueryView q={q}>
        {(v) => draft ? (
          <div className="space-y-2">
            <FormError message={save.error?.message} />
            {draft.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Input aria-label="שעה" type="time" value={r.time} onChange={(e) => set(i, { time: e.target.value })} className="w-28" />
                <Input aria-label="מה קורה" value={r.title} onChange={(e) => set(i, { title: e.target.value })} className="min-w-40 flex-1" />
                <Select aria-label="אחראי" value={r.role} onChange={(e) => set(i, { role: e.target.value })} placeholder="ללא" options={Object.entries(ROLES).filter(([k]) => k !== 'staff').map(([value, label]) => ({ value, label }))} className="w-36" />
                <Input aria-label="הערה" placeholder="הערה" value={r.notes} onChange={(e) => set(i, { notes: e.target.value })} className="w-40" />
                <button onClick={() => setDraft((d) => (d ?? []).filter((_, j) => j !== i))} className="p-1 text-[var(--color-danger)]" aria-label="הסרת שורה"><Trash2 className="size-4" /></button>
              </div>
            ))}
            <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setDraft((d) => [...(d ?? []), { time: '', title: '', role: '', notes: '' }])}>שורה</Button>
          </div>
        ) : (
          <>
            {v.isDefault && <p className="mb-2 text-xs text-[var(--color-muted)]">לו״ז ברירת מחדל מההגדרות, לפי שעת ההתחלה. אפשר לערוך לאירוע הזה.</p>}
            {!v.rows.length ? <p className="text-sm text-[var(--color-muted)]">אין לו״ז – חסרה שעת התחלה לאירוע.</p> : (
              <ol className="space-y-1.5">
                {v.rows.map((r, i) => {
                  const past = isToday && r.time && r.time < nowHHMM();
                  return (
                    <li key={i} className={`flex items-baseline gap-3 ${past ? 'opacity-50' : ''}`}>
                      <span className="num w-12 shrink-0 font-bold">{r.time || '—'}</span>
                      <span className="flex-1">{r.title}{r.notes && <span className="text-sm text-[var(--color-muted)]"> · {r.notes}</span>}</span>
                      {r.role && <Badge>{ROLES[r.role as Role]}</Badge>}
                    </li>
                  );
                })}
              </ol>
            )}
          </>
        )}
      </QueryView>
    </Card>
  );
}
