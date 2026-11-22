import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Save, Wand2 } from 'lucide-react';
import { api } from '../../../lib/api.ts';
import { useAction } from '../../../lib/query.ts';
import { UnsavedGuard } from '../../../lib/useEditForm.tsx';
import { useAuth } from '../../../lib/auth.tsx';
import { Card, QueryView } from '../../../ui/layout.tsx';
import { Button } from '../../../ui/Button.tsx';
import { Badge } from '../../../ui/Badge.tsx';
import { Field, FormError, Input } from '../../../ui/form.tsx';
import { STAFF_ROLES, STAFF_ROLE_OWNER, type StaffRole } from '@shared/domain.ts';
import type { EventDetail, StaffingLine } from '@shared/types.ts';

interface Row { role: StaffRole; required: number; assigned: number; arrived: number | null; notes: string }

export function StaffTab({ d }: { d: EventDetail }) {
  const ev = d.event;
  const q = useQuery({ queryKey: ['event', ev.id, 'staffing'], queryFn: () => api.get<{ lines: StaffingLine[]; suggestion: { role: StaffRole; required: number }[]; ubeyaRef: string }>(`/events/${ev.id}/staffing`) });
  const [rows, setRows] = useState<Row[]>([]);
  const [ubeya, setUbeya] = useState('');
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!q.data || dirty) return;
    setRows((Object.keys(STAFF_ROLES) as StaffRole[]).map((role) => {
      const l = q.data.lines.find((x) => x.role === role);
      return { role, required: l?.required ?? 0, assigned: l?.assigned ?? 0, arrived: l?.arrived ?? null, notes: l?.notes ?? '' };
    }));
    setUbeya(q.data.ubeyaRef);
  }, [q.data, dirty]);
  const canEdit = d.access.staffing >= 2;
  const auth = useAuth();
  // Cooks belong to the kitchen manager, the rest to the event manager; owner/operations can edit all.
  const canEditRole = (role: StaffRole) => canEdit && (auth.hasRole('owner') || auth.hasRole('ops') || auth.hasRole(STAFF_ROLE_OWNER[role] === 'kitchen' ? 'kitchen' : 'event_manager', ev.venue));
  const save = useAction(() => api.put(`/events/${ev.id}/staffing`, { lines: rows, ubeyaRef: ubeya }), { success: 'סיכום הצוות נשמר', invalidate: [['event', ev.id]], onSuccess: () => setDirty(false) });
  const upd = (i: number, p: Partial<Row>) => { setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x))); setDirty(true); };
  const suggest = () => {
    setRows((r) => r.map((x) => (canEditRole(x.role) ? { ...x, required: q.data?.suggestion.find((s) => s.role === x.role)?.required ?? x.required } : x)));
    setDirty(true);
  };

  return (
    <QueryView q={q}>
      {() => (
        <div className="space-y-5">
          <UnsavedGuard when={dirty} />
          <p className="rounded-[10px] bg-[var(--color-surface-2)] p-3 text-sm">השיבוץ והנוכחות מנוהלים ב-Ubeya. כאן מסכמים ידנית דרישה, שיבוץ, הגעה וחוסרים. טבחים באחריות מנהל המטבח, שאר הצוות באחריות מנהל האירוע.</p>
          <Card title="תקן, שיבוץ והגעה" bodyClass="p-0" actions={canEdit && <>
            <Button size="sm" icon={<Wand2 className="size-4" />} onClick={suggest}>הצעת תקן לפי {ev.guests} אורחים</Button>
            <Button size="sm" variant="primary" icon={<Save className="size-4" />} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(undefined)}>שמירה</Button>
          </>}>
            <FormError message={save.error?.message} />
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>תפקיד</th><th>אחריות</th><th>נדרש</th><th>שובץ</th><th>הגיע</th><th>מצב</th><th>הערות</th></tr></thead>
                <tbody>
                  {rows.map((r, i) => {
                    const gap = r.required - r.assigned;
                    const arrivedGap = r.arrived !== null ? r.assigned - r.arrived : 0;
                    return (
                      <tr key={r.role}>
                        <td className="font-semibold">{STAFF_ROLES[r.role]}</td>
                        <td className="text-xs text-[var(--color-muted)]">{STAFF_ROLE_OWNER[r.role] === 'kitchen' ? 'מנהל מטבח' : 'מנהל אירוע'}</td>
                        {(['required', 'assigned'] as const).map((k) => (
                          <td key={k}><input aria-label={`${k === 'required' ? 'נדרש' : 'שובץ'} ${STAFF_ROLES[r.role]}`} type="number" min={0} disabled={!canEditRole(r.role)} className="input num w-20" value={r[k]} onChange={(e) => upd(i, { [k]: Number(e.target.value) })} /></td>
                        ))}
                        <td><input aria-label={`הגיעו ${STAFF_ROLES[r.role]}`} type="number" min={0} disabled={!canEditRole(r.role)} placeholder="—" className="input num w-20" value={r.arrived ?? ''} onChange={(e) => upd(i, { arrived: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                        <td>{r.required === 0 ? <span className="text-xs text-[var(--color-muted)]">לא נדרש</span> : gap > 0 ? <Badge tone="danger">חסרים {gap}</Badge> : arrivedGap > 0 ? <Badge tone="warn">{arrivedGap} לא הגיעו</Badge> : <Badge tone="ok">מלא</Badge>}</td>
                        <td><input aria-label={`הערות ${STAFF_ROLES[r.role]}`} disabled={!canEditRole(r.role)} className="input min-w-32" value={r.notes} onChange={(e) => upd(i, { notes: e.target.value })} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="Ubeya">
            <Field label="מזהה האירוע ב-Ubeya" className="max-w-xs">{(p) => <Input {...p} disabled={!canEdit} dir="ltr" className="text-start" value={ubeya} onChange={(e) => { setUbeya(e.target.value); setDirty(true); }} />}</Field>
          </Card>
        </div>
      )}
    </QueryView>
  );
}
