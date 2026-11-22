import { Link, useParams } from 'react-router-dom';
import { ArrowRight, Phone, CalendarDays, Clock, Users2, Printer } from 'lucide-react';
import { useEvent, SalesOrIntake } from './shared.tsx';
import { ErrorState, Loading } from '../../ui/layout.tsx';
import { LinkTabs, type TabDef } from '../../ui/Tabs.tsx';
import { Badge, Progress, StatusPill, VenueTag } from '../../ui/Badge.tsx';
import { EVENT_TYPES, VENUE_RULES } from '@shared/domain.ts';
import { formatLongDay, relativeDays, today } from '@shared/dates.ts';
import { OverviewTab } from './tabs/OverviewTab.tsx';
import { SalesTab } from './tabs/SalesTab.tsx';
import { MenuTab } from './tabs/MenuTab.tsx';
import { KitchenTab } from './tabs/KitchenTab.tsx';
import { LogisticsTab } from './tabs/LogisticsTab.tsx';
import { StaffTab } from './tabs/StaffTab.tsx';
import { FieldView } from '../field/FieldPages.tsx';
import { PaymentsTab } from './tabs/PaymentsTab.tsx';
import { DocumentsPanel } from './tabs/DocumentsPanel.tsx';
import { HistoryTab } from './tabs/HistoryTab.tsx';
import { EventProcessTab, StageBadge, Checkpoint } from '../process/ProcessPages.tsx';

export function EventPage() {
  const { id: idParam, tab = 'overview' } = useParams();
  const id = Number(idParam);
  const q = useEvent(id);
  if (q.isLoading) return <Loading rows={8} />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const ev = d.event;
  const a = d.access;
  const rules = VENUE_RULES[ev.venue];
  const base = `/events/${id}`;

  const tabs: (TabDef & { show: boolean })[] = [
    { to: base, label: 'סקירה', end: true, show: true },
    { to: `${base}/sales`, label: 'מכירה', show: rules.track === 'direct' && a.sales >= 1 },
    { to: `${base}/menu`, label: 'תפריט וטעימות', show: a.menu >= 1, badge: ev.menuStatus === 'changed' ? <Badge tone="danger">שינוי</Badge> : undefined },
    { to: `${base}/kitchen`, label: 'מטבח ורכש', show: a.kitchen >= 1 },
    { to: `${base}/logistics`, label: rules.equipment === 'none' ? 'לוגיסטיקה' : 'ציוד ולוגיסטיקה', show: a.equipment >= 1 && rules.equipment !== 'none' },
    { to: `${base}/staff`, label: 'צוות', show: a.staffing >= 1 && ev.serviceKind === 'full' },
    { to: `${base}/field`, label: 'ביצוע ודיווחים', show: a.field >= 1, badge: d.counts.openReports ? <Badge tone="danger">{d.counts.openReports}</Badge> : undefined },
    { to: `${base}/payments`, label: 'תשלומים', show: a.finance >= 1 },
    { to: `${base}/documents`, label: 'מסמכים', show: a.clients >= 1 || a.events >= 2, badge: d.counts.documents ? <Badge>{d.counts.documents}</Badge> : undefined },
    { to: `${base}/tasks`, label: 'משימות ותהליך', show: true, badge: d.progress.blocked ? <Badge tone="danger">{d.progress.blocked} חסומות</Badge> : d.counts.openTasks ? <Badge tone="info">{d.counts.openTasks}</Badge> : undefined },
    { to: `${base}/history`, label: 'היסטוריה', show: true },
  ];

  return (
    <div>
      <Link to="/events" onClick={(e) => { if (window.history.length > 1) { e.preventDefault(); window.history.back(); } }}
        className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-muted)] hover:text-[var(--color-ink)]">
        <ArrowRight className="size-4" />חזרה
      </Link>
      <header className="card mb-5 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
              <VenueTag venue={ev.venue} />
              <span className="text-[var(--color-muted)]">· {EVENT_TYPES[ev.eventType]}{ev.serviceKind === 'platters' ? ' · מגשים/מסירה' : ''} · #{ev.id}</span>
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight">{ev.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--color-ink-2)]">
              <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-4" aria-hidden />{formatLongDay(ev.date)}{ev.date >= today() && <span className="text-[var(--color-muted)]">({relativeDays(ev.date)})</span>}</span>
              {(ev.startTime || ev.deliveryTime) && <span className="inline-flex items-center gap-1.5"><Clock className="size-4" aria-hidden /><span className="num">{ev.serviceKind === 'platters' ? `מסירה ${ev.deliveryTime}` : `${ev.startTime}${ev.endTime ? `–${ev.endTime}` : ''}`}</span></span>}
              <span className="inline-flex items-center gap-1.5"><Users2 className="size-4" aria-hidden /><span className="num">{ev.guests}</span> אורחים{ev.kids ? ` (${ev.kids} ילדים)` : ''}</span>
              {d.client && (
                <span className="inline-flex items-center gap-1.5">
                  {a.clients >= 1 ? <Link to={`/clients/${d.client.id}`} className="font-semibold text-[var(--color-brand)] hover:underline">{d.client.name}</Link> : <span className="font-semibold">{d.client.name}</span>}
                  {d.client.phone && <a href={`tel:${d.client.phone}`} className="num inline-flex items-center gap-1 text-[var(--color-ink-2)] hover:text-[var(--color-brand)]"><Phone className="size-3.5" aria-hidden />{d.client.phone}</a>}
                </span>
              )}
            </div>
          </div>
          <Link to={`/print/event/${ev.id}`} className="no-print inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] border border-[var(--color-border-strong)] px-3 text-sm font-semibold hover:bg-[var(--color-surface-2)]"><Printer className="size-4" aria-hidden />דף אירוע</Link>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--color-border)] pt-3">
          <Link to={`${base}/tasks`} className="flex items-center gap-2 text-sm"><StageBadge stage={d.progress.stage} auto={d.progress.stageAuto} /><span className="text-[var(--color-ink-2)]">{d.progress.taskPct}% מהמשימות הושלמו</span></Link>
          {d.progress.blocked > 0 && <Link to={`${base}/tasks`}><Badge tone="danger">{d.progress.blocked} משימות חסומות דורשות פתרון</Badge></Link>}
          {ev.lifecycle === 'planning' && <Checkpoint progress={d.progress} compact />}
        </div>
        <div className="mt-3 grid gap-3 border-t border-[var(--color-border)] pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <div><div className="mb-1 text-xs font-semibold text-[var(--color-muted)]">{rules.track === 'direct' ? 'מצב מכירה' : 'קליטה מהאולם'}</div><SalesOrIntake e={ev} /></div>
          <div><div className="mb-1 text-xs font-semibold text-[var(--color-muted)]">תפריט</div><StatusPill kind="menu" value={ev.menuStatus} />{ev.menuVersion > 0 && <span className="ms-1 text-xs text-[var(--color-muted)]">גרסה {ev.menuVersion}</span>}</div>
          <div><div className="mb-1 text-xs font-semibold text-[var(--color-muted)]">מוכנות לביצוע</div><Progress pct={d.readiness.pct} label={d.readiness.label} /></div>
          {(d.collection || ev.lifecycle !== 'planning') && (
            <div><div className="mb-1 text-xs font-semibold text-[var(--color-muted)]">{d.collection ? 'גבייה' : 'מצב'}</div>{d.collection && <StatusPill kind="payment" value={d.collection.status} />}{ev.lifecycle !== 'planning' && <span className="ms-1"><StatusPill kind="lifecycle" value={ev.lifecycle} /></span>}</div>
          )}
        </div>
      </header>
      <LinkTabs label="אזורי האירוע" tabs={tabs.filter((t) => t.show)} />
      {tab === 'overview' && <OverviewTab d={d} />}
      {tab === 'sales' && <SalesTab d={d} />}
      {tab === 'menu' && <MenuTab d={d} />}
      {tab === 'kitchen' && <KitchenTab d={d} />}
      {tab === 'logistics' && <LogisticsTab d={d} />}
      {tab === 'staff' && <StaffTab d={d} />}
      {tab === 'field' && <FieldView id={ev.id} embedded />}
      {tab === 'payments' && <PaymentsTab d={d} />}
      {tab === 'documents' && <DocumentsPanel eventId={id} clientId={d.client?.id ?? null} canEdit={a.clients >= 2 || a.events >= 2} />}
      {tab === 'tasks' && <EventProcessTab d={d} />}
      {tab === 'history' && <HistoryTab eventId={id} />}
    </div>
  );
}
