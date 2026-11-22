import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../../lib/api.ts';
import { useAuth } from '../../lib/auth.tsx';
import { useUrlState } from '../../lib/useUrlState.ts';
import { Card, EmptyState, PageHeader, QueryView } from '../../ui/layout.tsx';
import { Segmented } from '../../ui/Tabs.tsx';
import { Input, Select, optionsOf } from '../../ui/form.tsx';
import { ExportButton } from '../process/ProcessPages.tsx';
import { useSettings } from '../../lib/settings.ts';
import { TaskRows } from './TaskList.tsx';
import { ROLES } from '@shared/permissions.ts';
import { VENUE_LABEL, WORK_STAGES, WORK_STAGE_ORDER } from '@shared/domain.ts';
import type { TaskRecord } from '@shared/types.ts';

type View = 'mine' | 'queue' | 'unclaimed' | 'blocked' | 'overdue' | 'escalated' | 'done' | 'ids';

export function TasksPage() {
  const auth = useAuth();
  const settings = useSettings();
  const [s, set] = useUrlState({ view: 'queue', role: '', venue: '', ids: '', label: '', stage: '', q: '', horizon: 'soon' });
  const horizon = s.horizon === 'all' ? 'all' : s.horizon === 'month' ? '30' : String(settings.taskHorizonDays || 'all');
  const view = s.view as View;
  const params = view === 'ids' ? { ids: s.ids, status: 'all' }
    : view === 'done' ? { status: 'done', role: s.role, venue: s.venue, stage: s.stage, q: s.q }
    : { view: view === 'queue' ? undefined : view, role: s.role, venue: s.venue, stage: s.stage, q: s.q, horizon };
  const q = useQuery({ queryKey: ['tasks', params], queryFn: () => api.get<TaskRecord[]>(`/tasks${qs(params)}`) });

  const views: { value: View; label: string }[] = [
    { value: 'mine', label: 'שלי' },
    { value: 'queue', label: 'כל התורים שלי' },
    { value: 'unclaimed', label: 'טרם נלקחו' },
    { value: 'blocked', label: 'חסומות' },
    { value: 'overdue', label: 'באיחור' },
    ...(auth.supervisor ? [{ value: 'escalated' as View, label: 'הסלמות' }] : []),
    { value: 'done', label: 'בוצעו' },
  ];

  return (
    <div>
      <PageHeader title="משימות" subtitle="משימות נוצרות מתבנית העבודה, במעבר שלב, לפני מועדים ובדיווח חריג. לוקחים מהתור, מסמנים חסימה, מעבירים למחליף." actions={<ExportButton kind="tasks" />} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {view === 'ids' ? (
          <div className="flex items-center gap-2 text-sm"><span className="font-semibold">{s.label || 'בחירה מהדשבורד'}</span><button className="text-[var(--color-brand)] underline" onClick={() => set({ view: 'queue', ids: '', label: '' })}>ניקוי</button></div>
        ) : (
          <Segmented label="תצוגת משימות" value={view} onChange={(v) => set({ view: v })} options={views} />
        )}
        {view !== 'ids' && view !== 'done' && (
          <Segmented label="טווח זמן" value={s.horizon} onChange={(v) => set({ horizon: v })}
            options={[{ value: 'soon', label: settings.taskHorizonDays ? `${settings.taskHorizonDays} ימים קרובים` : 'הכול' }, { value: 'month', label: 'חודש' }, { value: 'all', label: 'הכול' }]} />
        )}
        <div className="ms-auto flex flex-wrap gap-2">
          <Input aria-label="חיפוש משימה" placeholder="חיפוש לפי משימה או אירוע…" value={s.q} onChange={(e) => set({ q: e.target.value })} className="w-56" />
          <Select aria-label="סינון לפי שלב" value={s.stage} onChange={(e) => set({ stage: e.target.value })} placeholder="כל השלבים" options={WORK_STAGE_ORDER.map((x) => ({ value: x, label: `${WORK_STAGES[x].n}. ${WORK_STAGES[x].label}` }))} className="w-48" />
          <Select aria-label="סינון לפי תפקיד" value={s.role} onChange={(e) => set({ role: e.target.value })} placeholder="כל התפקידים" options={optionsOf(ROLES)} className="w-44" />
          <Select aria-label="סינון לפי נקודה" value={s.venue} onChange={(e) => set({ venue: e.target.value })} placeholder="כל הנקודות" options={optionsOf(VENUE_LABEL)} className="w-40" />
        </div>
      </div>
      <Card bodyClass="px-4 py-1">
        <QueryView q={q} empty={(d) => (d.length ? null : <EmptyState title="אין משימות בתצוגה הזו" />)}>
          {(d) => <TaskRows tasks={d} />}
        </QueryView>
      </Card>
    </div>
  );
}
