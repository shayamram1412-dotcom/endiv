/**
 * Structure & vocabulary editor: venues and their rules, event types, work stages, every word list,
 * the permission matrix, readiness owners and allergens. Nothing here requires a programmer.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2, ChevronUp, ChevronDown, Save, Pencil, RotateCcw } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { useAction } from '../../lib/query.ts';
import { useAuth, useDirectory, usersWithRole } from '../../lib/auth.tsx';
import { useUrlState } from '../../lib/useUrlState.ts';
import { Card, QueryView } from '../../ui/layout.tsx';
import { Button } from '../../ui/Button.tsx';
import { Badge } from '../../ui/Badge.tsx';
import { Segmented } from '../../ui/Tabs.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import { Checkbox, Field, FormError, Input, NumberInput, Select, Textarea, optionsOf } from '../../ui/form.tsx';
import {
  DICTS, defaultEventTypes, defaultLabel, defaultStages,
  type EventTypeConfig, type StageConfig, type SystemConfig, type VenueConfig,
} from '@shared/config.ts';
import { CORE_STAGES, EVENT_TYPES, KOSHER, type VenueDefaults } from '@shared/domain.ts';
import { LEVEL_LABEL, MATRIX, MODULES, ROLES, type Level, type Module, type Role } from '@shared/permissions.ts';
import { READINESS_ITEMS, READINESS_OWNER } from '@shared/readiness.ts';
import { CONTACT_ROLES, HOME_BLOCKS, KPIS_BY_ROLE, KPI_ITEMS, NAV_BY_ROLE, NAV_ITEMS, type HomeBlock, type KpiKey, type NavKey } from '@shared/navigation.ts';

interface ConfigResponse { system: SystemConfig; venues: VenueConfig[] }

const TRACK = { direct: 'מכירה ישירה (פנייה → הצעה → חוזה)', hall: 'נמכר ע״י אולם (קליטה ואימות)' };
const EQUIPMENT = { rental: 'כלים שכורים עם החזרה', consumables: 'מתכלים בלבד', none: 'ללא ציוד מטעם הקייטרינג', site: 'לפי צורכי האתר' };
const STYLE = { formal: 'מוגש', reception: 'קבלת פנים / כנס', platters: 'מגשים' };

export function SystemPanel() {
  const auth = useAuth();
  const canEdit = auth.can('admin', 3);
  const [s, set] = useUrlState({ sys: 'venues' });
  const q = useQuery({ queryKey: ['config', 'edit'], queryFn: () => api.get<ConfigResponse>('/admin/config') });
  const [sys, setSys] = useState<SystemConfig | null>(null);
  useEffect(() => {
    if (!q.data) return;
    const c = q.data.system;
    setSys({
      labels: c.labels ?? {},
      eventTypes: c.eventTypes?.length ? c.eventTypes : defaultEventTypes(),
      workStages: c.workStages?.length ? c.workStages : defaultStages(),
      permissions: c.permissions ?? {},
      readinessOwners: c.readinessOwners ?? {},
      allergens: c.allergens ?? [],
      navByRole: { ...NAV_BY_ROLE, ...(c.navByRole ?? {}) },
      homeByRole: { ...KPIS_BY_ROLE, ...(c.homeByRole ?? {}) },
      contactRoles: c.contactRoles?.length ? c.contactRoles : [...CONTACT_ROLES],
    });
  }, [q.data]);
  const save = useAction(() => api.put('/admin/system', sys), {
    success: 'המבנה והמונחים נשמרו – המסך יתרענן',
    onSuccess: () => setTimeout(() => window.location.reload(), 600),
  });

  const sections = [
    { value: 'venues', label: 'נקודות' }, { value: 'types', label: 'סוגי אירועים' }, { value: 'stages', label: 'שלבי התהליך' },
    { value: 'words', label: 'מילון מונחים' }, { value: 'perms', label: 'הרשאות' }, { value: 'view', label: 'תצוגה לפי תפקיד' }, { value: 'readiness', label: 'אחראים לצ׳קליסט' },
    { value: 'allergens', label: 'אלרגנים' },
  ];

  return (
    <div className="space-y-4">
      <p className="rounded-[10px] bg-[var(--color-surface-2)] p-3 text-sm">כאן מגדירים את מבנה העסק ואת השפה של המערכת. שינוי חל על כל המסכים, המשימות וההרשאות. נתונים קיימים לא נמחקים: סוג או שלב שבשימוש אפשר להשבית אבל לא למחוק.</p>
      <Segmented label="אזור" value={s.sys} onChange={(v) => set({ sys: v })} options={sections} />
      <QueryView q={q}>
        {(data) => !sys ? null : (
          <fieldset disabled={!canEdit} className="space-y-4">
            {s.sys === 'venues' && <VenuesEditor venues={data.venues} canEdit={canEdit} />}
            {s.sys === 'types' && <TypesEditor types={sys.eventTypes} venues={data.venues} onChange={(eventTypes) => setSys({ ...sys, eventTypes })} />}
            {s.sys === 'stages' && <StagesEditor stages={sys.workStages} onChange={(workStages) => setSys({ ...sys, workStages })} />}
            {s.sys === 'words' && <WordsEditor labels={sys.labels} onChange={(labels) => setSys({ ...sys, labels })} />}
            {s.sys === 'view' && <RoleViewEditor sys={sys} onChange={setSys} />}
            {s.sys === 'perms' && <PermissionsEditor perms={sys.permissions} onChange={(permissions) => setSys({ ...sys, permissions })} />}
            {s.sys === 'readiness' && (
              <Card title="מי אחראי על כל פריט בצ׳קליסט המוכנות">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {Object.entries(READINESS_ITEMS).map(([k, label]) => (
                    <Field key={k} label={label}>{(p) => <Select {...p} value={sys.readinessOwners[k] ?? READINESS_OWNER[k]} onChange={(e) => setSys({ ...sys, readinessOwners: { ...sys.readinessOwners, [k]: e.target.value as Role } })} options={optionsOf(ROLES)} />}</Field>
                  ))}
                </div>
              </Card>
            )}
            {s.sys === 'allergens' && (
              <Card title="רשימת אלרגנים לבחירה במנות">
                <Textarea aria-label="אלרגנים, אחד בכל שורה" rows={10} value={(sys.allergens.length ? sys.allergens : ['גלוטן', 'אגוזים', 'בוטנים', 'שומשום', 'חלב', 'ביצים', 'דגים', 'סויה', 'סלרי', 'חרדל']).join('\n')}
                  onChange={(e) => setSys({ ...sys, allergens: [...new Set(e.target.value.split('\n').map((x) => x.trim()).filter(Boolean))] })} />
              </Card>
            )}
            {s.sys !== 'venues' && canEdit && (
              <div className="sticky bottom-3 flex items-center justify-end gap-2 rounded-[14px] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-pop)]">
                <FormError message={save.error?.message} />
                <Button variant="primary" icon={<Save className="size-4" />} loading={save.isPending} onClick={() => save.mutate(undefined)}>שמירת המבנה והמונחים</Button>
              </div>
            )}
          </fieldset>
        )}
      </QueryView>
    </div>
  );
}

// ---------------------------------------------------------------- venues

function VenuesEditor({ venues, canEdit }: { venues: VenueConfig[]; canEdit: boolean }) {
  const [edit, setEdit] = useState<VenueConfig | 'new' | null>(null);
  return (
    <Card title="נקודות פעילות" bodyClass="p-0" actions={canEdit && <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit('new')}>נקודה חדשה</Button>}>
      <table className="table">
        <thead><tr><th>נקודה</th><th>מסלול</th><th>ציוד</th><th>ספירת העמסה</th><th>פרטי אתר</th><th>אירועים ביום</th><th>מצב</th><th /></tr></thead>
        <tbody>
          {venues.map((v) => (
            <tr key={v.code} className={v.active ? '' : 'opacity-50'}>
              <td><span className="me-2 inline-block size-3 rounded-sm align-middle" style={{ background: v.color }} /><strong>{v.name}</strong><div className="text-xs text-[var(--color-muted)]">{v.address}</div></td>
              <td className="text-sm">{TRACK[v.track]}</td>
              <td className="text-sm">{EQUIPMENT[v.equipment]}</td>
              <td>{v.loadCheck ? 'כן' : '—'}</td>
              <td>{v.siteDetails ? 'כן' : '—'}</td>
              <td className="num">{v.maxPerDay ?? 'ללא הגבלה'}</td>
              <td>{v.active ? <Badge tone="ok">פעילה</Badge> : <Badge>מושבתת</Badge>}</td>
              <td>{canEdit && <Button size="sm" variant="ghost" aria-label={`עריכת ${v.name}`} onClick={() => setEdit(v)}><Pencil className="size-4" /></Button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {edit && <VenueDialog v={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </Card>
  );
}

function VenueDialog({ v, onClose }: { v: VenueConfig | null; onClose: () => void }) {
  const [f, setF] = useState({
    code: v?.code ?? '', name: v?.name ?? '', address: v?.address ?? '', track: v?.track ?? 'direct', equipment: v?.equipment ?? 'site',
    loadCheck: v?.loadCheck ?? false, siteDetails: v?.siteDetails ?? false, color: v?.color ?? '#3a6ea5', sort: v?.sort ?? 10, active: v ? !!v.active : true, maxPerDay: v?.maxPerDay ?? null as number | null, defaults: (v?.defaults ?? {}) as VenueDefaults,
  });
  const dir = useDirectory();
  const setDef = (p: Partial<VenueDefaults>) => setF((x) => ({ ...x, defaults: { ...x.defaults, ...p } }));
  const done = () => setTimeout(() => window.location.reload(), 600);
  const save = useAction(() => (v ? api.put(`/admin/venues/${v.code}`, f) : api.post('/admin/venues', f)), { success: 'הנקודה נשמרה – המסך יתרענן', onSuccess: done });
  const del = useAction(() => api.del(`/admin/venues/${v!.code}`), { success: 'הנקודה נמחקה', onSuccess: done });
  return (
    <Dialog open onClose={onClose} title={v ? `עריכת ${v.name}` : 'נקודה חדשה'} footer={<>
      {v && <Button variant="ghost" className="me-auto" icon={<Trash2 className="size-4 text-[var(--color-danger)]" />} loading={del.isPending} onClick={() => { if (window.confirm('למחוק את הנקודה? אפשרי רק אם אין לה אירועים.')) del.mutate(undefined); }}>מחיקה</Button>}
      <Button onClick={onClose}>ביטול</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>שמירה</Button>
    </>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><FormError message={save.error?.message ?? del.error?.message} /></div>
        {!v && <Field label="מזהה (באנגלית)" required hint="לדוגמה: garden. לא ניתן לשינוי אחר כך" error={save.error?.fields.code}>{(p) => <Input {...p} dir="ltr" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toLowerCase() })} />}</Field>}
        <Field label="שם" required error={save.error?.fields.name}>{(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="כתובת" className="sm:col-span-2">{(p) => <Input {...p} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />}</Field>
        <Field label="מסלול מכירה">{(p) => <Select {...p} value={f.track} onChange={(e) => setF({ ...f, track: e.target.value as 'direct' })} options={optionsOf(TRACK)} />}</Field>
        <Field label="ציוד">{(p) => <Select {...p} value={f.equipment} onChange={(e) => setF({ ...f, equipment: e.target.value as 'site' })} options={optionsOf(EQUIPMENT)} />}</Field>
        <Checkbox label="ספירת העמסה ופריקה" hint="סופרים אוכל וציוד לפני העמסה ואחרי פריקה" checked={f.loadCheck} onChange={(c) => setF({ ...f, loadCheck: c })} />
        <Checkbox label="נדרשים פרטי אתר" hint="כתובת, איש קשר בשטח ושעות" checked={f.siteDetails} onChange={(c) => setF({ ...f, siteDetails: c })} />
        <Field label="צבע בלוח השנה">{(p) => <Input {...p} type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} className="h-10 w-24 p-1" />}</Field>
        <Field label="מקסימום אירועים ביום" hint="ריק = ללא הגבלה. חוזה או קליטה מעבר לכך דורשים אישור הנהלה" error={save.error?.fields.maxPerDay}>{(p) => <NumberInput {...p} min={1} value={f.maxPerDay} onChange={(x) => setF({ ...f, maxPerDay: x })} />}</Field>
        <Field label="סדר תצוגה">{(p) => <NumberInput {...p} value={f.sort} onChange={(x) => setF({ ...f, sort: x ?? 0 })} />}</Field>
        <Checkbox label="פעילה" checked={f.active} onChange={(c) => setF({ ...f, active: c })} />

        <div className="mt-2 border-t border-[var(--color-border)] pt-3 sm:col-span-2">
          <h3 className="text-sm font-bold">ברירות מחדל לאירוע חדש בנקודה</h3>
          <p className="text-xs text-[var(--color-muted)]">ממלאות את טופס האירוע מראש. בכל אירוע אפשר לשנות כל אחת מהן.</p>
        </div>
        <Field label="סוג אירוע">{(p) => <Select {...p} value={f.defaults.eventType ?? ''} onChange={(e) => setDef({ eventType: e.target.value || undefined })} placeholder="ללא" options={optionsOf(EVENT_TYPES)} />}</Field>
        <Field label="כשרות">{(p) => <Select {...p} value={f.defaults.kosher ?? ''} onChange={(e) => setDef({ kosher: e.target.value || undefined })} placeholder="ללא" options={optionsOf(KOSHER)} />}</Field>
        <Field label="שעת התחלה">{(p) => <Input {...p} type="time" value={f.defaults.startTime ?? ''} onChange={(e) => setDef({ startTime: e.target.value })} />}</Field>
        <Field label="שעת סיום">{(p) => <Input {...p} type="time" value={f.defaults.endTime ?? ''} onChange={(e) => setDef({ endTime: e.target.value })} />}</Field>
        <Field label="שעת מסירה (מגשים)">{(p) => <Input {...p} type="time" value={f.defaults.deliveryTime ?? ''} onChange={(e) => setDef({ deliveryTime: e.target.value })} />}</Field>
        <Field label="מספר אורחים טיפוסי">{(p) => <NumberInput {...p} value={f.defaults.guests ?? null} onChange={(x) => setDef({ guests: x })} />}</Field>
        <Field label="סוג תפריט">{(p) => <Input {...p} value={f.defaults.menuType ?? ''} onChange={(e) => setDef({ menuType: e.target.value })} />}</Field>
        <Field label="מנהל אירוע קבוע">{(p) => <Select {...p} value={f.defaults.eventManagerId ? String(f.defaults.eventManagerId) : ''} onChange={(e) => setDef({ eventManagerId: e.target.value ? Number(e.target.value) : null })} placeholder="ללא" options={usersWithRole(dir.data, 'event_manager', v?.code).map((u) => ({ value: u.id, label: u.name }))} />}</Field>
        {f.track === 'hall' && <>
          <Field label="איש קשר באולם">{(p) => <Input {...p} value={f.defaults.hallContactName ?? ''} onChange={(e) => setDef({ hallContactName: e.target.value })} />}</Field>
          <Field label="טלפון האולם" error={save.error?.fields['defaults.hallContactPhone']}>{(p) => <Input {...p} type="tel" dir="ltr" className="text-start" value={f.defaults.hallContactPhone ?? ''} onChange={(e) => setDef({ hallContactPhone: e.target.value })} />}</Field>
          <Field label="גורם משלם">{(p) => <Input {...p} value={f.defaults.payer ?? ''} onChange={(e) => setDef({ payer: e.target.value })} />}</Field>
        </>}
        {f.siteDetails === false && <Field label="כתובת האירוע" hint="ריק = כתובת הנקודה">{(p) => <Input {...p} value={f.defaults.address ?? ''} onChange={(e) => setDef({ address: e.target.value })} />}</Field>}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- event types

function TypesEditor({ types, venues, onChange }: { types: EventTypeConfig[]; venues: VenueConfig[]; onChange: (t: EventTypeConfig[]) => void }) {
  const upd = (i: number, p: Partial<EventTypeConfig>) => onChange(types.map((t, j) => (j === i ? { ...t, ...p } : t)));
  const [newKey, setNewKey] = useState('');
  return (
    <Card title="סוגי אירועים" bodyClass="p-0">
      <div className="overflow-x-auto">
        <table className="table">
          <thead><tr><th>שם</th><th>מזהה</th><th>זמין בנקודות</th><th>סגנון שירות (לתקן צוות)</th><th>פעיל</th><th /></tr></thead>
          <tbody>
            {types.map((t, i) => (
              <tr key={t.key} className={t.active ? '' : 'opacity-50'}>
                <td><input aria-label="שם" className="input w-40" value={t.label} onChange={(e) => upd(i, { label: e.target.value })} /></td>
                <td className="text-xs text-[var(--color-muted)]" dir="ltr">{t.key}</td>
                <td>
                  <div className="flex flex-wrap gap-x-3">
                    {venues.map((v) => (
                      <label key={v.code} className="flex items-center gap-1 text-sm">
                        <input type="checkbox" className="accent-[var(--color-brand)]" checked={t.venues.includes(v.code)} onChange={(e) => upd(i, { venues: e.target.checked ? [...t.venues, v.code] : t.venues.filter((x) => x !== v.code) })} />{v.name}
                      </label>
                    ))}
                  </div>
                </td>
                <td><Select aria-label="סגנון" value={t.style} onChange={(e) => upd(i, { style: e.target.value as 'formal' })} options={optionsOf(STYLE)} className="w-40" /></td>
                <td><input type="checkbox" aria-label="פעיל" className="size-4 accent-[var(--color-brand)]" checked={t.active} onChange={(e) => upd(i, { active: e.target.checked })} /></td>
                <td><button className="p-1 text-[var(--color-danger)]" aria-label={`מחיקת ${t.label}`} onClick={() => onChange(types.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-end gap-2 border-t border-[var(--color-border)] p-3">
        <Field label="סוג חדש – מזהה באנגלית" className="w-56">{(p) => <Input {...p} dir="ltr" value={newKey} onChange={(e) => setNewKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} placeholder="brit" />}</Field>
        <Button icon={<Plus className="size-4" />} disabled={newKey.length < 2 || types.some((t) => t.key === newKey)}
          onClick={() => { onChange([...types, { key: newKey, label: newKey, venues: venues.map((v) => v.code), style: 'reception', active: true }]); setNewKey(''); }}>הוספה</Button>
        <span className="text-xs text-[var(--color-muted)]">מחיקה אפשרית רק לסוג שאין לו אירועים; אחרת – השבתה. מקדם הכמויות לכל סוג נקבע במסך "נהלים וזמנים".</span>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- stages

function StagesEditor({ stages, onChange }: { stages: StageConfig[]; onChange: (s: StageConfig[]) => void }) {
  const upd = (i: number, p: Partial<StageConfig>) => onChange(stages.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const move = (i: number, d: -1 | 1) => { const n = [...stages]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); onChange(n); };
  const [newKey, setNewKey] = useState('');
  return (
    <Card title="שלבי תהליך העבודה" bodyClass="p-0">
      <ol className="divide-y divide-[var(--color-border)]">
        {stages.map((s, i) => (
          <li key={s.key} className="grid items-center gap-2 p-3 sm:grid-cols-[40px_200px_1fr_auto]">
            <span className="num text-xl font-extrabold text-[var(--color-warn)]">{String(i + 1).padStart(2, '0')}</span>
            <input aria-label="שם השלב" className="input" value={s.label} onChange={(e) => upd(i, { label: e.target.value })} />
            <input aria-label="תיאור" className="input" value={s.desc} onChange={(e) => upd(i, { desc: e.target.value })} />
            <span className="flex gap-1">
              <button className="p-1 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="העלאה"><ChevronUp className="size-4" /></button>
              <button className="p-1 disabled:opacity-30" disabled={i === stages.length - 1} onClick={() => move(i, 1)} aria-label="הורדה"><ChevronDown className="size-4" /></button>
              {CORE_STAGES.includes(s.key as never)
                ? <span className="px-1 text-[11px] text-[var(--color-muted)]">בסיסי</span>
                : <button className="p-1 text-[var(--color-danger)]" onClick={() => onChange(stages.filter((_, j) => j !== i))} aria-label="מחיקה"><Trash2 className="size-4" /></button>}
            </span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-end gap-2 border-t border-[var(--color-border)] p-3">
        <Field label="שלב חדש – מזהה באנגלית" className="w-56">{(p) => <Input {...p} dir="ltr" value={newKey} onChange={(e) => setNewKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} placeholder="marketing" />}</Field>
        <Button icon={<Plus className="size-4" />} disabled={newKey.length < 2 || stages.some((s) => s.key === newKey)} onClick={() => { onChange([...stages, { key: newKey, label: newKey, desc: '' }]); setNewKey(''); }}>הוספה</Button>
        <span className="text-xs text-[var(--color-muted)]">שמונת השלבים הבסיסיים ניתנים לשינוי שם, תיאור וסדר. שלבים שהוספתם אפשר גם למחוק.</span>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- words

function WordsEditor({ labels, onChange }: { labels: Record<string, Record<string, string>>; onChange: (l: Record<string, Record<string, string>>) => void }) {
  const [ns, setNs] = useState('roles');
  const dict = DICTS[ns];
  const keys = useMemo(() => Object.keys(dict.dict), [dict]);
  const setWord = (k: string, val: string) => {
    const cur = { ...(labels[ns] ?? {}) };
    if (!val.trim() || val === defaultLabel(ns, k)) delete cur[k]; else cur[k] = val;
    onChange({ ...labels, [ns]: cur });
  };
  return (
    <Card title="מילון מונחים" actions={<Select aria-label="רשימה" value={ns} onChange={(e) => setNs(e.target.value)} options={Object.entries(DICTS).map(([k, d]) => ({ value: k, label: d.title }))} className="w-72" />} bodyClass="p-0">
      <table className="table">
        <thead><tr><th>ברירת מחדל</th><th>השם אצלכם</th><th /></tr></thead>
        <tbody>
          {keys.map((k) => {
            const custom = labels[ns]?.[k];
            return (
              <tr key={k}>
                <td className="text-sm text-[var(--color-ink-2)]">{defaultLabel(ns, k) ?? k}</td>
                <td><input aria-label={`שם עבור ${defaultLabel(ns, k)}`} className="input" value={custom ?? defaultLabel(ns, k) ?? ''} onChange={(e) => setWord(k, e.target.value)} /></td>
                <td>{custom && <button className="p-1" aria-label="חזרה לברירת המחדל" title="חזרה לברירת המחדל" onClick={() => setWord(k, '')}><RotateCcw className="size-4" /></button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

// ---------------------------------------------------------------- permissions

function PermissionsEditor({ perms, onChange }: { perms: SystemConfig['permissions']; onChange: (p: SystemConfig['permissions']) => void }) {
  const roles = (Object.keys(ROLES) as Role[]).filter((r) => r !== 'owner');
  const level = (r: Role, m: Module): Level => (perms[r]?.[m] ?? (MATRIX[r][m] ?? 0)) as Level;
  const setLevel = (r: Role, m: Module, l: Level) => onChange({ ...perms, [r]: { ...(perms[r] ?? {}), [m]: l } });
  return (
    <Card title="הרשאות לפי תפקיד" bodyClass="p-0">
      <p className="px-4 pt-3 text-sm text-[var(--color-muted)]">צפייה · עריכה · אישור. הבעלים/סמנכ״ל תמיד עם הרשאה מלאה (כדי שלא יינעל אף אחד מחוץ למערכת). ההגבלה לנקודה נקבעת לכל משתמש במסך "משתמשים ותפקידים".</p>
      <div className="overflow-x-auto">
        <table className="table">
          <thead><tr><th>אזור</th>{roles.map((r) => <th key={r} className="whitespace-nowrap">{ROLES[r]}</th>)}</tr></thead>
          <tbody>
            {(Object.keys(MODULES) as Module[]).map((m) => (
              <tr key={m}>
                <td className="font-semibold">{MODULES[m]}</td>
                {roles.map((r) => (
                  <td key={r}>
                    <select aria-label={`${ROLES[r]} – ${MODULES[m]}`} className="input h-8 min-h-0 w-24 py-0 text-xs" value={level(r, m)} onChange={(e) => setLevel(r, m, Number(e.target.value) as Level)}>
                      {([0, 1, 2, 3] as Level[]).map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
                    </select>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}


// ---------------------------------------------------------------- per-role view

function RoleViewEditor({ sys, onChange }: { sys: SystemConfig; onChange: (s: SystemConfig) => void }) {
  const roles = Object.keys(ROLES) as Role[];
  const nav = sys.navByRole ?? {};
  const home = sys.homeByRole ?? {};
  const contact = new Set(sys.contactRoles ?? []);
  const toggle = <K extends string>(list: K[] | undefined, key: K, on: boolean) => (on ? [...new Set([...(list ?? []), key])] : (list ?? []).filter((x) => x !== key));
  const Matrix = <K extends string>({ title, hint, items, value, set, lockOwner }: { title: string; hint: string; items: Record<K, string>; value: Partial<Record<Role, K[]>>; set: (r: Role, k: K, on: boolean) => void; lockOwner?: boolean }) => (
    <Card title={title} bodyClass="p-0">
      <p className="px-4 pt-3 text-sm text-[var(--color-muted)]">{hint}</p>
      <div className="overflow-x-auto">
        <table className="table">
          <thead><tr><th /> {roles.map((r) => <th key={r} className="whitespace-nowrap text-center">{ROLES[r]}</th>)}</tr></thead>
          <tbody>
            {(Object.keys(items) as K[]).map((k) => (
              <tr key={k}>
                <td className="whitespace-nowrap font-semibold">{items[k]}</td>
                {roles.map((r) => (
                  <td key={r} className="text-center">
                    <input type="checkbox" aria-label={`${ROLES[r]} – ${items[k]}`} className="size-4 accent-[var(--color-brand)]"
                      disabled={lockOwner && r === 'owner'} checked={(value[r] ?? []).includes(k)} onChange={(e) => set(r, k, e.target.checked)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
  return (
    <div className="space-y-4">
      <Matrix<NavKey> title="מה מופיע בתפריט" hint="רק מה שרלוונטי לתפקיד. ההרשאות עדיין קובעות מה מותר; כאן קובעים מה מוצג. לבעלים תמיד מוצג הכול."
        items={NAV_ITEMS} value={nav} lockOwner set={(r, k, on) => onChange({ ...sys, navByRole: { ...nav, [r]: toggle(nav[r], k, on) } })} />
      <Matrix<KpiKey | HomeBlock> title="מה מופיע בדף הבית" hint="המספרים והכרטיסים בדשבורד לכל תפקיד. עובד משלים נכנס ישר למסך השטח של היום."
        items={{ ...KPI_ITEMS, ...HOME_BLOCKS }} value={home} set={(r, k, on) => onChange({ ...sys, homeByRole: { ...home, [r]: toggle(home[r], k, on) } })} />
      <Card title="מי רואה טלפון ומייל של הלקוח">
        <p className="mb-3 text-sm text-[var(--color-muted)]">איש הקשר בשטח (כתובת, אב בית) מוצג לכל מי שעובד באירוע. פרטי הלקוח עצמו – רק לתפקידים המסומנים.</p>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {roles.map((r) => <Checkbox key={r} label={ROLES[r]} disabled={r === 'owner'} checked={r === 'owner' || contact.has(r)} onChange={(c) => onChange({ ...sys, contactRoles: c ? [...contact, r] : [...contact].filter((x) => x !== r) })} />)}
        </div>
      </Card>
    </div>
  );
}
