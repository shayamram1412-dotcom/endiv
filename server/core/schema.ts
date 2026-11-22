/**
 * Database schema. Migrations are applied in order and recorded in `migrations`.
 * Conventions: money in agorot (INTEGER), dates 'YYYY-MM-DD', times 'HH:MM', timestamps ISO.
 * Every mutable business row carries `version` for optimistic concurrency.
 */
export const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: '0001_core',
    sql: `
CREATE TABLE venues (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE user_roles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  venue TEXT REFERENCES venues(code),
  UNIQUE(user_id, role, venue)
);

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by INTEGER,
  updated_at TEXT NOT NULL
);

CREATE TABLE clients (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'private',
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  phone_digits TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  owner_id INTEGER REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX clients_phone ON clients(phone_digits);

CREATE TABLE contacts (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  is_end_client INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id),
  venue TEXT NOT NULL REFERENCES venues(code),
  title TEXT NOT NULL,
  event_type TEXT NOT NULL,
  service_kind TEXT NOT NULL DEFAULT 'full',
  date TEXT NOT NULL,
  date_flexible INTEGER NOT NULL DEFAULT 0,
  start_time TEXT NOT NULL DEFAULT '',
  end_time TEXT NOT NULL DEFAULT '',
  delivery_time TEXT NOT NULL DEFAULT '',
  guests INTEGER NOT NULL DEFAULT 0,
  kids INTEGER NOT NULL DEFAULT 0,
  vegetarian INTEGER NOT NULL DEFAULT 0,
  vegan INTEGER NOT NULL DEFAULT 0,
  menu_type TEXT NOT NULL DEFAULT '',
  kosher TEXT NOT NULL DEFAULT 'none',
  address TEXT NOT NULL DEFAULT '',
  site_contact_name TEXT NOT NULL DEFAULT '',
  site_contact_phone TEXT NOT NULL DEFAULT '',
  site_requirements TEXT NOT NULL DEFAULT '',
  special_requests TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  -- sales (direct track)
  sales_status TEXT NOT NULL DEFAULT 'lead',
  source TEXT NOT NULL DEFAULT '',
  campaign TEXT NOT NULL DEFAULT '',
  lost_reason TEXT NOT NULL DEFAULT '',
  contract_signed_at TEXT,
  contract_total INTEGER,
  -- hall intake
  intake_status TEXT,
  hall_received_at TEXT,
  hall_contact_name TEXT NOT NULL DEFAULT '',
  hall_contact_phone TEXT NOT NULL DEFAULT '',
  intake_missing TEXT NOT NULL DEFAULT '',
  payer TEXT NOT NULL DEFAULT '',
  -- menu
  menu_status TEXT NOT NULL DEFAULT 'open',
  menu_version INTEGER NOT NULL DEFAULT 0,
  -- people
  sales_rep_id INTEGER REFERENCES users(id),
  event_manager_id INTEGER REFERENCES users(id),
  kitchen_manager_id INTEGER REFERENCES users(id),
  brand_manager_id INTEGER REFERENCES users(id),
  -- execution
  ubeya_ref TEXT NOT NULL DEFAULT '',
  lifecycle TEXT NOT NULL DEFAULT 'planning',
  closed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX events_date ON events(date, venue);
CREATE INDEX events_client ON events(client_id);

CREATE TABLE activities (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT '',
  next_action TEXT NOT NULL DEFAULT '',
  next_action_at TEXT,
  next_action_done INTEGER NOT NULL DEFAULT 0,
  at TEXT NOT NULL
);
CREATE INDEX activities_client ON activities(client_id, at);

CREATE TABLE meetings (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  time TEXT NOT NULL DEFAULT '',
  manager_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'scheduled',
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX meetings_date ON meetings(date);

CREATE TABLE quotes (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  per_guest INTEGER,
  total INTEGER NOT NULL,
  guests INTEGER NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'sent',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  amount INTEGER NOT NULL,
  due_date TEXT,
  received INTEGER NOT NULL DEFAULT 0,
  received_at TEXT,
  reference TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE documents (
  id INTEGER PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  uploaded_by INTEGER REFERENCES users(id),
  at TEXT NOT NULL
);

-- ---------------------------------------------------------------- catalog
CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  contact TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  categories TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  unit TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  supplier_id INTEGER REFERENCES suppliers(id),
  min_stock REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE dishes (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  allergens TEXT NOT NULL DEFAULT '',
  is_vegetarian INTEGER NOT NULL DEFAULT 0,
  is_vegan INTEGER NOT NULL DEFAULT 0,
  default_per_guest REAL NOT NULL DEFAULT 1,
  yield_portions REAL NOT NULL DEFAULT 10,
  prep_lead_days INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE recipe_lines (
  id INTEGER PRIMARY KEY,
  dish_id INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id),
  qty REAL NOT NULL,
  UNIQUE(dish_id, item_id)
);

-- ---------------------------------------------------------------- menu per event
CREATE TABLE menu_lines (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  dish_id INTEGER NOT NULL REFERENCES dishes(id),
  audience TEXT NOT NULL DEFAULT 'all',
  per_guest REAL NOT NULL DEFAULT 1,
  qty_override INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE(event_id, dish_id, audience)
);

CREATE TABLE dietary (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE menu_versions (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  changes TEXT NOT NULL DEFAULT '[]',
  reason TEXT NOT NULL DEFAULT '',
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT NOT NULL,
  UNIQUE(event_id, version)
);

CREATE TABLE menu_acks (
  id INTEGER PRIMARY KEY,
  menu_version_id INTEGER NOT NULL REFERENCES menu_versions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  acked_at TEXT,
  UNIQUE(menu_version_id, role)
);

-- ---------------------------------------------------------------- kitchen plan
CREATE TABLE prep_plan (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  dish_id INTEGER NOT NULL REFERENCES dishes(id),
  prep_date TEXT NOT NULL,
  portions_override INTEGER,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned',
  done_by INTEGER REFERENCES users(id),
  done_at TEXT,
  UNIQUE(event_id, dish_id)
);

-- ---------------------------------------------------------------- inventory
CREATE TABLE warehouses (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  venue TEXT REFERENCES venues(code)
);

CREATE TABLE stock_movements (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  qty REAL NOT NULL,
  kind TEXT NOT NULL,
  event_id INTEGER REFERENCES events(id),
  po_line_id INTEGER,
  note TEXT NOT NULL DEFAULT '',
  user_id INTEGER REFERENCES users(id),
  at TEXT NOT NULL
);
CREATE INDEX stock_item ON stock_movements(item_id, warehouse_id);

-- Approved demand of an event for an item (from the menu calculation or added manually).
CREATE TABLE requirements (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id),
  qty REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'menu',
  warehouse_id INTEGER REFERENCES warehouses(id),
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT,
  consumed INTEGER NOT NULL DEFAULT 0,
  UNIQUE(event_id, item_id)
);

CREATE TABLE purchase_orders (
  id INTEGER PRIMARY KEY,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  venue TEXT REFERENCES venues(code),
  warehouse_id INTEGER REFERENCES warehouses(id),
  responsible_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'ordered',
  expected_date TEXT NOT NULL,
  expected_time TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE po_lines (
  id INTEGER PRIMARY KEY,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id),
  event_id INTEGER REFERENCES events(id),
  qty REAL NOT NULL,
  received REAL NOT NULL DEFAULT 0,
  gap_note TEXT NOT NULL DEFAULT '',
  gap_resolved INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE receipts (
  id INTEGER PRIMARY KEY,
  po_line_id INTEGER NOT NULL REFERENCES po_lines(id) ON DELETE CASCADE,
  qty REAL NOT NULL,
  received_by INTEGER REFERENCES users(id),
  at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);

-- ---------------------------------------------------------------- equipment & logistics
CREATE TABLE equipment_templates (
  id INTEGER PRIMARY KEY,
  venue TEXT NOT NULL REFERENCES venues(code),
  event_type TEXT NOT NULL DEFAULT '*',
  item_id INTEGER NOT NULL REFERENCES items(id),
  per_guest REAL NOT NULL DEFAULT 0,
  fixed_qty REAL NOT NULL DEFAULT 0
);

CREATE TABLE event_equipment (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  item_id INTEGER REFERENCES items(id),
  label TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'יח׳',
  is_food INTEGER NOT NULL DEFAULT 0,
  planned REAL NOT NULL DEFAULT 0,
  supplier_id INTEGER REFERENCES suppliers(id),
  supplier_confirmed INTEGER NOT NULL DEFAULT 0,
  loaded REAL,
  unloaded REAL,
  returned REAL,
  gap_owner_id INTEGER REFERENCES users(id),
  gap_note TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT ''
);

-- ---------------------------------------------------------------- staffing & field
CREATE TABLE staffing (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 0,
  assigned INTEGER NOT NULL DEFAULT 0,
  arrived INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  UNIQUE(event_id, role)
);

CREATE TABLE confirmations (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  note TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL,
  UNIQUE(event_id, kind)
);

CREATE TABLE field_reports (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  target TEXT NOT NULL,
  content TEXT NOT NULL,
  urgent INTEGER NOT NULL DEFAULT 0,
  reported_by INTEGER NOT NULL REFERENCES users(id),
  at TEXT NOT NULL,
  acked_by INTEGER REFERENCES users(id),
  acked_at TEXT,
  decision TEXT NOT NULL DEFAULT '',
  resolved_by INTEGER REFERENCES users(id),
  resolved_at TEXT
);

-- ---------------------------------------------------------------- tasks & audit
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  dedupe_key TEXT UNIQUE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL,
  venue TEXT REFERENCES venues(code),
  event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  ref_type TEXT,
  ref_id INTEGER,
  assignee_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'open',
  due_at TEXT,
  created_at TEXT NOT NULL,
  claimed_at TEXT,
  completed_at TEXT,
  completed_by INTEGER REFERENCES users(id),
  evidence TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX tasks_queue ON tasks(status, role, venue);
CREATE INDEX tasks_event ON tasks(event_id);

CREATE TABLE task_log (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  event_id INTEGER,
  client_id INTEGER,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  diff TEXT NOT NULL DEFAULT '{}',
  at TEXT NOT NULL
);
CREATE INDEX audit_event ON audit_log(event_id, at);
CREATE INDEX audit_client ON audit_log(client_id, at);
`,
  },
  {
    id: '0002_work_process',
    sql: `
-- Business-editable work template: which tasks every event gets, per stage, role and timing.
CREATE TABLE task_templates (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL,
  role TEXT NOT NULL,
  venue TEXT REFERENCES venues(code),
  event_type TEXT NOT NULL DEFAULT '*',
  service_kind TEXT NOT NULL DEFAULT '*',
  -- Hours relative to the event start (negative = before). Due = start + offset.
  offset_hours REAL NOT NULL DEFAULT -24,
  required INTEGER NOT NULL DEFAULT 1,
  done_when TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT
);

ALTER TABLE tasks ADD COLUMN stage TEXT NOT NULL DEFAULT 'readiness';
ALTER TABLE tasks ADD COLUMN required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN blocked_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN blocked_at TEXT;
ALTER TABLE tasks ADD COLUMN blocked_by INTEGER REFERENCES users(id);
ALTER TABLE tasks ADD COLUMN template_id INTEGER REFERENCES task_templates(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN done_when TEXT;
CREATE INDEX tasks_stage ON tasks(stage, status);

-- Manual override of the event's current stage (null = computed from open tasks).
ALTER TABLE events ADD COLUMN work_stage TEXT;
`,
  },
  {
    id: '0003_overrides',
    sql: `
-- Per-event overrides of business defaults.
ALTER TABLE events ADD COLUMN checkpoint_minutes INTEGER;
ALTER TABLE events ADD COLUMN readiness_skip TEXT NOT NULL DEFAULT '[]';
-- Per-task escalation override: NULL = settings default, 'never', 'always'.
ALTER TABLE tasks ADD COLUMN escalation TEXT;
`,
  },
  {
    id: '0004_editable_structure',
    sql: `
-- Venue behaviour is data, not code.
ALTER TABLE venues ADD COLUMN track TEXT NOT NULL DEFAULT 'direct';
ALTER TABLE venues ADD COLUMN equipment TEXT NOT NULL DEFAULT 'site';
ALTER TABLE venues ADD COLUMN load_check INTEGER NOT NULL DEFAULT 0;
ALTER TABLE venues ADD COLUMN site_details INTEGER NOT NULL DEFAULT 0;
ALTER TABLE venues ADD COLUMN color TEXT NOT NULL DEFAULT '#6b716c';
ALTER TABLE venues ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
UPDATE venues SET track = 'direct', equipment = 'rental', color = '#7a2948' WHERE code = 'winery';
UPDATE venues SET track = 'hall', equipment = 'none', color = '#1d6fa3' WHERE code = 'eden';
UPDATE venues SET track = 'hall', equipment = 'consumables', load_check = 1, color = '#6b7d1f' WHERE code = 'farm';
UPDATE venues SET track = 'direct', equipment = 'site', site_details = 1, color = '#a15c12' WHERE code = 'offsite';
-- What a template task's timing is measured from.
ALTER TABLE task_templates ADD COLUMN anchor TEXT NOT NULL DEFAULT 'event_start';
`,
  },
  {
    id: '0005_business',
    sql: `
-- Costs: last known price per unit (agorot), price on each purchase line, rental price per equipment line.
ALTER TABLE items ADD COLUMN unit_cost INTEGER NOT NULL DEFAULT 0;
ALTER TABLE items ADD COLUMN owned_qty REAL NOT NULL DEFAULT 0;
ALTER TABLE po_lines ADD COLUMN unit_price INTEGER;
ALTER TABLE event_equipment ADD COLUMN unit_cost INTEGER NOT NULL DEFAULT 0;
-- Other costs entered by hand per event (transport, extra staff, flowers…).
CREATE TABLE event_costs (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  label TEXT NOT NULL,
  amount INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
-- Availability: how many events a venue can take on one day (NULL = no limit).
ALTER TABLE venues ADD COLUMN max_per_day INTEGER;
UPDATE venues SET max_per_day = 1 WHERE code IN ('winery', 'farm');
UPDATE venues SET max_per_day = 2 WHERE code = 'eden';
-- Run of show per event.
CREATE TABLE run_of_show (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  time TEXT NOT NULL,
  title TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX run_of_show_event ON run_of_show(event_id, time);
-- Supplier invoices (payables).
CREATE TABLE supplier_invoices (
  id INTEGER PRIMARY KEY,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  po_id INTEGER REFERENCES purchase_orders(id),
  number TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  amount INTEGER NOT NULL,
  paid INTEGER NOT NULL DEFAULT 0,
  paid_at TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX supplier_invoices_due ON supplier_invoices(status, due_date);
-- Vehicles and transport per event.
CREATE TABLE vehicles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  plate TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE event_transport (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
  driver TEXT NOT NULL DEFAULT '',
  depart_time TEXT NOT NULL DEFAULT '',
  return_time TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT ''
);
`,
  },
  {
    id: '0006_venue_defaults',
    sql: `
-- Per-venue defaults for new events (JSON): times, kosher, event type, manager, hall contact and payer.
ALTER TABLE venues ADD COLUMN defaults TEXT NOT NULL DEFAULT '{}';
UPDATE venues SET defaults = '{"eventType":"wedding","startTime":"19:00","endTime":"23:30","payer":"האולם"}' WHERE code IN ('eden','farm');
UPDATE venues SET defaults = '{"startTime":"19:00","endTime":"23:00"}' WHERE code = 'winery';
`,
  },
];
