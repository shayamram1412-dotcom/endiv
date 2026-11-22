import { StrictMode, Suspense, lazy, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './lib/api.ts';
import { applyConfig, type SystemConfig, type VenueConfig } from '@shared/config.ts';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import './styles.css';
import { queryClient } from './lib/query.ts';
import { AuthGate, useAuth, canHallIntake } from './lib/auth.tsx';
import { ToastProvider } from './ui/Toast.tsx';
import { Forbidden } from './ui/layout.tsx';
import { AppShell, NotFoundPage } from './layout/AppShell.tsx';
import { LoginPage } from './features/auth/LoginPage.tsx';
import type { Level, Module } from '@shared/permissions.ts';
// Each screen is loaded when first opened, so the first load (login, dashboard) stays small.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const page = <M, K extends keyof M>(load: () => Promise<M>, name: K) => lazy(() => load().then((m) => ({ default: m[name] as ComponentType<any> })));
const DashboardPage = page(() => import('./features/dashboard/DashboardPage.tsx'), 'DashboardPage');
const TasksPage = page(() => import('./features/tasks/TasksPage.tsx'), 'TasksPage');
const CalendarPage = page(() => import('./features/calendar/CalendarPage.tsx'), 'CalendarPage');
const EventsListPage = page(() => import('./features/events/EventsListPage.tsx'), 'EventsListPage');
const NewEventPage = page(() => import('./features/events/NewEventPage.tsx'), 'NewEventPage');
const EventPage = page(() => import('./features/events/EventPage.tsx'), 'EventPage');
const ClientsListPage = page(() => import('./features/clients/ClientsPages.tsx'), 'ClientsListPage');
const ClientPage = page(() => import('./features/clients/ClientsPages.tsx'), 'ClientPage');
const PipelinePage = page(() => import('./features/sales/SalesPages.tsx'), 'PipelinePage');
const ConversionReportPage = page(() => import('./features/sales/SalesPages.tsx'), 'ConversionReportPage');
const KitchenWeekPage = page(() => import('./features/kitchen/KitchenPages.tsx'), 'KitchenWeekPage');
const PrepBoardPage = page(() => import('./features/kitchen/KitchenPages.tsx'), 'PrepBoardPage');
const InventoryPage = page(() => import('./features/inventory/InventoryPage.tsx'), 'InventoryPage');
const OrdersPage = page(() => import('./features/purchasing/PurchasingPages.tsx'), 'OrdersPage');
const OrderPage = page(() => import('./features/purchasing/PurchasingPages.tsx'), 'OrderPage');
const NewOrderPage = page(() => import('./features/purchasing/PurchasingPages.tsx'), 'NewOrderPage');
const CatalogPage = page(() => import('./features/catalog/CatalogPage.tsx'), 'CatalogPage');
const FieldHomePage = page(() => import('./features/field/FieldPages.tsx'), 'FieldHomePage');
const FieldEventPage = page(() => import('./features/field/FieldPages.tsx'), 'FieldEventPage');
const FinancePage = page(() => import('./features/finance/FinancePage.tsx'), 'FinancePage');
const AdminPage = page(() => import('./features/admin/AdminPage.tsx'), 'AdminPage');
const ProcessMapPage = page(() => import('./features/process/ProcessPages.tsx'), 'ProcessMapPage');
const RolesPage = page(() => import('./features/process/ProcessPages.tsx'), 'RolesPage');
const TemplatesPage = page(() => import('./features/process/ProcessPages.tsx'), 'TemplatesPage');
const StaffingPage = page(() => import('./features/staffing/StaffingPage.tsx'), 'StaffingPage');
const EventSheetPrintPage = page(() => import('./features/print/PrintPages.tsx'), 'EventSheetPrintPage');
const OrderPrintPage = page(() => import('./features/print/PrintPages.tsx'), 'OrderPrintPage');
const QuotePrintPage = page(() => import('./features/print/PrintPages.tsx'), 'QuotePrintPage');


/** Route-level permission guard (the server enforces the same rules). */
function Need({ m, l = 1, children }: { m: Module; l?: Level; children: ReactNode }) {
  const auth = useAuth();
  return auth.can(m, l) ? <>{children}</> : <Forbidden />;
}

/** Applies the business's vocabulary & structure (venues, types, stages, words, permissions) before rendering. */
function PageLoading() {
  return <div className="grid min-h-[40vh] place-items-center text-[var(--color-muted)]" role="status">טוען…</div>;
}

function ConfigGate({ children }: { children: ReactNode }) {
  const q = useQuery({ queryKey: ['config'], queryFn: () => api.get<{ system: SystemConfig; venues: VenueConfig[] }>('/admin/config'), staleTime: Infinity });
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!q.data) return;
    applyConfig(q.data.system, q.data.venues);
    setReady(true);
  }, [q.data]);
  if (q.error) return <>{children}</>;
  if (!ready) return <div className="grid min-h-dvh place-items-center text-[var(--color-muted)]" role="status">טוען הגדרות…</div>;
  return <>{children}</>;
}

function Supervisors({ children }: { children: ReactNode }) {
  return useAuth().supervisor ? <>{children}</> : <Forbidden />;
}

function HallIntake() {
  const auth = useAuth();
  return canHallIntake(auth) ? <NewEventPage mode="hall" /> : <Forbidden />;
}

const router = createBrowserRouter([
  { path: '/print/quote/:eventId/:quoteId', element: <Need m="sales"><QuotePrintPage /></Need> },
  { path: '/print/po/:id', element: <Need m="purchasing"><OrderPrintPage /></Need> },
  { path: '/print/event/:id', element: <Need m="events"><EventSheetPrintPage /></Need> },
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <DashboardPage /> },
      { path: '/tasks', element: <TasksPage /> },
      { path: '/calendar', element: <Need m="events"><CalendarPage /></Need> },
      { path: '/events', element: <Need m="events"><EventsListPage /></Need> },
      { path: '/events/new', element: <Need m="sales" l={2}><NewEventPage mode="direct" /></Need> },
      { path: '/intake', element: <HallIntake /> },
      { path: '/events/:id/:tab?', element: <Need m="events"><EventPage /></Need> },
      { path: '/clients', element: <Need m="clients"><ClientsListPage /></Need> },
      { path: '/clients/:id', element: <Need m="clients"><ClientPage /></Need> },
      { path: '/sales', element: <Need m="sales"><PipelinePage /></Need> },
      { path: '/reports', element: <Need m="reports"><ConversionReportPage /></Need> },
      { path: '/kitchen', element: <Need m="kitchen"><KitchenWeekPage /></Need> },
      { path: '/kitchen/prep', element: <Need m="kitchen"><PrepBoardPage /></Need> },
      { path: '/staffing', element: <Need m="staffing"><StaffingPage /></Need> },
      { path: '/inventory', element: <Need m="inventory"><InventoryPage /></Need> },
      { path: '/purchasing', element: <Need m="purchasing"><OrdersPage /></Need> },
      { path: '/purchasing/new', element: <Need m="purchasing" l={2}><NewOrderPage /></Need> },
      { path: '/purchasing/:id', element: <Need m="purchasing"><OrderPage /></Need> },
      { path: '/catalog', element: <Need m="catalog"><CatalogPage /></Need> },
      { path: '/field', element: <Need m="field"><FieldHomePage /></Need> },
      { path: '/field/:id', element: <Need m="field"><FieldEventPage /></Need> },
      { path: '/finance', element: <Need m="finance"><FinancePage /></Need> },
      { path: '/admin', element: <Need m="admin"><AdminPage /></Need> },
      { path: '/process', element: <Supervisors><ProcessMapPage /></Supervisors> },
      { path: '/process/templates', element: <Need m="process"><TemplatesPage /></Need> },
      { path: '/roles', element: <Supervisors><RolesPage /></Supervisors> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthGate login={<LoginPage />}>
          <ConfigGate><Suspense fallback={<PageLoading />}><RouterProvider router={router} /></Suspense></ConfigGate>
        </AuthGate>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
