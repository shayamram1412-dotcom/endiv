import { Link, Navigate, useNavigate } from 'react-router-dom';
import { isStaffOnly, navFor } from '@shared/navigation.ts';
import { useQuery } from '@tanstack/react-query';
import { Plus, Inbox, CalendarClock, MessageSquareWarning } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../../lib/api.ts';
import { useAuth, canHallIntake } from '../../lib/auth.tsx';
import { Card, EmptyState, ErrorState, Loading, PageHeader } from '../../ui/layout.tsx';
import { LinkButton } from '../../ui/Button.tsx';
import { Badge } from '../../ui/Badge.tsx';
import { EventCard } from '../events/shared.tsx';
import { TaskRows } from '../tasks/TaskList.tsx';
import { formatDay, formatLongDay, today, formatTs } from '@shared/dates.ts';
import { formatMoney } from '@shared/money.ts';
import { MEETING_KIND } from '@shared/domain.ts';
import type { EventListItem, EventProgress, TaskRecord } from '@shared/types.ts';
import { StageStrip, Checkpoint } from '../process/ProcessPages.tsx';
import { WORK_STAGES } from '@shared/domain.ts';

interface Kpi { value: number; ids: number[]; kind: 'events' | 'tasks' | 'money' | 'items'; money?: number }
interface Dashboard {
  myTasks: TaskRecord[];
  myEvents: EventListItem[];
  kpis: Record<string, Kpi>;
  kitchenLoad: { date: string; portions: number; events: number; guests: number }[];
  openReports: { id: number; eventId: number; content: string; urgent: number; at: string; title: string; ackedAt: string | null; target: string }[];
  meetings: { id: number; kind: 'tour' | 'tasting' | 'call'; date: string; time: string; eventId: number | null; title: string | null; clientName: string | null; managerName: string | null }[];
  supervisor: boolean;
  eventsTitle: 'mine' | 'upcoming';
  checkpoint: null | { event: EventListItem; progress: EventProgress; blockers: TaskRecord[] };
}

const KPI_DEF: Record<string, { label: string; hint: string; tone?: 'danger' | 'warn' }> = {
  upcoming: { label: 'אירועים ב-7 הימים הקרובים', hint: 'סגורים מסחרית' },
  notReady: { label: 'אירועים קרובים שאינם מוכנים', hint: 'חסר פריט בצ׳קליסט', tone: 'warn' },
  shortages: { label: 'אירועים עם חוסר במלאי', hint: '30 הימים הקרובים', tone: 'danger' },
  menuPending: { label: 'תפריט לא סגור / שינוי פתוח', hint: '30 הימים הקרובים', tone: 'warn' },
  overdue: { label: 'משימות באיחור', hint: 'בתחום שלך', tone: 'danger' },
  blocked: { label: 'דורשות פתרון', hint: 'משימות שסומנו חסומות', tone: 'danger' },
  escalated: { label: 'הסלמות', hint: 'באיחור או ללא מטפל', tone: 'danger' },
  unclaimed: { label: 'משימות שטרם נלקחו', hint: 'יעד בשבוע הקרוב' },
  receivables: { label: 'יתרות לגבייה', hint: 'אירועים עם יתרה' },
  overduePayments: { label: 'תשלומים באיחור', hint: 'עבר מועד', tone: 'danger' },
  openLeads: { label: 'פניות פתוחות', hint: 'טרם נסגרו' },
  newLeads: { label: 'פניות חדשות השבוע', hint: '7 ימים אחרונים' },
};

export function DashboardPage() {
  const { me } = useAuth();
  // Complementary staff start at today's field screen.
  if (isStaffOnly(me.grants)) return <Navigate to="/field" replace />;
  return <DashboardInner />;
}

function DashboardInner() {
  const { me } = useAuth();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Dashboard>('/dashboard'), refetchInterval: 120_000 });
  const auth = useAuth();

  const drill = (key: string, k: Kpi) => {
    if (!k.ids.length) return;
    if (k.kind === 'tasks') nav(`/tasks?view=ids&ids=${k.ids.join(',')}&label=${encodeURIComponent(KPI_DEF[key]?.label ?? '')}`);
    else if (k.kind === 'money') nav(`/finance?ids=${k.ids.join(',')}`);
    else nav(`/events?ids=${k.ids.join(',')}&label=${encodeURIComponent(KPI_DEF[key]?.label ?? '')}`);
  };


  const renderSections = (data: Dashboard) => {
    const q = { data };
    const myWork = (
          <div className="grid gap-5 xl:grid-cols-[1.25fr_1fr]">
            <Card title={`המשימות שלי והתורים שלי (${q.data.myTasks.length})`} actions={<Link to="/tasks" className="text-sm font-semibold text-[var(--color-brand)]">לכל המשימות</Link>} bodyClass="px-4 py-1">
              {q.data.myTasks.length ? <TaskRows tasks={q.data.myTasks.slice(0, 8)} compact /> : <EmptyState title="אין משימות פתוחות" text="כל המשימות שלך טופלו." />}
            </Card>
            <Card title={q.data.eventsTitle === 'mine' ? 'האירועים שבאחריותי' : 'אירועים קרובים (14 יום)'} actions={<Link to={q.data.eventsTitle === 'mine' ? '/events?mine=1' : '/events?range=week'} className="text-sm font-semibold text-[var(--color-brand)]">לרשימה</Link>}>
              {q.data.myEvents.length ? (
                <div className="grid gap-2.5">{q.data.myEvents.slice(0, 5).map((e) => <EventCard key={e.id} e={e} />)}</div>
              ) : <EmptyState title="אין אירועים קרובים" />}
            </Card>
          </div>
    );
    const kpiSection = (
          <section aria-label="מדדים">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {Object.entries(q.data.kpis).map(([key, k]) => {
                const def = KPI_DEF[key] ?? { label: key, hint: '' };
                const alert = def.tone && k.value > 0;
                return (
                  <button key={key} onClick={() => drill(key, k)} disabled={!k.ids.length}
                    className={clsx('card p-3.5 text-start transition-colors enabled:hover:border-[var(--color-brand)] disabled:cursor-default',
                      alert && def.tone === 'danger' && 'border-[var(--color-danger)]', alert && def.tone === 'warn' && 'border-[var(--color-warn)]')}
                    aria-label={`${def.label}: ${k.value}. ${k.ids.length ? 'לחיצה להצגת הפירוט' : ''}`}>
                    <div className={clsx('num text-2xl font-extrabold', alert && def.tone === 'danger' && 'text-[var(--color-danger)]', alert && def.tone === 'warn' && 'text-[var(--color-warn)]')}>
                      {k.kind === 'money' && k.money !== undefined ? formatMoney(k.money) : k.value}
                    </div>
                    <div className="mt-0.5 text-[13px] font-semibold leading-tight">{def.label}</div>
                    <div className="text-xs text-[var(--color-muted)]">{k.kind === 'money' ? `${k.value} אירועים` : def.hint}</div>
                  </button>
                );
              })}
            </div>
          </section>
    );
    return { myWork, kpiSection };
  };

  const sections = q.data ? renderSections(q.data) : null;
  const myWork = sections?.myWork;
  const kpiSection = sections?.kpiSection;

  return (
    <div>
      <PageHeader title={`שלום, ${me.name.split(' ')[0]}`} subtitle={formatLongDay(today())}
        actions={<>
          {navFor(auth.me.grants).has('sales') && auth.can('sales', 2) && <LinkButton to="/events/new" variant="primary" icon={<Plus className="size-4" />}>פנייה חדשה</LinkButton>}
          {navFor(auth.me.grants).has('intake') && canHallIntake(auth) && <LinkButton to="/intake" icon={<Inbox className="size-4" />}>קליטה מאולם</LinkButton>}
        </>} />
      {q.isLoading ? <Loading rows={6} /> : q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : q.data && (
        <div className="space-y-5">
          {q.data.checkpoint && <CheckpointHero c={q.data.checkpoint} />}
          {q.data.supervisor ? <>{kpiSection}{myWork}</> : <>{myWork}{kpiSection}</>}
          <div className="grid gap-5 lg:grid-cols-3">
            {q.data.kitchenLoad.length > 0 && (
              <Card title="עומס מטבח – 7 ימים" actions={<Link to="/kitchen" className="text-sm font-semibold text-[var(--color-brand)]">לתכנון השבועי</Link>}>
                <KitchenLoadChart data={q.data.kitchenLoad} />
              </Card>
            )}
            {q.data.openReports.length > 0 && (
              <Card title={<span className="flex items-center gap-2"><MessageSquareWarning className="size-4 text-[var(--color-danger)]" />דיווחים פתוחים מהשטח</span>}>
                <ul className="space-y-2.5">
                  {q.data.openReports.map((r) => (
                    <li key={r.id}>
                      <Link to={`/events/${r.eventId}/field`} className="block rounded-lg p-2 hover:bg-[var(--color-surface-2)]">
                        <div className="flex items-center gap-2 text-sm font-semibold">
                          {r.urgent ? <Badge tone="danger">דחוף</Badge> : null}
                          {!r.ackedAt && <Badge tone="warn">טרם אושרה קבלה</Badge>}
                          <span className="truncate">{r.title}</span>
                        </div>
                        <p className="line-clamp-2 text-sm text-[var(--color-ink-2)]">{r.content}</p>
                        <div className="text-xs text-[var(--color-muted)]">{formatTs(r.at)}</div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {q.data.meetings.length > 0 && (
              <Card title={<span className="flex items-center gap-2"><CalendarClock className="size-4" />סיורים, טעימות ושיחות השבוע</span>}>
                <ul className="divide-y divide-[var(--color-border)]">
                  {q.data.meetings.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{MEETING_KIND[m.kind]}: {m.title ?? m.clientName}</div>
                        <div className="text-xs text-[var(--color-muted)]">{m.managerName ? `מנהל: ${m.managerName}` : 'לא הוגדר מנהל'}</div>
                      </div>
                      {m.eventId ? <Link to={`/events/${m.eventId}`} className="shrink-0 text-xs font-semibold text-[var(--color-brand)]">{formatDay(m.date)} {m.time}</Link> : <span className="shrink-0 text-xs">{formatDay(m.date)} {m.time}</span>}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function KitchenLoadChart({ data }: { data: Dashboard['kitchenLoad'] }) {
  const max = Math.max(1, ...data.map((d) => d.portions));
  return (
    <ul className="space-y-2" aria-label="מנות מתוכננות לפי יום">
      {data.map((d) => (
        <li key={d.date}>
          <Link to={`/kitchen/prep?date=${d.date}`} className="grid grid-cols-[92px_1fr_150px] items-center gap-2 whitespace-nowrap rounded-md text-sm hover:bg-[var(--color-surface-2)]">
            <span className="font-semibold">{formatDay(d.date)}</span>
            <span className="h-5 overflow-hidden rounded bg-[var(--color-surface-2)]">
              <span className="block h-full rounded bg-[var(--color-brand)]" style={{ width: `${(d.portions / max) * 100}%` }} />
            </span>
            <span className="text-end text-xs text-[var(--color-ink-2)]"><span className="num">{d.portions.toLocaleString('he-IL')}</span> מנות · {d.events === 1 ? 'אירוע אחד' : `${d.events} אירועים`}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The next committed event against the one control point that matters: everything closed one hour before. */
function CheckpointHero({ c }: { c: NonNullable<Dashboard['checkpoint']> }) {
  const p = c.progress;
  return (
    <section aria-label="האירוע הקרוב ונקודת הבקרה" className="overflow-hidden rounded-[var(--radius-card)] bg-[var(--color-brand-strong)] text-white shadow-[var(--shadow-card)] dark:bg-[var(--color-brand-soft)] dark:text-[var(--color-ink)]">
      <div className="grid gap-4 p-5 lg:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <div className="mb-1 text-xs font-semibold opacity-80">האירוע הבא בלוח</div>
          <h2 className="text-2xl font-extrabold">{c.event.title}</h2>
          <p className="text-sm opacity-90">{formatDay(c.event.date)}{c.event.startTime ? ` · ${c.event.startTime}` : ''} · {c.event.guests} אורחים</p>
          <div className="mt-2 inline-flex rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-bold">שלב {WORK_STAGES[p.stage].n}/8 · {WORK_STAGES[p.stage].label}</div>
          <div className="mt-2 rounded-lg bg-white/10 px-2 py-1.5"><Checkpoint progress={p} compact /></div>
        </div>
        <div className="flex items-center gap-4 lg:flex-col lg:items-end">
          <div className="text-end"><div className="num text-4xl font-black">{p.taskPct}%</div><div className="text-xs opacity-80">השלמת משימות</div></div>
          <Link to={`/events/${c.event.id}/tasks`} className="rounded-[10px] bg-white px-3 py-2 text-sm font-bold text-[var(--color-brand-strong)]">פתיחת תיק האירוע ←</Link>
        </div>
      </div>
      <div className="bg-[var(--color-surface)] p-3 text-[var(--color-ink)]"><StageStrip progress={p} /></div>
      {c.blockers.length > 0 && (
        <ul className="divide-y divide-[var(--color-border)] bg-[var(--color-surface)] px-4 pb-2 text-sm text-[var(--color-ink)]">
          {c.blockers.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2 py-2">
              {t.status === 'blocked' ? <Badge tone="danger">חסום</Badge> : <Badge tone={t.overdue ? 'danger' : 'warn'}>{t.overdue ? 'באיחור' : 'פתוח'}</Badge>}
              <span className="font-semibold">{t.title}</span>
              <span className="text-[var(--color-muted)]">{t.status === 'blocked' ? t.blockedReason : t.assigneeName ?? 'טרם נלקחה'}</span>
              {t.dueAt && <span className="ms-auto text-xs text-[var(--color-muted)]">יעד {formatTs(t.dueAt)}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
