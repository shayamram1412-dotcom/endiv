/**
 * Consistency sweep: every demo user × every screen × every event tab.
 * Catches server errors, permission mismatches between what a screen offers and what the API allows,
 * and numbers that disagree with the lists behind them (e.g. "1 blocked task" but an empty task list).
 */
import { describe, expect, it } from 'vitest';
import { openDb, all } from '../server/core/db.ts';
import { createApp } from '../server/app.ts';
import { seedDemo } from '../server/seed/demo.ts';
import { can, isSupervisor, type Module, type Principal } from '../shared/permissions.ts';
import { seesClientContact } from '../shared/navigation.ts';
import { loadPrincipal } from '../server/core/auth.ts';

const app = (() => { openDb(':memory:'); seedDemo(); return createApp(); })();

async function session(email: string) {
  const r = await app.request('/api/auth/login', { method: 'POST', headers: { 'x-mb': '1', 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'demo1234' }) });
  return (r.headers.get('set-cookie') ?? '').split(';')[0];
}
async function get<T = unknown>(cookie: string, path: string): Promise<{ status: number; data: T }> {
  const r = await app.request(`/api${path}`, { headers: { cookie } });
  const text = await r.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: r.status, data: data as T };
}

const users = all<{ id: number; email: string; name: string }>('SELECT id, email, name FROM users WHERE active = 1');
const MODULE_PAGES: [Module, string][] = [
  ['clients', '/clients'], ['sales', '/sales/pipeline'], ['kitchen', '/kitchen/week'], ['inventory', '/inventory/stock'],
  ['purchasing', '/purchasing/orders'], ['finance', '/finance/receivables'], ['catalog', '/catalog/dishes'], ['admin', '/users'],
  ['process', '/process/templates'], ['reports', '/sales/conversion'], ['staffing', '/ops/staffing'],
];

describe.each(users)('$name', (u) => {
  it('every screen loads with the right permission and no server error', async () => {
    const cookie = await session(u.email);
    const me = loadPrincipal(u.id) as Principal;
    const problems: string[] = [];

    for (const p of ['/dashboard', '/tasks', '/tasks?view=mine', '/calendar', '/search?q=%D7%97%D7%AA', '/admin/config', '/admin/settings', '/reports']) {
      const r = await get(cookie, p);
      if (r.status !== 200) problems.push(`${p} → ${r.status}`);
    }
    // Management-only pages.
    for (const p of ['/process/map', '/process/roles']) {
      const r = await get(cookie, p);
      const expected = isSupervisor(me) ? 200 : 403;
      if (r.status !== expected) problems.push(`${p} → ${r.status}, expected ${expected}`);
    }
    // Client contact only for roles that work with the client.
    const anyEvent = (await get<{ id: number; clientPhone: string | null }[]>(cookie, '/events?from=2000-01-01&to=2100-01-01')).data?.[0];
    if (anyEvent && !seesClientContact(me.grants) && anyEvent.clientPhone) problems.push('client phone visible to a role that should not see it');
    for (const [m, p] of MODULE_PAGES) {
      const r = await get(cookie, p);
      const expected = can(me, m, 1) ? 200 : 403;
      if (r.status !== expected) problems.push(`${p} (${m}) → ${r.status}, expected ${expected}`);
    }

    if (can(me, 'events', 1)) {
      const list = await get<{ id: number; readinessPct: number; blockedTasks: number }[]>(cookie, '/events?from=2000-01-01&to=2100-01-01&lifecycle=planning,completed,closed');
      if (list.status !== 200) problems.push(`/events → ${list.status}`);
      for (const item of list.data ?? []) {
        const d = await get<{ access: Record<string, number>; readiness: { pct: number }; progress: { tasksTotal: number; blocked: number } }>(cookie, `/events/${item.id}`);
        if (d.status !== 200) { problems.push(`/events/${item.id} → ${d.status}`); continue; }
        const a = d.data.access;
        if (d.data.readiness.pct !== item.readinessPct) problems.push(`event ${item.id}: list readiness ${item.readinessPct}% ≠ detail ${d.data.readiness.pct}%`);

        // The counters on the page must match the task list the same user sees.
        const tasks = await get<{ status: string }[]>(cookie, `/tasks?event=${item.id}&status=all`);
        const visible = (tasks.data ?? []).filter((t) => t.status !== 'cancelled');
        if (visible.length !== d.data.progress.tasksTotal) problems.push(`event ${item.id}: progress says ${d.data.progress.tasksTotal} tasks, list shows ${visible.length}`);
        const blocked = visible.filter((t) => t.status === 'blocked').length;
        if (blocked !== d.data.progress.blocked) problems.push(`event ${item.id}: ${d.data.progress.blocked} blocked counted, ${blocked} listed`);
        if (item.blockedTasks !== d.data.progress.blocked) problems.push(`event ${item.id}: list blocked ${item.blockedTasks} ≠ detail ${d.data.progress.blocked}`);

        // Each tab the page shows must load; hidden tabs must be refused.
        const tabs: [string, boolean][] = [
          [`/events/${item.id}/menu`, a.menu >= 1],
          [`/kitchen/events/${item.id}`, a.kitchen >= 1],
          [`/events/${item.id}/equipment`, a.equipment >= 1],
          [`/events/${item.id}/staffing`, a.staffing >= 1],
          [`/events/${item.id}/reports`, a.field >= 1],
          [`/events/${item.id}/field`, a.field >= 1],
          [`/finance/events/${item.id}/payments`, a.finance >= 1],
          [`/sales/events/${item.id}/quotes`, a.sales >= 1],
          [`/events/${item.id}/history`, true],
          [`/events/${item.id}/confirmations`, true],
          [`/documents?event=${item.id}`, a.clients >= 1 || a.events >= 2],
        ];
        for (const [path, allowed] of tabs) {
          const r = await get(cookie, path);
          if (allowed && r.status !== 200) problems.push(`${path} → ${r.status} (tab shown)`);
          if (!allowed && r.status === 200) problems.push(`${path} → 200 (tab hidden but data returned)`);
          if (r.status >= 500) problems.push(`${path} → ${r.status}`);
        }
      }
    }

    // Every number on the dashboard must open to something the user can see.
    const dash = await get<{ kpis: Record<string, { ids: number[]; kind: string }>; myTasks: { id: number }[] }>(cookie, '/dashboard');
    for (const [k, kpi] of Object.entries(dash.data?.kpis ?? {})) {
      for (const id of kpi.ids.slice(0, 15)) {
        const path = kpi.kind === 'tasks' ? `/tasks/${id}` : `/events/${id}`;
        const r = await get(cookie, path);
        if (r.status !== 200) problems.push(`dashboard ${k}: ${path} → ${r.status}`);
      }
    }
    for (const t of (dash.data?.myTasks ?? []).slice(0, 15)) {
      const r = await get(cookie, `/tasks/${t.id}`);
      if (r.status !== 200) problems.push(`my task ${t.id} → ${r.status}`);
    }

    expect(problems).toEqual([]);
  }, 60_000);
});
