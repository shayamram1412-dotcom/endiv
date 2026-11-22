import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Pencil, Save, DatabaseBackup, Trash2 } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { useAction } from '../../lib/query.ts';
import { useAuth } from '../../lib/auth.tsx';
import { useUrlState } from '../../lib/useUrlState.ts';
import { Card, PageHeader, QueryView } from '../../ui/layout.tsx';
import { Button } from '../../ui/Button.tsx';
import { Badge } from '../../ui/Badge.tsx';
import { Segmented } from '../../ui/Tabs.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import { Checkbox, Field, FormError, Input, MoneyInput, NumberInput, Select, Textarea, optionsOf } from '../../ui/form.tsx';
import { auditActionLabel } from '../../lib/labels.ts';
import { SystemPanel } from './SystemPage.tsx';
import { LEVEL_LABEL, MATRIX, MODULES, ROLES, type Level, type Module, type Role } from '@shared/permissions.ts';
import { EVENT_TYPES, STAFF_ROLES, VENUE_LABEL, type StaffRole, type VenueCode } from '@shared/domain.ts';
import { READINESS_ITEMS } from '@shared/readiness.ts';
import { TASK_TYPES, type TaskType } from '@shared/tasks.ts';
import { formatTs } from '@shared/dates.ts';
import type { BusinessSettings, StaffingStyle } from '@shared/settings.ts';

export function AdminPage() {
  const [s, set] = useUrlState({ tab: 'settings' });
  return (
    <div>
      <PageHeader title="הגדרות והרשאות" subtitle="ברירות המחדל של העסק: זמנים, משימות אוטומטיות, הסלמה, מוכנות, תקן צוות, מטבח, גבייה ורשימות. כל אחת ניתנת לשינוי ידני ברמת האירוע." />
      <div className="mb-4"><Segmented label="אזור" value={s.tab} onChange={(v) => set({ tab: v })} options={[{ value: 'settings', label: 'נהלים וזמנים' }, { value: 'system', label: 'מבנה, מונחים והרשאות' }, { value: 'users', label: 'משתמשים ותפקידים' }, { value: 'audit', label: 'יומן פעולות' }]} /></div>
      {s.tab === 'settings' && <SettingsPanel />}
      {s.tab === 'users' && <UsersPanel />}
      {s.tab === 'system' && <SystemPanel />}
      {s.tab === 'matrix' && <MatrixPanel />}
      {s.tab === 'audit' && <AuditPanel />}
    </div>
  );
}

function SettingsPanel() {
  const auth = useAuth();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api.get<BusinessSettings>('/admin/settings') });
  const [v, setV] = useState<BusinessSettings | null>(null);
  const [lists, setLists] = useState({ leadSources: '', dishCategories: '', units: '' });
  useEffect(() => {
    if (!q.data) return;
    setV(q.data);
    setLists({ leadSources: q.data.lists.leadSources.join('\n'), dishCategories: q.data.lists.dishCategories.join('\n'), units: q.data.lists.units.join('\n') });
  }, [q.data]);
  const toList = (t: string) => [...new Set(t.split('\n').map((x) => x.trim()).filter(Boolean))];
  const save = useAction(() => api.put('/admin/settings', { ...v, lists: { leadSources: toList(lists.leadSources), dishCategories: toList(lists.dishCategories), units: toList(lists.units) } }),
    { success: 'ההגדרות נשמרו והוחלו', invalidate: [['settings'], ['tasks'], ['event'], ['dashboard']] });
  const backup = useAction(() => api.post<{ name: string; counts: Record<string, number> }>('/admin/backup'), { success: (r) => `גיבוי נשמר ואומת (${r.counts.events} אירועים)`, invalidate: [['admin', 'backups']] });
  const canEdit = auth.can('admin', 3);
  if (!v) return <QueryView q={q}>{() => null}</QueryView>;
  const num = (k: keyof BusinessSettings, label: string, hint?: string) => (
    <Field label={label} hint={hint}>{(p) => <NumberInput {...p} disabled={!canEdit} value={v[k] as number} onChange={(x) => setV({ ...v, [k]: x ?? 0 })} />}</Field>
  );
  const autoTypes = (Object.keys(TASK_TYPES) as TaskType[]).filter((t) => t !== 'template' && t !== 'manual');
  const dueFromData: TaskType[] = ['scheduled_call', 'track_deposit', 'verify_delivery', 'readiness_check', 'kitchen_readiness'];
  const styles: [StaffingStyle, string][] = [['formal', 'אירוע מוגש (חתונה, בר מצווה)'], ['reception', 'קבלת פנים / כנס / חברה'], ['platters', 'מגשים / מסירה']];
  return (
    <fieldset disabled={!canEdit} className="space-y-5">
      <p className="rounded-[10px] bg-[var(--color-surface-2)] p-3 text-sm">כל ערך כאן הוא <strong>ברירת מחדל</strong>. בכל אירוע ובכל משימה אפשר לשנות ידנית: להוסיף או להסיר משימות, להזיז מועד, לסמן פריט בצ׳קליסט כלא רלוונטי, לקבוע נקודת בקרה אחרת ולשנות את תקן הצוות.</p>

      <Card title="נקודות זמן">
        <div className="grid gap-4 sm:grid-cols-3">
          {num('checkpointMinutes', 'נקודת בקרה (דקות לפני תחילת האירוע)', 'ניתן לשנות לכל אירוע')}
          {num('readinessDays', 'פתיחת בדיקות מוכנות (ימים לפני)')}
          {num('guestLockDays', 'נעילת מספר אורחים (ימים לפני)', 'שינוי אחריו מסומן כשינוי מאוחר')}
          {num('menuLockDays', 'נעילת תפריט (ימים לפני)')}
          {num('deliveryReminderDays', 'תזכורת אספקה (ימים לפני)', '0 = ביום האספקה')}
        </div>
      </Card>

      <Card title="תורים והסלמה">
        <div className="grid gap-4 sm:grid-cols-3">
          {num('unclaimedEscalationHours', 'הסלמת משימה ללא מטפל אחרי (שעות)')}
          {num('escalationWindowHours', 'הסלמה רק כשהיעד בתוך (שעות)', '0 = בלי קשר למועד היעד')}
          {num('unclaimedWindowDays', '"טרם נלקחו" בדשבורד – יעד בתוך (ימים)', '0 = כל המשימות')}
          {num('taskHorizonDays', 'רשימות משימות מציגות כברירת מחדל (ימים קדימה)', 'באיחור, חסומות וללא מועד תמיד מוצגות. 0 = הכול')}
        </div>
        <p className="mt-2 text-xs text-[var(--color-muted)]">כל משימה יכולה לקבל הגדרת הסלמה משלה ("תמיד" / "לעולם לא") במסך המשימה.</p>
      </Card>

      <Card title="משימות אוטומטיות" bodyClass="p-0">
        <p className="px-4 pt-3 text-sm text-[var(--color-muted)]">משימות שהמערכת פותחת לבד לפי מה שקורה בתהליך. אפשר לכבות סוג משימה, לנתב אותו לתפקיד אחר ולקבוע זמן יעד. משימות התהליך הקבועות מוגדרות ב<a href="/process/templates" className="font-semibold text-[var(--color-brand)] underline">תבנית העבודה</a>.</p>
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>פעילה</th><th>משימה</th><th>מתי נפתחת</th><th>תפקיד</th><th>יעד (שעות מהטריגר)</th></tr></thead>
            <tbody>
              {autoTypes.map((t) => {
                const cfg = v.autoTasks[t] ?? { enabled: true };
                const setCfg = (p: Partial<{ enabled: boolean; role: Role | null }>) => setV({ ...v, autoTasks: { ...v.autoTasks, [t]: { ...cfg, ...p } } });
                return (
                  <tr key={t} className={cfg.enabled === false ? 'opacity-50' : ''}>
                    <td><input type="checkbox" aria-label={`הפעלת ${TASK_TYPES[t].label}`} className="size-4 accent-[var(--color-brand)]" checked={cfg.enabled !== false} onChange={(e) => setCfg({ enabled: e.target.checked })} /></td>
                    <td className="font-semibold">{TASK_TYPES[t].label}</td>
                    <td className="text-sm text-[var(--color-ink-2)]">{TASK_TYPES[t].trigger}</td>
                    <td><Select aria-label="תפקיד" value={cfg.role ?? ''} onChange={(e) => setCfg({ role: (e.target.value || null) as Role | null })} placeholder={`ברירת מחדל: ${ROLES[TASK_TYPES[t].role]}`} options={optionsOf(ROLES).filter((o) => o.value !== 'owner')} className="w-52" /></td>
                    <td>{dueFromData.includes(t)
                      ? <span className="text-xs text-[var(--color-muted)]">לפי הנתון (מועד מקדמה / אספקה / נקודת בקרה)</span>
                      : <input aria-label="שעות" type="number" min={0} className="input num w-24" value={v.taskDueHours[t] ?? ''} onChange={(e) => setV({ ...v, taskDueHours: { ...v.taskDueHours, [t]: Number(e.target.value) } })} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="צ׳קליסט מוכנות">
        <p className="mb-3 text-sm text-[var(--color-muted)]">אילו בדיקות נספרות במוכנות. בכל אירוע אפשר בנוסף לסמן בדיקה כ"לא רלוונטית".</p>
        <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(READINESS_ITEMS).map(([k, label]) => (
            <Checkbox key={k} label={label} checked={v.readinessItems[k] !== false} onChange={(c) => setV({ ...v, readinessItems: { ...v.readinessItems, [k]: c } })} />
          ))}
        </div>
      </Card>

      <Card title="תקן צוות מוצע (אורחים לעובד אחד)" bodyClass="p-0">
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>סגנון</th>{(Object.keys(STAFF_ROLES) as StaffRole[]).map((r) => <th key={r}>{STAFF_ROLES[r]}</th>)}</tr></thead>
            <tbody>
              {styles.map(([st, label]) => (
                <tr key={st}>
                  <td className="font-semibold">{label}</td>
                  {(Object.keys(STAFF_ROLES) as StaffRole[]).map((r) => (
                    <td key={r}><input aria-label={`${label} ${STAFF_ROLES[r]}`} type="number" min={0} placeholder="—" className="input num w-20" value={v.staffingRatios[st][r] ?? ''}
                      onChange={(e) => setV({ ...v, staffingRatios: { ...v.staffingRatios, [st]: { ...v.staffingRatios[st], [r]: e.target.value === '' ? 0 : Number(e.target.value) } } })} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2 text-xs text-[var(--color-muted)]">ריק או 0 = לא נדרש. מנהל האירוע יכול לשנות את התקן בכל אירוע.</p>
      </Card>

      <Card title="מטבח">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Field label="מרווח ביטחון (%)">{(p) => <NumberInput {...p} value={v.kitchen.bufferPct} onChange={(x) => setV({ ...v, kitchen: { ...v.kitchen, bufferPct: x ?? 0 } })} />}</Field>
          {num('foodTrayPortions', 'מנות לארגז/מגש בהעמסה')}
          {(Object.keys(EVENT_TYPES) as (keyof typeof EVENT_TYPES)[]).map((t) => (
            <Field key={t} label={`מקדם – ${EVENT_TYPES[t]}`}>{(p) => <NumberInput {...p} step="0.05" value={v.kitchen.typeFactor[t] ?? 1} onChange={(x) => setV({ ...v, kitchen: { ...v.kitchen, typeFactor: { ...v.kitchen.typeFactor, [t]: x ?? 1 } } })} />}</Field>
          ))}
        </div>
        <p className="mt-2 text-xs text-[var(--color-muted)]">בכל מנה בתפריט אפשר לקבוע כמות קבועה, והשף יכול לשנות כמות לביצוע עם סיבה.</p>
      </Card>

      <Card title="עלויות ורווחיות">
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {num('foodCostTargetPct', 'יעד עלות מזון (% מההכנסה)')}
          {(Object.keys(STAFF_ROLES) as StaffRole[]).map((r) => (
            <Field key={r} label={`עלות משמרת – ${STAFF_ROLES[r]}`}>{(p) => <MoneyInput {...p} value={v.staffShiftCost[r] ?? 0} onChange={(x) => setV({ ...v, staffShiftCost: { ...v.staffShiftCost, [r]: x ?? 0 } })} />}</Field>
          ))}
        </div>
        <p className="mt-2 text-xs text-[var(--color-muted)]">משמשים לחישוב הרווח המשוער של כל אירוע. מחירי חומרי הגלם מתעדכנים מהזמנות הרכש.</p>
      </Card>

      <Card title="לו״ז אירוע ברירת מחדל" actions={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setV({ ...v, runOfShow: [...v.runOfShow, { offsetMin: 0, title: '', role: '' }] })}>שורה</Button>}>
        <p className="mb-2 text-xs text-[var(--color-muted)]">דקות ביחס לשעת תחילת האירוע (שלילי = לפני). בכל אירוע אפשר לערוך את הלו״ז בנפרד.</p>
        <ul className="space-y-2">
          {v.runOfShow.map((r, i) => {
            const setRow = (p: Partial<typeof r>) => setV({ ...v, runOfShow: v.runOfShow.map((x, j) => (j === i ? { ...x, ...p } : x)) });
            return (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <input aria-label="דקות מההתחלה" type="number" step={15} className="input num w-24" value={r.offsetMin} onChange={(e) => setRow({ offsetMin: Number(e.target.value) || 0 })} />
                <Input aria-label="מה קורה" value={r.title} onChange={(e) => setRow({ title: e.target.value })} className="min-w-48 flex-1" />
                <Select aria-label="אחראי" value={r.role} onChange={(e) => setRow({ role: e.target.value as Role | '' })} placeholder="ללא" options={Object.entries(ROLES).filter(([k]) => k !== 'staff').map(([value, label]) => ({ value, label }))} className="w-40" />
                <button type="button" onClick={() => setV({ ...v, runOfShow: v.runOfShow.filter((_, j) => j !== i) })} className="p-1 text-[var(--color-danger)]" aria-label="הסרת שורה"><Trash2 className="size-4" /></button>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card title="ברירות מחדל בטפסים">
        <p className="mb-3 text-xs text-[var(--color-muted)]">מה טופס חדש מציע מראש. בכל טופס אפשר לשנות. ברירות מחדל לאירוע לפי נקודה (שעות, כשרות, איש קשר באולם, משלם) – במבנה ← נקודות.</p>
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="אספקת רכש (ימים מהיום)">{(p) => <NumberInput {...p} value={v.formDefaults.poLeadDays} onChange={(x) => setV({ ...v, formDefaults: { ...v.formDefaults, poLeadDays: x ?? 0 } })} />}</Field>
          <Field label="שעת אספקה">{(p) => <Input {...p} type="time" value={v.formDefaults.poTime} onChange={(e) => setV({ ...v, formDefaults: { ...v.formDefaults, poTime: e.target.value } })} />}</Field>
          <Field label="תנאי תשלום לספקים (ימים)">{(p) => <NumberInput {...p} value={v.formDefaults.payableTermsDays} onChange={(x) => setV({ ...v, formDefaults: { ...v.formDefaults, payableTermsDays: x ?? 0 } })} />}</Field>
          <Field label="סיור/טעימות (ימים מהיום)">{(p) => <NumberInput {...p} value={v.formDefaults.meetingLeadDays} onChange={(x) => setV({ ...v, formDefaults: { ...v.formDefaults, meetingLeadDays: x ?? 0 } })} />}</Field>
          <Field label="שעת סיור">{(p) => <Input {...p} type="time" value={v.formDefaults.tourTime} onChange={(e) => setV({ ...v, formDefaults: { ...v.formDefaults, tourTime: e.target.value } })} />}</Field>
          <Field label="שעת טעימות">{(p) => <Input {...p} type="time" value={v.formDefaults.tastingTime} onChange={(e) => setV({ ...v, formDefaults: { ...v.formDefaults, tastingTime: e.target.value } })} />}</Field>
        </div>
        <h3 className="mb-2 mt-4 text-sm font-bold">מחיר התחלתי לאורח בהצעת מחיר</h3>
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {(Object.keys(EVENT_TYPES) as (keyof typeof EVENT_TYPES)[]).map((t) => (
            <Field key={t} label={EVENT_TYPES[t]}>{(p) => <MoneyInput {...p} value={v.formDefaults.quotePerGuest[t] ?? null} onChange={(x) => setV({ ...v, formDefaults: { ...v.formDefaults, quotePerGuest: { ...v.formDefaults.quotePerGuest, [t]: x ?? 0 } } })} />}</Field>
          ))}
        </div>
      </Card>

      <Card title="פרטי העסק להדפסות">
        <div className="grid gap-4 sm:grid-cols-3">
          {([['name', 'שם העסק'], ['legalName', 'שם משפטי'], ['taxId', 'ח.פ. / ע.מ.'], ['phone', 'טלפון'], ['email', 'מייל'], ['address', 'כתובת']] as const).map(([k, label]) => (
            <Field key={k} label={label}>{(p) => <Input {...p} value={v.business[k]} onChange={(e) => setV({ ...v, business: { ...v.business, [k]: e.target.value } })} />}</Field>
          ))}
          <Field label="תנאים בהצעת מחיר" className="sm:col-span-2">{(p) => <Textarea {...p} rows={3} value={v.business.quoteTerms} onChange={(e) => setV({ ...v, business: { ...v.business, quoteTerms: e.target.value } })} />}</Field>
          <Field label="הערה בהזמנת רכש">{(p) => <Textarea {...p} rows={3} value={v.business.poNote} onChange={(e) => setV({ ...v, business: { ...v.business, poNote: e.target.value } })} />}</Field>
        </div>
      </Card>

      <Card title="גבייה">
        <div className="grid gap-4 sm:grid-cols-3">
          {num('depositPct', 'מקדמה ברירת מחדל (%)')}
          {num('depositDueDays', 'מועד מקדמה (ימים מהחתימה)')}
          {num('finalDueDays', 'מועד תשלום סופי (ימים אחרי האירוע)')}
        </div>
      </Card>

      <Card title="רשימות לבחירה">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="מקורות פנייה" hint="ערך בכל שורה">{(p) => <Textarea {...p} rows={8} value={lists.leadSources} onChange={(e) => setLists({ ...lists, leadSources: e.target.value })} />}</Field>
          <Field label="קטגוריות מנות" hint="ערך בכל שורה">{(p) => <Textarea {...p} rows={8} value={lists.dishCategories} onChange={(e) => setLists({ ...lists, dishCategories: e.target.value })} />}</Field>
          <Field label="יחידות מידה" hint="ערך בכל שורה">{(p) => <Textarea {...p} rows={8} value={lists.units} onChange={(e) => setLists({ ...lists, units: e.target.value })} />}</Field>
        </div>
      </Card>

      <VehiclesCard canEdit={canEdit} />

      <BackupsCard keep={v.backupKeep} onKeep={(n) => setV({ ...v, backupKeep: n })} />

      <FormError message={save.error?.message} />
      {canEdit && (
        <div className="sticky bottom-3 flex flex-wrap justify-between gap-2 rounded-[14px] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-pop)]">
          <Button icon={<DatabaseBackup className="size-4" />} loading={backup.isPending} onClick={() => backup.mutate(undefined)}>גיבוי מסד הנתונים עכשיו</Button>
          <Button variant="primary" icon={<Save className="size-4" />} loading={save.isPending} onClick={() => save.mutate(undefined)}>שמירת הגדרות</Button>
        </div>
      )}
    </fieldset>
  );
}

interface AdminUser { id: number; name: string; email: string; phone: string; active: number; grants: { role: Role; venue: VenueCode | null }[] }

function UsersPanel() {
  const auth = useAuth();
  const q = useQuery({ queryKey: ['admin', 'users'], queryFn: () => api.get<AdminUser[]>('/users') });
  const [edit, setEdit] = useState<AdminUser | 'new' | null>(null);
  return (
    <Card bodyClass="p-0" title="משתמשים" actions={auth.can('admin', 3) && <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit('new')}>משתמש</Button>}>
      <QueryView q={q}>
        {(list) => (
          <table className="table">
            <thead><tr><th>שם</th><th>מייל</th><th>תפקידים ונקודות</th><th>מצב</th><th /></tr></thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.id} className={u.active ? '' : 'opacity-50'}>
                  <td className="font-semibold">{u.name}</td>
                  <td className="text-sm" dir="ltr">{u.email}</td>
                  <td><div className="flex flex-wrap gap-1">{u.grants.map((g, i) => <Badge key={i} tone="brand">{ROLES[g.role]}{g.venue ? ` · ${VENUE_LABEL[g.venue]}` : ' · כל הנקודות'}</Badge>)}</div></td>
                  <td>{u.active ? <Badge tone="ok">פעיל</Badge> : <Badge>מושבת</Badge>}</td>
                  <td>{auth.can('admin', 3) && <Button size="sm" variant="ghost" aria-label={`עריכת ${u.name}`} onClick={() => setEdit(u)}><Pencil className="size-4" /></Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </QueryView>
      {edit && <UserDialog u={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </Card>
  );
}

function UserDialog({ u, onClose }: { u: AdminUser | null; onClose: () => void }) {
  const [v, setV] = useState({ name: u?.name ?? '', email: u?.email ?? '', phone: u?.phone ?? '', active: u ? !!u.active : true, password: '' });
  const [grants, setGrants] = useState<{ role: Role; venue: string }[]>(u?.grants.map((g) => ({ role: g.role, venue: g.venue ?? '' })) ?? [{ role: 'sales', venue: '' }]);
  const body = () => ({ ...v, password: v.password || undefined, grants: grants.map((g) => ({ role: g.role, venue: g.venue || null })) });
  const save = useAction(() => (u ? api.put(`/users/${u.id}`, body()) : api.post('/users', body())), { success: 'המשתמש נשמר', invalidate: [['admin', 'users'], ['directory']], onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} title={u ? `עריכת ${u.name}` : 'משתמש חדש'} footer={<><Button onClick={onClose}>ביטול</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>שמירה</Button></>}>
      <div className="space-y-4">
        <FormError message={save.error?.message} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="שם" required error={save.error?.fields.name}>{(p) => <Input {...p} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
          <Field label="מייל (שם משתמש)" required error={save.error?.fields.email}>{(p) => <Input {...p} type="email" dir="ltr" className="text-start" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />}</Field>
          <Field label="טלפון">{(p) => <Input {...p} dir="ltr" className="text-start" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />}</Field>
          <Field label={u ? 'סיסמה חדשה (ריק = ללא שינוי)' : 'סיסמה ראשונית'} required={!u} error={save.error?.fields.password}>{(p) => <Input {...p} type="password" autoComplete="new-password" dir="ltr" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} />}</Field>
        </div>
        <fieldset>
          <legend className="label">תפקידים ונקודות</legend>
          <p className="mb-2 text-xs text-[var(--color-muted)]">עובד שמשרת כמה נקודות מקבל שורה לכל נקודה. אדם יכול למלא כמה תפקידים.</p>
          <ul className="space-y-2">
            {grants.map((g, i) => (
              <li key={i} className="flex gap-2">
                <Select aria-label="תפקיד" value={g.role} onChange={(e) => setGrants((x) => x.map((y, j) => (j === i ? { ...y, role: e.target.value as Role } : y)))} options={optionsOf(ROLES)} className="w-52" />
                <Select aria-label="נקודה" value={g.venue} onChange={(e) => setGrants((x) => x.map((y, j) => (j === i ? { ...y, venue: e.target.value } : y)))} placeholder="כל הנקודות" options={optionsOf(VENUE_LABEL)} className="w-44" />
                <button onClick={() => setGrants((x) => x.filter((_, j) => j !== i))} className="p-1 text-[var(--color-danger)]" aria-label="הסרה"><Trash2 className="size-4" /></button>
              </li>
            ))}
          </ul>
          <Button size="sm" className="mt-2" icon={<Plus className="size-4" />} onClick={() => setGrants((x) => [...x, { role: 'event_manager', venue: '' }])}>תפקיד</Button>
        </fieldset>
        <Checkbox label="משתמש פעיל" hint="השבתה מנתקת את המשתמש מיד" checked={v.active} onChange={(c) => setV({ ...v, active: c })} />
      </div>
    </Dialog>
  );
}

function MatrixPanel() {
  const tone = (l: Level) => (l === 3 ? 'ok' : l === 2 ? 'info' : l === 1 ? 'neutral' : undefined);
  return (
    <Card bodyClass="p-0" title="הרשאות לפי תפקיד (צפייה · עריכה · אישור)">
      <div className="overflow-x-auto">
        <table className="table">
          <thead><tr><th>אזור</th>{(Object.keys(ROLES) as Role[]).map((r) => <th key={r} className="whitespace-nowrap">{ROLES[r]}</th>)}</tr></thead>
          <tbody>
            {(Object.keys(MODULES) as Module[]).map((m) => (
              <tr key={m}>
                <td className="font-semibold">{MODULES[m]}</td>
                {(Object.keys(ROLES) as Role[]).map((r) => {
                  const l = (MATRIX[r][m] ?? 0) as Level;
                  return <td key={r}>{l ? <Badge tone={tone(l)}>{LEVEL_LABEL[l]}</Badge> : <span className="text-[var(--color-muted)]">—</span>}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function AuditPanel() {
  const q = useQuery({ queryKey: ['admin', 'audit'], queryFn: () => api.get<{ id: number; entity: string; entityId: number; eventId: number | null; userName: string | null; action: string; summary: string; at: string }[]>('/admin/audit') });
  return (
    <Card bodyClass="p-0" title="300 הפעולות האחרונות">
      <QueryView q={q}>
        {(list) => (
          <table className="table">
            <thead><tr><th>מועד</th><th>משתמש</th><th>פעולה</th><th>ישות</th><th>תיאור</th></tr></thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap text-sm">{formatTs(a.at)}</td>
                  <td className="text-sm">{a.userName ?? 'מערכת'}</td>
                  <td className="text-sm font-semibold">{auditActionLabel(a.action)}</td>
                  <td className="text-sm">{a.eventId ? <a href={`/events/${a.eventId}/history`} className="underline">אירוע #{a.eventId}</a> : `${a.entity} #${a.entityId}`}</td>
                  <td className="text-sm">{a.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </QueryView>
    </Card>
  );
}

function VehiclesCard({ canEdit }: { canEdit: boolean }) {
  const q = useQuery({ queryKey: ['vehicles'], queryFn: () => api.get<{ id: number; name: string; plate: string; notes: string; active: number }[]>('/ops/vehicles') });
  const [name, setName] = useState('');
  const [plate, setPlate] = useState('');
  const add = useAction(() => api.post('/ops/vehicles', { name, plate }), { success: 'הרכב נוסף', invalidate: [['vehicles']], onSuccess: () => { setName(''); setPlate(''); } });
  const toggle = useAction((x: { id: number; name: string; plate: string; notes: string; active: boolean }) => api.put(`/ops/vehicles/${x.id}`, x), { invalidate: [['vehicles']] });
  return (
    <Card title="רכבים">
      <QueryView q={q}>
        {(list) => (
          <div className="space-y-3">
            <ul className="divide-y divide-[var(--color-border)] text-sm">
              {list.map((x) => (
                <li key={x.id} className={`flex items-center gap-2 py-1.5 ${x.active ? '' : 'opacity-50'}`}>
                  <span className="flex-1 font-semibold">{x.name}{x.plate && <span className="num ms-2 font-normal text-[var(--color-muted)]">{x.plate}</span>}</span>
                  {canEdit && <Button size="sm" variant="ghost" onClick={() => toggle.mutate({ id: x.id, name: x.name, plate: x.plate, notes: x.notes, active: !x.active })}>{x.active ? 'השבתה' : 'הפעלה'}</Button>}
                </li>
              ))}
            </ul>
            {canEdit && (
              <div className="flex flex-wrap items-end gap-2">
                <FormError message={add.error?.message} />
                <Field label="שם הרכב" error={add.error?.fields.name}>{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder="משאית קירור" />}</Field>
                <Field label="מספר רישוי">{(p) => <Input {...p} value={plate} onChange={(e) => setPlate(e.target.value)} className="w-32" />}</Field>
                <Button icon={<Plus className="size-4" />} loading={add.isPending} onClick={() => add.mutate(undefined)}>הוספה</Button>
              </div>
            )}
          </div>
        )}
      </QueryView>
    </Card>
  );
}

interface BackupInfo { name: string; at: string; kind: 'auto' | 'manual' | 'pre-restore'; sizeBytes: number; verified: boolean; problem: string | null; counts: Record<string, number> }
const BACKUP_KIND = { auto: 'יומי אוטומטי', manual: 'ידני', 'pre-restore': 'לפני שחזור' } as const;

function BackupsCard({ keep, onKeep }: { keep: number; onKeep: (n: number) => void }) {
  const q = useQuery({ queryKey: ['admin', 'backups'], queryFn: () => api.get<BackupInfo[]>('/admin/backups') });
  return (
    <Card title="גיבויים">
      <p className="mb-3 text-sm">כל יום נשמר גיבוי אוטומטי של מסד הנתונים והקבצים שהועלו. כל גיבוי נבדק מיד: שהוא נפתח, שהוא תקין ושיש בו בדיוק אותן רשומות כמו במערכת.</p>
      <div className="mb-3 w-48"><Field label="כמה גיבויים לשמור">{(p) => <NumberInput {...p} min={3} value={keep} onChange={(x) => onKeep(x ?? 30)} />}</Field></div>
      <QueryView q={q} empty={(l) => (l.length ? null : <p className="text-sm text-[var(--color-muted)]">עדיין אין גיבויים.</p>)}>
        {(list) => (
          <table className="table">
            <thead><tr><th>מתי</th><th>סוג</th><th>מצב</th><th className="text-end">אירועים</th><th className="text-end">לקוחות</th><th className="text-end">גודל</th><th>שם (לשחזור)</th></tr></thead>
            <tbody>{list.slice(0, 10).map((b) => (
              <tr key={b.name}>
                <td className="whitespace-nowrap">{formatTs(b.at)}</td>
                <td>{BACKUP_KIND[b.kind]}</td>
                <td>{b.verified ? <Badge tone="ok">אומת</Badge> : <Badge tone="danger">{b.problem}</Badge>}</td>
                <td className="num text-end">{b.counts.events}</td>
                <td className="num text-end">{b.counts.clients}</td>
                <td className="num text-end">{(b.sizeBytes / 1024 / 1024).toFixed(1)}MB</td>
                <td className="text-xs" dir="ltr">{b.name}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </QueryView>
      <p className="mt-3 text-xs text-[var(--color-muted)]">שחזור נעשה במחשב השרת, כשהמערכת עצורה: <code dir="ltr">npm run restore -- &lt;שם הגיבוי&gt;</code>. לפני השחזור המצב הנוכחי נשמר כגיבוי נוסף, כך שאפשר לחזור אחורה.</p>
    </Card>
  );
}
