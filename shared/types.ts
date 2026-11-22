/** API data shapes shared by server and web (camelCase). */
import type {
  ActivityKind, Audience, ClientKind, ConfirmationKind, DietaryKind, DocKind, EventType, IntakeStatus, ItemKind,
  Kosher, Lifecycle, MeetingKind, MenuStatus, MovementKind, PaymentKind, PoStatus, ReportKind, ReportTarget,
  SalesStatus, ServiceKind, StaffRole, VenueCode, WorkStage, DoneWhen,
} from './domain.ts';
import type { Role, RoleGrant } from './permissions.ts';
import type { Readiness } from './readiness.ts';
import type { CollectionSummary } from './finance.ts';
import type { TaskStatus, TaskType } from './tasks.ts';
import type { MenuChange } from './menuDiff.ts';
import type { Allocation } from './inventory.ts';

export interface UserRef { id: number; name: string }

export interface Me {
  id: number;
  name: string;
  email: string;
  grants: RoleGrant[];
}

export interface EventRecord {
  id: number;
  clientId: number | null;
  venue: VenueCode;
  title: string;
  eventType: EventType;
  serviceKind: ServiceKind;
  date: string;
  dateFlexible: number;
  startTime: string;
  endTime: string;
  deliveryTime: string;
  guests: number;
  kids: number;
  vegetarian: number;
  vegan: number;
  menuType: string;
  kosher: Kosher;
  address: string;
  siteContactName: string;
  siteContactPhone: string;
  siteRequirements: string;
  specialRequests: string;
  notes: string;
  salesStatus: SalesStatus;
  source: string;
  campaign: string;
  lostReason: string;
  contractSignedAt: string | null;
  /** Hidden (null) without finance view permission. */
  contractTotal: number | null;
  intakeStatus: IntakeStatus | null;
  hallReceivedAt: string | null;
  hallContactName: string;
  hallContactPhone: string;
  intakeMissing: string;
  payer: string;
  menuStatus: MenuStatus;
  menuVersion: number;
  salesRepId: number | null;
  eventManagerId: number | null;
  kitchenManagerId: number | null;
  brandManagerId: number | null;
  ubeyaRef: string;
  lifecycle: Lifecycle;
  closedAt: string | null;
  workStage: WorkStage | null;
  /** Override of the settings checkpoint (minutes before start); null = default. */
  checkpointMinutes: number | null;
  /** JSON array of readiness item keys marked not relevant for this event. */
  readinessSkip: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface EventListItem {
  id: number;
  title: string;
  venue: VenueCode;
  eventType: EventType;
  serviceKind: ServiceKind;
  date: string;
  startTime: string;
  guests: number;
  clientId: number | null;
  clientName: string | null;
  clientPhone: string | null;
  salesStatus: SalesStatus;
  intakeStatus: IntakeStatus | null;
  menuStatus: MenuStatus;
  lifecycle: Lifecycle;
  eventManagerId: number | null;
  eventManagerName: string | null;
  readinessPct: number;
  readinessLabel: string;
  openTasks: number;
  shortItems: number;
  paymentStatus?: string;
  balance?: number;
  stage: WorkStage;
  taskPct: number;
  blockedTasks: number;
}

export interface EventDetail {
  event: EventRecord;
  client: ClientRecord | null;
  readiness: Readiness;
  collection: CollectionSummary | null;
  people: Record<'salesRep' | 'eventManager' | 'kitchenManager' | 'brandManager', UserRef | null>;
  counts: { openTasks: number; openReports: number; documents: number };
  /** module → level for this event's venue, so the UI shows only allowed tabs. */
  access: Record<string, number>;
  progress: EventProgress;
}

export interface EventProgress {
  stage: WorkStage;
  /** true when the stage was computed from open tasks (not set by hand). */
  stageAuto: boolean;
  tasksDone: number;
  tasksTotal: number;
  taskPct: number;
  blocked: number;
  requiredOpen: number;
  /** Start of the event minus the checkpoint minutes (ISO), null when no start time. */
  checkpointAt: string | null;
  startAt: string | null;
  byStage: { stage: WorkStage; open: number; done: number; blocked: number }[];
}

export interface ClientRecord {
  id: number;
  kind: ClientKind;
  name: string;
  phone: string;
  email: string;
  company: string;
  notes: string;
  source: string;
  ownerId: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContactRecord {
  id: number;
  clientId: number;
  name: string;
  role: string;
  phone: string;
  email: string;
  isEndClient: number;
}

export interface ActivityRecord {
  id: number;
  clientId: number;
  eventId: number | null;
  eventTitle?: string | null;
  userId: number;
  userName: string;
  kind: ActivityKind;
  content: string;
  outcome: string;
  nextAction: string;
  nextActionAt: string | null;
  nextActionDone: number;
  at: string;
}

export interface MeetingRecord {
  id: number;
  kind: MeetingKind;
  eventId: number | null;
  eventTitle?: string | null;
  clientId: number | null;
  clientName?: string | null;
  date: string;
  time: string;
  managerId: number | null;
  managerName?: string | null;
  status: 'scheduled' | 'done' | 'cancelled';
  notes: string;
}

export interface QuoteRecord {
  id: number;
  eventId: number;
  version: number;
  perGuest: number | null;
  total: number;
  guests: number;
  description: string;
  status: 'sent' | 'accepted' | 'rejected' | 'superseded';
  createdByName: string;
  createdAt: string;
}

export interface PaymentRecord {
  id: number;
  eventId: number;
  kind: PaymentKind;
  amount: number;
  dueDate: string | null;
  received: number;
  receivedAt: string | null;
  reference: string;
  notes: string;
  version: number;
}

export interface DocumentRecord {
  id: number;
  clientId: number | null;
  eventId: number | null;
  eventTitle?: string | null;
  kind: DocKind;
  name: string;
  mime: string;
  size: number;
  uploadedByName: string;
  at: string;
}

export interface DishRecord {
  id: number;
  name: string;
  category: string;
  description: string;
  allergens: string;
  isVegetarian: number;
  isVegan: number;
  defaultPerGuest: number;
  yieldPortions: number;
  prepLeadDays: number;
  active: number;
  version: number;
  recipe?: { itemId: number; itemName: string; unit: string; qty: number }[];
}

export interface ItemRecord {
  id: number;
  name: string;
  kind: ItemKind;
  unit: string;
  category: string;
  supplierId: number | null;
  supplierName?: string | null;
  minStock: number;
  /** Price per unit in agorot (last purchase price unless set by hand). */
  unitCost: number;
  /** Owned equipment on hand (for overlap checks). */
  ownedQty: number;
  active: number;
}

export interface SupplierRecord {
  id: number;
  name: string;
  contact: string;
  phone: string;
  email: string;
  categories: string;
  notes: string;
  active: number;
}

export interface MenuLineRecord {
  id: number;
  dishId: number;
  dishName: string;
  category: string;
  allergens: string;
  audience: Audience;
  perGuest: number;
  qtyOverride: number | null;
  notes: string;
  sort: number;
  portions: number;
}

export interface DietaryRecord {
  id: number;
  kind: DietaryKind;
  count: number;
  description: string;
}

export interface MenuVersionRecord {
  id: number;
  version: number;
  changes: MenuChange[];
  reason: string;
  approvedByName: string;
  approvedAt: string;
  acks: { role: Role; userName: string | null; ackedAt: string | null }[];
}

export interface MenuView {
  lines: MenuLineRecord[];
  dietary: DietaryRecord[];
  versions: MenuVersionRecord[];
  status: MenuStatus;
  version: number;
  eventVersion: number;
}

export interface RawNeedRecord {
  itemId: number;
  itemName: string;
  unit: string;
  kind: ItemKind;
  computed: number;
  required: number | null;
  approvedAt: string | null;
  source: 'menu' | 'manual' | null;
  warehouseId: number | null;
  allocation: Allocation | null;
  eventShort: number;
}

export interface KitchenView {
  lines: (MenuLineRecord & { prepDate: string | null; portionsOverride: number | null; reason: string; prepStatus: string })[];
  raw: RawNeedRecord[];
  missingRecipes: { dishId: number; dishName: string }[];
}

export interface StockRow {
  itemId: number;
  itemName: string;
  unit: string;
  kind: ItemKind;
  category: string;
  warehouseId: number;
  warehouseName: string;
  balance: number;
  reserved: number;
  incoming: number;
  available: number;
  minStock: number;
}

export interface MovementRecord {
  id: number;
  itemId: number;
  itemName: string;
  unit: string;
  warehouseName: string;
  qty: number;
  kind: MovementKind;
  eventId: number | null;
  eventTitle: string | null;
  note: string;
  userName: string | null;
  at: string;
}

export interface PoLineRecord {
  id: number;
  itemId: number;
  itemName: string;
  unit: string;
  eventId: number | null;
  eventTitle: string | null;
  qty: number;
  received: number;
  unitPrice: number | null;
  gap: number;
  gapNote: string;
  gapResolved: number;
}

export interface PurchaseOrderRecord {
  id: number;
  supplierId: number;
  supplierName: string;
  venue: VenueCode | null;
  warehouseId: number | null;
  warehouseName: string | null;
  responsibleId: number | null;
  responsibleName: string | null;
  status: PoStatus;
  expectedDate: string;
  expectedTime: string;
  notes: string;
  createdAt: string;
  version: number;
  lines: PoLineRecord[];
}

export interface EquipmentLine {
  id: number;
  itemId: number | null;
  label: string;
  unit: string;
  isFood: number;
  planned: number;
  supplierId: number | null;
  supplierName: string | null;
  supplierConfirmed: number;
  loaded: number | null;
  unloaded: number | null;
  returned: number | null;
  gapOwnerId: number | null;
  gapOwnerName: string | null;
  gapNote: string;
  notes: string;
  /** Rental price per unit (agorot). */
  unitCost: number;
}

export interface StaffingLine {
  id: number;
  role: StaffRole;
  required: number;
  assigned: number;
  arrived: number | null;
  notes: string;
}

export interface ConfirmationRecord {
  kind: ConfirmationKind;
  userName: string;
  note: string;
  at: string;
}

export interface FieldReport {
  id: number;
  eventId: number;
  eventTitle?: string;
  kind: ReportKind;
  target: ReportTarget;
  content: string;
  urgent: number;
  reportedByName: string;
  at: string;
  ackedByName: string | null;
  ackedAt: string | null;
  decision: string;
  resolvedByName: string | null;
  resolvedAt: string | null;
}

export interface TaskRecord {
  id: number;
  type: TaskType;
  title: string;
  action: string;
  role: Role;
  venue: VenueCode | null;
  eventId: number | null;
  eventTitle: string | null;
  eventDate: string | null;
  clientId: number | null;
  clientName: string | null;
  refType: string | null;
  refId: number | null;
  assigneeId: number | null;
  assigneeName: string | null;
  status: TaskStatus;
  dueAt: string | null;
  createdAt: string;
  claimedAt: string | null;
  completedAt: string | null;
  completedByName: string | null;
  evidence: string;
  version: number;
  overdue: boolean;
  escalated: boolean;
  stage: WorkStage;
  required: number;
  blockedReason: string;
  blockedAt: string | null;
  blockedByName: string | null;
  templateId: number | null;
  escalation: 'never' | 'always' | null;
}

export interface TaskTemplate {
  id: number;
  title: string;
  action: string;
  stage: WorkStage;
  role: Role;
  venue: VenueCode | null;
  eventType: string;
  serviceKind: string;
  offsetHours: number;
  required: number;
  doneWhen: DoneWhen | null;
  anchor: 'event_start' | 'event_end' | 'contract_signed' | 'event_created';
  active: number;
  sort: number;
}

export interface TaskLogRecord {
  id: number;
  userName: string | null;
  action: string;
  note: string;
  at: string;
}

export interface AuditRecord {
  id: number;
  entity: string;
  entityId: number;
  userName: string | null;
  action: string;
  summary: string;
  diff: Record<string, { from: unknown; to: unknown }>;
  at: string;
}

export interface CalendarItem {
  kind: 'event' | 'tour' | 'tasting' | 'call' | 'delivery' | 'followup';
  id: number;
  title: string;
  date: string;
  time: string;
  venue: VenueCode | null;
  eventId: number | null;
  clientId: number | null;
  status?: string;
  guests?: number;
}

export interface ApiErrorBody {
  error: string;
  code: string;
  details?: { fields?: Record<string, string>; conflicts?: { field: string; yours: unknown; theirs: unknown }[]; current?: unknown };
}
