/** Event progress through the 8-stage work process: current stage, task completion, blockers, checkpoint. */
import { all } from '../../core/db.ts';
import { getSettings } from '../../core/settings.ts';
import { VENUE_RULES, WORK_STAGE_ORDER, type WorkStage } from '../../../shared/domain.ts';
import { addHours } from '../../../shared/dates.ts';
import type { EventProgress, EventRecord } from '../../../shared/types.ts';
import { eventStartISO } from '../events/service.ts';

interface Counts { stage: WorkStage; status: string; n: number }

export function eventProgress(ev: EventRecord): EventProgress {
  const rows = all<Counts>("SELECT stage, status, COUNT(*) AS n FROM tasks WHERE event_id = ? AND status != 'cancelled' GROUP BY stage, status", ev.id);
  const byStage = WORK_STAGE_ORDER.map((stage) => {
    const r = rows.filter((x) => x.stage === stage);
    const sum = (f: (s: string) => boolean) => r.filter((x) => f(x.status)).reduce((a, x) => a + x.n, 0);
    return { stage, open: sum((s) => s !== 'done'), done: sum((s) => s === 'done'), blocked: sum((s) => s === 'blocked') };
  });
  const tasksTotal = byStage.reduce((a, s) => a + s.open + s.done, 0);
  const tasksDone = byStage.reduce((a, s) => a + s.done, 0);
  const blocked = byStage.reduce((a, s) => a + s.blocked, 0);
  const requiredOpen = all<{ n: number }>("SELECT COUNT(*) AS n FROM tasks WHERE event_id = ? AND required = 1 AND status IN ('open','in_progress','blocked')", ev.id)[0].n;

  let computed: WorkStage;
  const firstOpen = byStage.find((s) => s.open > 0);
  if (ev.lifecycle === 'completed' || ev.lifecycle === 'closed') computed = 'closing';
  else if (firstOpen) computed = firstOpen.stage;
  else if (VENUE_RULES[ev.venue].track === 'direct' && ev.salesStatus !== 'signed') computed = ev.salesStatus === 'lead' ? 'inquiry' : 'menu_quote';
  else computed = 'readiness';
  const manual = ev.workStage ?? null;

  const hasTime = !!(ev.startTime || ev.deliveryTime);
  const startAt = eventStartISO(ev);
  return {
    stage: manual ?? computed,
    stageAuto: !manual,
    tasksDone,
    tasksTotal,
    taskPct: tasksTotal ? Math.round((tasksDone / tasksTotal) * 100) : 0,
    blocked,
    requiredOpen,
    startAt: hasTime ? startAt : null,
    checkpointAt: hasTime ? addHours(startAt, -(ev.checkpointMinutes ?? getSettings().checkpointMinutes) / 60) : null,
    byStage,
  };
}
