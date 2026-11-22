import { opsRoutes, scheduleRoutes } from './features/operations/schedule.ts';
import { costsRoutes } from './features/finance/costs.ts';
import { Hono } from 'hono';
import { HttpError, type AppEnv } from './core/http.ts';
import { authMiddleware } from './core/auth.ts';
import { authRoutes, usersRoutes, adminRoutes, streamRoutes } from './features/admin/routes.ts';
import { eventsRoutes } from './features/events/routes.ts';
import { clientsRoutes, meetingsRoutes } from './features/clients/routes.ts';
import { salesRoutes } from './features/sales/routes.ts';
import { menuRoutes } from './features/menu/routes.ts';
import { kitchenRoutes } from './features/kitchen/routes.ts';
import { inventoryRoutes } from './features/inventory/routes.ts';
import { purchasingRoutes } from './features/purchasing/routes.ts';
import { catalogRoutes } from './features/catalog/routes.ts';
import { operationsRoutes, reportsRoutes } from './features/operations/routes.ts';
import { financeRoutes } from './features/finance/routes.ts';
import { documentsRoutes } from './features/documents/routes.ts';
import { tasksRoutes } from './features/tasks/routes.ts';
import { overviewRoutes } from './features/overview/routes.ts';
import { processRoutes } from './features/process/routes.ts';

export function createApp() {
  const app = new Hono<AppEnv>();
  const api = new Hono<AppEnv>();

  api.use('*', authMiddleware);
  api.route('/auth', authRoutes);
  api.route('/users', usersRoutes);
  api.route('/admin', adminRoutes);
  api.route('/stream', streamRoutes);
  api.route('/events', eventsRoutes);
  api.route('/events', menuRoutes);
  api.route('/events', operationsRoutes);
  api.route('/events', scheduleRoutes);
  api.route('/ops', opsRoutes);
  api.route('/clients', clientsRoutes);
  api.route('/meetings', meetingsRoutes);
  api.route('/sales', salesRoutes);
  api.route('/kitchen', kitchenRoutes);
  api.route('/inventory', inventoryRoutes);
  api.route('/purchasing', purchasingRoutes);
  api.route('/catalog', catalogRoutes);
  api.route('/reports', reportsRoutes);
  api.route('/finance', financeRoutes);
  api.route('/finance', costsRoutes);
  api.route('/documents', documentsRoutes);
  api.route('/tasks', tasksRoutes);
  api.route('/process', processRoutes);
  api.route('/', overviewRoutes);
  api.notFound((c) => c.json({ error: 'נתיב לא קיים', code: 'not_found' }, 404));

  app.route('/api', api);

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json({ error: err.message, code: err.code, details: err.details }, err.status as 400);
    }
    console.error(JSON.stringify({ level: 'error', at: new Date().toISOString(), path: c.req.path, method: c.req.method, message: err.message, stack: err.stack }));
    return c.json({ error: 'אירעה שגיאה בשרת. הנתונים שהוזנו לא אבדו – נסה שוב.', code: 'server_error' }, 500);
  });
  return app;
}
