/** Vehicles for the event: which vehicle, driver, departure and return. Warns when a vehicle is double-booked. */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2, Truck } from 'lucide-react';
import { api } from '../../../lib/api.ts';
import { useAction } from '../../../lib/query.ts';
import { Card, EmptyState, QueryView } from '../../../ui/layout.tsx';
import { Button } from '../../../ui/Button.tsx';
import { FormError, Input, Select } from '../../../ui/form.tsx';

interface Line { vehicleId: number; driver: string; departTime: string; returnTime: string; notes: string }
interface View {
  lines: (Line & { vehicleName: string; plate: string })[];
  vehicles: { id: number; name: string; plate: string }[];
  conflicts: { vehicleName: string; events: { eventId: number; title: string; depart: string; back: string }[] }[];
}

export function TransportCard({ eventId, canEdit }: { eventId: number; canEdit: boolean }) {
  const q = useQuery({ queryKey: ['event', eventId, 'transport'], queryFn: () => api.get<View>(`/events/${eventId}/transport`) });
  const [rows, setRows] = useState<Line[] | null>(null);
  useEffect(() => { if (q.data && rows === null) setRows(q.data.lines.map(({ vehicleId, driver, departTime, returnTime, notes }) => ({ vehicleId, driver, departTime, returnTime, notes }))); }, [q.data, rows]);
  const save = useAction(() => api.put<{ conflicts: View['conflicts'] }>(`/events/${eventId}/transport`, { lines: rows ?? [] }), {
    success: (r) => (r.conflicts.length ? 'נשמר – שים לב: הרכב משובץ גם לאירוע אחר באותן שעות' : 'ההובלה נשמרה'),
    invalidate: [['event', eventId, 'transport']],
  });
  const set = (i: number, patch: Partial<Line>) => setRows((r) => (r ?? []).map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const dirty = q.data && rows && JSON.stringify(rows) !== JSON.stringify(q.data.lines.map(({ vehicleId, driver, departTime, returnTime, notes }) => ({ vehicleId, driver, departTime, returnTime, notes })));
  return (
    <Card title="הובלה ורכבים" actions={canEdit && <>
      <Button size="sm" icon={<Plus className="size-4" />} disabled={!q.data?.vehicles.length} onClick={() => setRows((r) => [...(r ?? []), { vehicleId: q.data!.vehicles[0].id, driver: '', departTime: '', returnTime: '', notes: '' }])}>רכב</Button>
      {dirty && <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>שמירה</Button>}
    </>}>
      <QueryView q={q}>
        {(v) => (
          <div className="space-y-3">
            <FormError message={save.error?.message} />
            {v.conflicts.length > 0 && (
              <div role="alert" className="rounded-[10px] border border-[var(--color-warn)] bg-[var(--color-warn-soft)] p-3 text-sm">
                {v.conflicts.map((c, i) => (
                  <p key={i}><strong>{c.vehicleName}</strong> משובץ באותו יום בשעות חופפות: {c.events.map((e) => <span key={e.eventId}>{e.eventId === eventId ? 'כאן' : <Link to={`/events/${e.eventId}/logistics`} className="underline">{e.title}</Link>} ({e.depart || '?'}–{e.back || '?'}) </span>)}</p>
                ))}
              </div>
            )}
            {!v.vehicles.length && <p className="text-sm text-[var(--color-muted)]">לא הוגדרו רכבים. מוסיפים אותם בהגדרות ← רכבים.</p>}
            {!(rows ?? []).length ? <EmptyState title="לא שובץ רכב" icon={<Truck className="size-6" />} /> : (
              <ul className="space-y-2">
                {(rows ?? []).map((r, i) => (
                  <li key={i} className="flex flex-wrap items-end gap-2">
                    <Select aria-label="רכב" disabled={!canEdit} value={r.vehicleId} onChange={(e) => set(i, { vehicleId: Number(e.target.value) })} options={v.vehicles.map((x) => ({ value: x.id, label: `${x.name}${x.plate ? ` (${x.plate})` : ''}` }))} className="w-48" />
                    <Input aria-label="נהג" disabled={!canEdit} placeholder="נהג" value={r.driver} onChange={(e) => set(i, { driver: e.target.value })} className="w-32" />
                    <label className="text-xs text-[var(--color-muted)]">יציאה<Input type="time" disabled={!canEdit} value={r.departTime} onChange={(e) => set(i, { departTime: e.target.value })} className="w-28" /></label>
                    <label className="text-xs text-[var(--color-muted)]">חזרה<Input type="time" disabled={!canEdit} value={r.returnTime} onChange={(e) => set(i, { returnTime: e.target.value })} className="w-28" /></label>
                    <Input aria-label="הערות" disabled={!canEdit} placeholder="הערות" value={r.notes} onChange={(e) => set(i, { notes: e.target.value })} className="min-w-32 flex-1" />
                    {canEdit && <button onClick={() => setRows((x) => (x ?? []).filter((_, j) => j !== i))} className="p-2 text-[var(--color-danger)]" aria-label="הסרת רכב"><Trash2 className="size-4" /></button>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </QueryView>
    </Card>
  );
}
