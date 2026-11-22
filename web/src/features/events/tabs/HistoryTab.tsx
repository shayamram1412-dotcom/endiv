import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api.ts';
import { Card, EmptyState, QueryView } from '../../../ui/layout.tsx';
import { TaskRows } from '../../tasks/TaskList.tsx';
import { EVENT_FIELD_LABELS, auditActionLabel, formatValue } from '../../../lib/labels.ts';
import { formatTs } from '@shared/dates.ts';
import type { AuditRecord, TaskRecord } from '@shared/types.ts';

export function HistoryTab({ eventId }: { eventId: number }) {
  const q = useQuery({ queryKey: ['event', eventId, 'history'], queryFn: () => api.get<AuditRecord[]>(`/events/${eventId}/history`) });
  return (
    <Card title="היסטוריית שינויים" bodyClass="p-0">
      <QueryView q={q} empty={(l) => (l.length ? null : <EmptyState title="אין היסטוריה" />)}>
        {(list) => (
          <ol className="divide-y divide-[var(--color-border)]">
            {list.map((a) => {
              const diff = Object.entries(a.diff).filter(([k]) => k !== 'changes');
              const menuChanges = (a.diff as { changes?: { type: string; label: string }[] }).changes;
              return (
                <li key={a.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-x-2">
                    <span className="font-semibold">{auditActionLabel(a.action)}</span>
                    {a.summary && <span>{a.summary}</span>}
                    <span className="ms-auto text-xs text-[var(--color-muted)]">{a.userName ?? 'מערכת'} · {formatTs(a.at)}</span>
                  </div>
                  {diff.length > 0 && a.action === 'updated' && (
                    <ul className="mt-1 space-y-0.5 text-[13px] text-[var(--color-ink-2)]">
                      {diff.map(([k, v]) => {
                        const ch = v as { from: unknown; to: unknown };
                        return <li key={k}><span className="font-semibold">{EVENT_FIELD_LABELS[k] ?? k}:</span> <span className="line-through opacity-70">{formatValue(ch.from)}</span> → {formatValue(ch.to)}</li>;
                      })}
                    </ul>
                  )}
                  {menuChanges && menuChanges.length > 0 && <div className="mt-1 text-[13px] text-[var(--color-ink-2)]">{menuChanges.map((c) => `${c.type === 'added' ? '+' : c.type === 'removed' ? '−' : '~'} ${c.label}`).join(' · ')}</div>}
                </li>
              );
            })}
          </ol>
        )}
      </QueryView>
    </Card>
  );
}

export function EventTasksTab({ eventId }: { eventId: number }) {
  const q = useQuery({ queryKey: ['tasks', { event: eventId }], queryFn: () => api.get<TaskRecord[]>(`/tasks?event=${eventId}&status=all`) });
  return (
    <Card title="משימות האירוע" bodyClass="px-4 py-1">
      <QueryView q={q} empty={(l) => (l.length ? null : <EmptyState title="אין משימות לאירוע" />)}>
        {(l) => <TaskRows tasks={l} />}
      </QueryView>
    </Card>
  );
}
