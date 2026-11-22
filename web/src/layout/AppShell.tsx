import { useEffect, useRef, useState, type ReactNode, Suspense } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, ListChecks, CalendarDays, PartyPopper, Smartphone, Users, TrendingUp, Inbox, ChefHat, MonitorPlay,
  Package, ShoppingCart, BookOpen, Wallet, BarChart3, Settings, Menu, X, Search, LogOut, Moon, Sun, Wifi, WifiOff, Workflow, Users2,
  UserCog,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth, canHallIntake } from '../lib/auth.tsx';
import { useLiveUpdates } from '../lib/query.ts';
import { useSettings } from '../lib/settings.ts';
import { api, qs } from '../lib/api.ts';
import { ROLES } from '@shared/permissions.ts';
import { VENUE_LABEL } from '@shared/domain.ts';
import { formatDay } from '@shared/dates.ts';
import type { Module, Level } from '@shared/permissions.ts';
import { isStaffOnly, navFor, type NavKey } from '@shared/navigation.ts';

interface NavItem { key: NavKey; to: string; label: string; icon: ReactNode; need?: [Module, Level]; end?: boolean; when?: () => boolean }

function useTheme(): [boolean, () => void] {
  const [dark, setDark] = useState(() => {
    try {
      const s = localStorage.getItem('mb-theme');
      return s ? s === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch { return false; }
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('mb-theme', dark ? 'dark' : 'light'); } catch { /* private mode */ }
  }, [dark]);
  return [dark, () => setDark((d) => !d)];
}

export function AppShell() {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [dark, toggleDark] = useTheme();
  const live = useLiveUpdates(true);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);

  const settings = useSettings();
  const myTasks = useQuery({ queryKey: ['tasks', 'count-mine', settings.taskHorizonDays], queryFn: () => api.get<unknown[]>(`/tasks?view=mine&horizon=${settings.taskHorizonDays || 'all'}`), refetchInterval: 60_000 });
  const hallVenue = canHallIntake(auth);

  const groups: { title: string; items: NavItem[] }[] = [
    { title: 'עבודה יומית', items: [
      { key: 'dashboard', to: '/', label: 'דשבורד', icon: <LayoutDashboard />, end: true },
      { key: 'tasks', to: '/tasks', label: 'משימות', icon: <ListChecks /> },
      { key: 'process', to: '/process', label: 'תהליכי עבודה', icon: <Workflow />, end: true },
      { key: 'roles', to: '/roles', label: 'בעלי תפקידים', icon: <Users2 /> },
      { key: 'calendar', to: '/calendar', label: 'לוח שנה', icon: <CalendarDays />, need: ['events', 1] },
      { key: 'field', to: '/field', label: 'ביצוע בשטח', icon: <Smartphone />, need: ['field', 1] },
    ] },
    { title: 'אירועים ולקוחות', items: [
      { key: 'events', to: '/events', label: 'אירועים', icon: <PartyPopper />, need: ['events', 1] },
      { key: 'clients', to: '/clients', label: 'לקוחות', icon: <Users />, need: ['clients', 1] },
      { key: 'sales', to: '/sales', label: 'מכירות ופניות', icon: <TrendingUp />, need: ['sales', 1] },
      { key: 'intake', to: '/intake', label: 'קליטה מאולם', icon: <Inbox />, when: () => hallVenue },
    ] },
    { title: 'מטבח ותפעול', items: [
      { key: 'kitchen', to: '/kitchen', label: 'תכנון מטבח', icon: <ChefHat />, need: ['kitchen', 1], end: true },
      { key: 'prep', to: '/kitchen/prep', label: 'לוח הכנות (מסך מטבח)', icon: <MonitorPlay />, need: ['kitchen', 1] },
      { key: 'staffing', to: '/staffing', label: 'כוח אדם לפי יום', icon: <UserCog />, need: ['staffing', 1] },
      { key: 'inventory', to: '/inventory', label: 'מלאי ומחסנים', icon: <Package />, need: ['inventory', 1] },
      { key: 'purchasing', to: '/purchasing', label: 'רכש וספקים', icon: <ShoppingCart />, need: ['purchasing', 1] },
      { key: 'catalog', to: '/catalog', label: 'קטלוג מנות ופריטים', icon: <BookOpen />, need: ['catalog', 1] },
    ] },
    { title: 'כספים והנהלה', items: [
      { key: 'finance', to: '/finance', label: 'כספים', icon: <Wallet />, need: ['finance', 1] },
      { key: 'reports', to: '/reports', label: 'דוחות המרה', icon: <BarChart3 />, need: ['reports', 1] },
      { key: 'templates', to: '/process/templates', label: 'תבנית העבודה', icon: <Workflow />, need: ['process', 3] },
      { key: 'admin', to: '/admin', label: 'הגדרות והרשאות', icon: <Settings />, need: ['admin', 1] },
    ] },
  ];

  const allowed = navFor(auth.me.grants);
  const visible = groups.map((g) => ({ ...g, items: g.items.filter((i) => allowed.has(i.key) && (!i.need || auth.can(i.need[0], i.need[1])) && (!i.when || i.when())) })).filter((g) => g.items.length);
  const roles = [...new Set(auth.me.grants.map((g) => `${ROLES[g.role]}${g.venue ? ` · ${VENUE_LABEL[g.venue]}` : ''}`))];

  const nav = (
    <nav aria-label="ניווט ראשי" className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-2.5 px-4">
        <div className="grid size-9 place-items-center rounded-xl bg-[var(--color-brand)] text-lg font-black text-[var(--color-on-brand)]" aria-hidden>מ</div>
        <div className="leading-tight">
          <div className="font-extrabold">מטבחון</div>
          <div className="text-[11px] text-[var(--color-muted)]">ניהול קייטרינג ואירועים</div>
        </div>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-3 pb-4 pt-2">
        {visible.map((g) => (
          <div key={g.title}>
            <div className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wide text-[var(--color-muted)]">{g.title}</div>
            <ul className="space-y-0.5">
              {g.items.map((i) => (
                <li key={i.to}>
                  <NavLink to={i.to} end={i.end}
                    className={({ isActive }) => clsx('flex h-10 items-center gap-3 rounded-[10px] px-2.5 text-sm font-semibold transition-colors [&_svg]:size-[18px]',
                      isActive ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]' : 'text-[var(--color-ink-2)] hover:bg-[var(--color-surface-2)]')}>
                    {i.icon}
                    <span className="flex-1">{i.label}</span>
                    {i.to === '/tasks' && (myTasks.data?.length ?? 0) > 0 && (
                      <span className="num rounded-full bg-[var(--color-brand)] px-1.5 text-[11px] text-[var(--color-on-brand)]" aria-label={`${myTasks.data!.length} משימות שלי`}>{myTasks.data!.length}</span>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-[var(--color-border)] p-3">
        <div className="mb-2 px-1">
          <div className="truncate text-sm font-bold">{auth.me.name}</div>
          <div className="truncate text-xs text-[var(--color-muted)]" title={roles.join(', ')}>{roles.join(', ')}</div>
        </div>
        <div className="flex gap-1">
          <button onClick={toggleDark} className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold hover:bg-[var(--color-surface-2)]" aria-label={dark ? 'מצב בהיר' : 'מצב כהה'}>
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}{dark ? 'בהיר' : 'כהה'}
          </button>
          <button onClick={() => void auth.logout()} className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold hover:bg-[var(--color-surface-2)]">
            <LogOut className="size-4" />יציאה
          </button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[256px_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:start-2 focus:z-50 focus:rounded-lg focus:bg-[var(--color-surface)] focus:px-3 focus:py-2">דלג לתוכן</a>
      <aside className="sticky top-0 hidden h-dvh border-e border-[var(--color-border)] bg-[var(--color-surface)] lg:block">{nav}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="תפריט">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 start-0 w-[280px] max-w-[85vw] bg-[var(--color-surface)] shadow-[var(--shadow-pop)]">
            <button onClick={() => setOpen(false)} className="absolute end-2 top-3 grid size-10 place-items-center rounded-lg" aria-label="סגירת תפריט"><X /></button>
            {nav}
          </aside>
        </div>
      )}
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-bg)_88%,transparent)] px-3 backdrop-blur sm:px-5">
          <button onClick={() => setOpen(true)} className="grid size-10 place-items-center rounded-lg hover:bg-[var(--color-surface-2)] lg:hidden" aria-label="פתיחת תפריט" aria-expanded={open}><Menu /></button>
          {!isStaffOnly(auth.me.grants) && <GlobalSearch />}
          <span className={clsx('ms-auto hidden items-center gap-1.5 text-xs font-semibold sm:flex', live === 'live' ? 'text-[var(--color-ok)]' : 'text-[var(--color-warn)]')} role="status">
            {live === 'live' ? <Wifi className="size-4" /> : <WifiOff className="size-4" />}
            {live === 'live' ? 'מתעדכן בזמן אמת' : live === 'connecting' ? 'מתחבר…' : 'לא מחובר'}
          </span>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6 sm:py-6">
          <Suspense fallback={<div className="grid min-h-[40vh] place-items-center text-[var(--color-muted)]" role="status">טוען…</div>}><Outlet /></Suspense>
        </main>
      </div>
    </div>
  );
}

interface SearchResult { events: { id: number; title: string; date: string; venue: keyof typeof VENUE_LABEL; clientName: string | null }[]; clients: { id: number; name: string; phone: string }[] }

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState('');
  const nav = useNavigate();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 200); return () => clearTimeout(t); }, [q]);
  const r = useQuery({ queryKey: ['search', debounced], queryFn: () => api.get<SearchResult>(`/search${qs({ q: debounced })}`), enabled: debounced.length >= 2 });
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const go = (to: string) => { setOpen(false); setQ(''); nav(to); };
  const results = r.data;
  return (
    <div ref={box} className="relative w-full max-w-md">
      <label className="sr-only" htmlFor="gsearch">חיפוש לקוח, טלפון או אירוע</label>
      <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-muted)]" aria-hidden />
      <input id="gsearch" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
        placeholder="חיפוש לקוח, טלפון או אירוע…" autoComplete="off"
        className="input h-10 ps-9" role="combobox" aria-expanded={open && !!results} aria-controls="gsearch-list" />
      {open && debounced.length >= 2 && results && (
        <div id="gsearch-list" className="absolute inset-x-0 top-12 z-50 max-h-[70vh] overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-pop)]">
          {results.events.length === 0 && results.clients.length === 0 && <p className="p-3 text-sm text-[var(--color-muted)]">לא נמצאו תוצאות</p>}
          {results.events.length > 0 && <div className="px-2 pt-1 text-[11px] font-bold text-[var(--color-muted)]">אירועים</div>}
          {results.events.map((e) => (
            <button key={`e${e.id}`} onClick={() => go(`/events/${e.id}`)} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-start text-sm hover:bg-[var(--color-surface-2)]">
              <span className="truncate font-semibold">{e.title}</span>
              <span className="shrink-0 text-xs text-[var(--color-muted)]">{formatDay(e.date)} · {VENUE_LABEL[e.venue]}</span>
            </button>
          ))}
          {results.clients.length > 0 && <div className="px-2 pt-2 text-[11px] font-bold text-[var(--color-muted)]">לקוחות</div>}
          {results.clients.map((c) => (
            <button key={`c${c.id}`} onClick={() => go(`/clients/${c.id}`)} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-start text-sm hover:bg-[var(--color-surface-2)]">
              <span className="truncate font-semibold">{c.name}</span>
              <span className="num shrink-0 text-xs text-[var(--color-muted)]">{c.phone}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="py-20 text-center">
      <h1 className="text-2xl font-bold">העמוד לא נמצא</h1>
      <Link to="/" className="mt-3 inline-block text-[var(--color-brand)] underline">חזרה לדשבורד</Link>
    </div>
  );
}
