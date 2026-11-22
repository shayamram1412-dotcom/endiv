import { AvailabilityNote } from './Availability.tsx';
/**
 * Two entry points into the same event model:
 *  - Direct inquiry (winery / offsite): sales rep finds or opens a client and records the request.
 *  - Hall intake (eden / farm): brand manager records a wedding already sold by the hall.
 * Only fields relevant for the stage are shown; partial details are fine — a follow-up task is created.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { UserCheck, UserPlus } from 'lucide-react';
import { api, ApiError, qs } from '../../lib/api.ts';
import { useAuth, useDirectory, usersWithRole } from '../../lib/auth.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { useSettings } from '../../lib/settings.ts';
import { Card, PageHeader } from '../../ui/layout.tsx';
import { Button } from '../../ui/Button.tsx';
import { Checkbox, Field, FormError, Input, NumberInput, Select, Textarea, focusFirstError, optionsOf } from '../../ui/form.tsx';
import { Segmented } from '../../ui/Tabs.tsx';
import { CLIENT_KIND, EVENT_TYPES, KOSHER, VENUE_CODES, VENUE_DEFAULTS, VENUE_EVENT_TYPES, VENUE_LABEL, VENUE_RULES, type VenueCode } from '@shared/domain.ts';
import { today } from '@shared/dates.ts';

interface Draft {
  venue: VenueCode; eventType: string; serviceKind: 'full' | 'platters'; date: string; dateFlexible: boolean; startTime: string; endTime: string; deliveryTime: string;
  guests: number | null; kids: number | null; menuType: string; kosher: string; address: string; siteContactName: string; siteContactPhone: string; siteRequirements: string;
  specialRequests: string; source: string; campaign: string; hallContactName: string; hallContactPhone: string; intakeMissing: string; payer: string;
  eventManagerId: string; firstNote: string;
  clientMode: 'new' | 'existing'; clientId: number | null; clientName: string; phone: string; email: string; clientKind: string; company: string;
}

export function NewEventPage({ mode }: { mode: 'direct' | 'hall' }) {
  const settings = useSettings();
  const auth = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const dir = useDirectory();
  const venues = (Object.keys(VENUE_RULES) as VenueCode[]).filter((v) => VENUE_RULES[v].track === mode && (mode === 'direct' ? auth.can('sales', 2, v) : auth.can('events', 2, v)));
  const draftKey = `mb-draft-${mode}`;
  /** Fields a venue fills in by default (Settings → venues); the user can still change each one here. */
  const fromVenue = (v: VenueCode): Partial<Draft> => {
    const x = VENUE_DEFAULTS[v] ?? {};
    return {
      eventType: x.eventType ?? '', serviceKind: x.serviceKind ?? 'full', startTime: x.startTime ?? '', endTime: x.endTime ?? '', deliveryTime: x.deliveryTime ?? '',
      guests: x.guests ?? null, kosher: x.kosher ?? 'none', menuType: x.menuType ?? '', eventManagerId: x.eventManagerId ? String(x.eventManagerId) : '',
      hallContactName: x.hallContactName ?? '', hallContactPhone: x.hallContactPhone ?? '', payer: x.payer ?? '', address: x.address ?? '',
    };
  };
  const firstVenue = venues[0] ?? VENUE_CODES[0];
  const initial: Draft = {
    venue: firstVenue, eventType: '', serviceKind: 'full', date: '', dateFlexible: false, startTime: '', endTime: '', deliveryTime: '',
    guests: null, kids: null, menuType: '', kosher: 'none', address: '', siteContactName: '', siteContactPhone: '', siteRequirements: '', specialRequests: '',
    source: '', campaign: '', hallContactName: '', hallContactPhone: '', intakeMissing: '', payer: mode === 'hall' ? 'האולם' : '', eventManagerId: '', firstNote: '',
    clientMode: 'new', clientId: null, clientName: '', phone: '', email: '', clientKind: 'private', company: '',
    ...fromVenue(firstVenue),
  };
  const [hallEdit, setHallEdit] = useState(false);
  const [d, setD] = useState<Draft>(() => {
    try { const s = sessionStorage.getItem(draftKey); return s ? { ...initial, ...JSON.parse(s) } : initial; } catch { return initial; }
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dup, setDup] = useState<{ clientId: number; name: string | null } | null>(null);
  const upd = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));

  // Keep the draft if the user navigates away or the save fails.
  useEffect(() => { try { sessionStorage.setItem(draftKey, JSON.stringify(d)); } catch { /* ignore */ } }, [d, draftKey]);

  const rules = VENUE_RULES[d.venue];
  const types = VENUE_EVENT_TYPES[d.venue];
  const eventType = types.includes(d.eventType as never) ? d.eventType : types[0];

  // Phone lookup to prevent duplicate client cards.
  const digits = d.phone.replace(/\D/g, '');
  const lookup = useQuery({
    queryKey: ['client-lookup', digits], enabled: d.clientMode === 'new' && digits.length >= 9 && auth.can('clients', 1),
    queryFn: () => api.get<{ id: number; name?: string; phone?: string; hidden?: boolean } | null>(`/clients/lookup${qs({ phone: d.phone })}`),
  });
  const [clientSearch, setClientSearch] = useState('');
  const clients = useQuery({
    queryKey: ['clients', { q: clientSearch }], enabled: d.clientMode === 'existing' && clientSearch.length >= 2,
    queryFn: () => api.get<{ id: number; name: string; phone: string }[]>(`/clients${qs({ q: clientSearch })}`),
  });
  const managers = useMemo(() => usersWithRole(dir.data, 'event_manager', d.venue), [dir.data, d.venue]);

  const [overbook, setOverbook] = useState(false);
  const submit = async (e: FormEvent, allowDuplicateClient = false) => {
    e.preventDefault();
    setBusy(true); setErrors({}); setFormError(null);
    if (!d.date) { setErrors({ date: 'נדרש תאריך' }); setFormError('יש שדות שדורשים תיקון'); setBusy(false); focusFirstError(); return; }
    const payload = {
      venue: d.venue, eventType, serviceKind: d.serviceKind, date: d.date, dateFlexible: d.dateFlexible, startTime: d.startTime, endTime: d.endTime, deliveryTime: d.deliveryTime,
      guests: d.guests ?? 0, kids: d.kids ?? 0, menuType: d.menuType, kosher: d.kosher, address: d.address, siteContactName: d.siteContactName, siteContactPhone: d.siteContactPhone,
      siteRequirements: d.siteRequirements, specialRequests: d.specialRequests, source: mode === 'hall' ? 'אולם' : d.source, campaign: d.campaign,
      hallContactName: d.hallContactName, hallContactPhone: d.hallContactPhone, intakeMissing: d.intakeMissing, payer: d.payer, firstNote: d.firstNote,
      eventManagerId: d.eventManagerId ? Number(d.eventManagerId) : undefined,
      ...(d.clientMode === 'existing' && d.clientId ? { clientId: d.clientId, linkPhone: d.phone || undefined } : { client: { name: d.clientName, phone: d.phone, email: d.email, kind: d.clientKind, company: d.company } }),
      allowDuplicateClient,
      allowOverbook: overbook,
    };
    try {
      const r = await api.post<{ id: number }>('/events', payload);
      sessionStorage.removeItem(draftKey);
      toast.success(mode === 'hall' ? 'האירוע נקלט ונשלח לאימות' : 'הפנייה נקלטה ונוצרה משימת חזרה ללקוח');
      nav(`/events/${r.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'duplicate_client') setDup(err.details as unknown as { clientId: number; name: string | null });
        setErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k.replace(/^client\./, ''), v])));
        setFormError(err.message);
        focusFirstError();
      } else setFormError('שגיאה בשמירה. הנתונים נשמרו בטופס – נסה שוב.');
    } finally {
      setBusy(false);
    }
  };

  if (!venues.length) return <PageHeader title="אין הרשאה" subtitle="אין לך הרשאה לקליטה בנקודות אלה." />;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader eyebrow={mode === 'hall' ? 'מנהל מותג' : 'שירות ומכירות'} title={mode === 'hall' ? 'קליטת חתונה מהאולם' : 'פנייה חדשה'}
        subtitle={mode === 'hall'
          ? 'האירוע נמכר על ידי האולם. רשום את הפרטים שהתקבלו ומה עוד חסר – האירוע ייכנס ללוח ולתורי העבודה.'
          : 'אפשר לשמור גם כשחלק מהפרטים ראשוניים. תיווצר משימת חזרה ללקוח.'} />
      <form onSubmit={(e) => void submit(e)} className="space-y-5" noValidate>
        <FormError message={formError} />
        {dup && (
          <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-[var(--color-warn)] bg-[var(--color-warn-soft)] p-3 text-sm">
            <span>קיים לקוח עם הטלפון הזה{dup.name ? <>: <strong>{dup.name}</strong></> : ' (מנקודה אחרת)'}.</span>
            <Button size="sm" variant="primary" onClick={() => { upd({ clientMode: 'existing', clientId: dup.clientId, clientName: dup.name ?? d.clientName }); setDup(null); setFormError(null); }}>שיוך ללקוח הקיים</Button>
            <Button size="sm" onClick={(e) => void submit(e as unknown as FormEvent, true)}>פתיחת כרטיס נפרד בכל זאת</Button>
          </div>
        )}

        <Card title="לקוח">
          <div className="mb-3"><Segmented label="לקוח" value={d.clientMode} onChange={(v) => upd({ clientMode: v, clientId: null })} options={[{ value: 'new', label: 'לקוח חדש' }, { value: 'existing', label: 'לקוח / מפיק קיים' }]} /></div>
          {d.clientMode === 'existing' ? (
            d.clientId ? (
              <div className="flex items-center gap-3 rounded-[10px] bg-[var(--color-brand-soft)] p-3">
                <UserCheck className="size-5 text-[var(--color-brand)]" aria-hidden />
                <span className="font-semibold">{d.clientName}</span>
                <Button size="sm" variant="ghost" onClick={() => upd({ clientId: null })}>החלפה</Button>
              </div>
            ) : (
              <div>
                <Field label="חיפוש לפי שם או טלפון" error={errors.client}>{(p) => <Input {...p} value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} autoFocus />}</Field>
                <ul className="mt-2 divide-y divide-[var(--color-border)]">
                  {clients.data?.map((c) => (
                    <li key={c.id}><button type="button" onClick={() => upd({ clientId: c.id, clientName: c.name })} className="flex w-full justify-between px-2 py-2 text-start text-sm hover:bg-[var(--color-surface-2)]"><span className="font-semibold">{c.name}</span><span className="num text-[var(--color-muted)]">{c.phone}</span></button></li>
                  ))}
                </ul>
              </div>
            )
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={mode === 'hall' ? 'שמות בני הזוג / הלקוח' : 'שם לקוח'} required error={errors.name}>{(p) => <Input {...p} value={d.clientName} onChange={(e) => upd({ clientName: e.target.value })} />}</Field>
              <Field label="טלפון" required error={errors.phone}>{(p) => <Input {...p} type="tel" inputMode="tel" dir="ltr" className="text-start" value={d.phone} onChange={(e) => upd({ phone: e.target.value })} />}</Field>
              {lookup.data && (
                <div className="sm:col-span-2 flex flex-wrap items-center gap-2 rounded-[10px] bg-[var(--color-info-soft)] p-3 text-sm">
                  <UserPlus className="size-4 text-[var(--color-info)]" aria-hidden />
                  <span>{lookup.data.hidden ? 'הטלפון כבר שייך ללקוח קיים במערכת (מנקודה אחרת).' : <>הטלפון שייך ללקוח קיים: <strong>{lookup.data.name}</strong></>}</span>
                  <Button size="sm" onClick={() => upd({ clientMode: 'existing', clientId: lookup.data!.id, clientName: lookup.data!.name ?? d.clientName ?? 'לקוח קיים' })}>שיוך ללקוח הקיים</Button>
                </div>
              )}
              {mode === 'direct' && (
                <>
                  <Field label="סוג לקוח">{(p) => <Select {...p} value={d.clientKind} onChange={(e) => upd({ clientKind: e.target.value })} options={optionsOf(CLIENT_KIND)} />}</Field>
                  <Field label="מייל" error={errors.email}>{(p) => <Input {...p} type="email" dir="ltr" className="text-start" value={d.email} onChange={(e) => upd({ email: e.target.value })} />}</Field>
                  {d.clientKind !== 'private' && <Field label="חברה">{(p) => <Input {...p} value={d.company} onChange={(e) => upd({ company: e.target.value })} />}</Field>}
                </>
              )}
            </div>
          )}
        </Card>

        <Card title="פרטי האירוע">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="נקודה" required>{(p) => <Select {...p} value={d.venue} onChange={(e) => { upd({ venue: e.target.value as VenueCode, ...fromVenue(e.target.value as VenueCode) }); setHallEdit(false); }} options={venues.map((v) => ({ value: v, label: VENUE_LABEL[v] }))} />}</Field>
            <Field label="סוג אירוע" required>{(p) => <Select {...p} value={eventType} onChange={(e) => upd({ eventType: e.target.value, serviceKind: e.target.value === 'platters' ? 'platters' : d.serviceKind })} options={types.map((t) => ({ value: t, label: EVENT_TYPES[t] }))} />}</Field>
            {rules.siteDetails && <Field label="סוג שירות">{(p) => <Select {...p} value={d.serviceKind} onChange={(e) => upd({ serviceKind: e.target.value as 'full' })} options={[{ value: 'full', label: 'אירוע מלא עם צוות' }, { value: 'platters', label: 'מגשים / מסירה' }]} />}</Field>}
            <div>
              <Field label={mode === 'direct' ? 'תאריך מבוקש' : 'תאריך'} required error={errors.date}>{(p) => <Input {...p} type="date" min={today()} value={d.date} onChange={(e) => { upd({ date: e.target.value }); setOverbook(false); }} />}</Field>
              <AvailabilityNote venue={d.venue} date={d.date} />
              {errors.date?.includes('מלא') && auth.supervisor && <div className="mt-1"><Checkbox label="לקבוע בכל זאת – יהיו ביום הזה יותר אירועים מהמקסימום שהוגדר" checked={overbook} onChange={setOverbook} /></div>}
            </div>
            {d.serviceKind === 'platters' ? (
              <Field label="שעת מסירה" error={errors.deliveryTime}>{(p) => <Input {...p} type="time" value={d.deliveryTime} onChange={(e) => upd({ deliveryTime: e.target.value })} />}</Field>
            ) : (
              <>
                <Field label="שעת התחלה" error={errors.startTime}>{(p) => <Input {...p} type="time" value={d.startTime} onChange={(e) => upd({ startTime: e.target.value })} />}</Field>
                <Field label="שעת סיום" error={errors.endTime}>{(p) => <Input {...p} type="time" value={d.endTime} onChange={(e) => upd({ endTime: e.target.value })} />}</Field>
              </>
            )}
            <Field label={mode === 'direct' ? 'כמות משוערת' : 'אורחים'} error={errors.guests}>{(p) => <NumberInput {...p} value={d.guests} onChange={(v) => upd({ guests: v })} />}</Field>
            {mode === 'hall' && <Field label="מתוכם ילדים">{(p) => <NumberInput {...p} value={d.kids} onChange={(v) => upd({ kids: v })} />}</Field>}
            <Field label="סוג תפריט מבוקש">{(p) => <Input {...p} value={d.menuType} onChange={(e) => upd({ menuType: e.target.value })} placeholder="למשל: בשרי מוגש, בופה חלבי" />}</Field>
            <Field label="כשרות">{(p) => <Select {...p} value={d.kosher} onChange={(e) => upd({ kosher: e.target.value })} options={optionsOf(KOSHER)} />}</Field>
          </div>
          {mode === 'direct' && <div className="mt-2"><Checkbox label="התאריך גמיש" checked={d.dateFlexible} onChange={(v) => upd({ dateFlexible: v })} /></div>}
        </Card>

        {rules.siteDetails && (
          <Card title="פרטי אתר">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="כתובת" className="sm:col-span-2">{(p) => <Input {...p} value={d.address} onChange={(e) => upd({ address: e.target.value })} />}</Field>
              <Field label="איש קשר בשטח">{(p) => <Input {...p} value={d.siteContactName} onChange={(e) => upd({ siteContactName: e.target.value })} />}</Field>
              <Field label="טלפון בשטח" error={errors.siteContactPhone}>{(p) => <Input {...p} type="tel" dir="ltr" className="text-start" value={d.siteContactPhone} onChange={(e) => upd({ siteContactPhone: e.target.value })} />}</Field>
              <Field label="דרישות המקום" className="sm:col-span-2" hint="חשמל, גז, גישה, מעלית, חניה לרכב קירור…">{(p) => <Textarea {...p} value={d.siteRequirements} onChange={(e) => upd({ siteRequirements: e.target.value })} />}</Field>
            </div>
          </Card>
        )}

        {mode === 'hall' ? (
          <Card title="קליטה מהאולם">
            <div className="grid gap-4 sm:grid-cols-2">
              {hallEdit ? (
                <>
                  <Field label="איש קשר באולם">{(p) => <Input {...p} value={d.hallContactName} onChange={(e) => upd({ hallContactName: e.target.value })} />}</Field>
                  <Field label="טלפון האולם" error={errors.hallContactPhone}>{(p) => <Input {...p} type="tel" dir="ltr" className="text-start" value={d.hallContactPhone} onChange={(e) => upd({ hallContactPhone: e.target.value })} />}</Field>
                  <Field label="גורם משלם">{(p) => <Input {...p} value={d.payer} onChange={(e) => upd({ payer: e.target.value })} />}</Field>
                </>
              ) : (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[10px] bg-[var(--color-surface-2)] p-3 text-sm sm:col-span-2">
                  <span><span className="text-[var(--color-muted)]">איש קשר באולם:</span> {d.hallContactName || '—'}{d.hallContactPhone && <> · <span className="num" dir="ltr">{d.hallContactPhone}</span></>}</span>
                  <span><span className="text-[var(--color-muted)]">משלם:</span> {d.payer || '—'}</span>
                  <span className="text-xs text-[var(--color-muted)]">קבוע ל{VENUE_LABEL[d.venue]} (בהגדרות הנקודה)</span>
                  <Button size="sm" variant="ghost" className="ms-auto" onClick={() => setHallEdit(true)}>שינוי לאירוע הזה</Button>
                </div>
              )}
              <Field label="מנהל אירוע">{(p) => <Select {...p} value={d.eventManagerId} onChange={(e) => upd({ eventManagerId: e.target.value })} placeholder="ייקבע בהמשך" options={managers.map((u) => ({ value: u.id, label: u.name }))} />}</Field>
              <Field label="מה עדיין טעון השלמה" className="sm:col-span-2" hint="ייפתח מעקב השלמה למנהל המותג">{(p) => <Textarea {...p} value={d.intakeMissing} onChange={(e) => upd({ intakeMissing: e.target.value })} rows={2} />}</Field>
            </div>
          </Card>
        ) : (
          <Card title="שיווק ומעקב">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="מקור הפנייה">{(p) => <Select {...p} value={d.source} onChange={(e) => upd({ source: e.target.value })} placeholder="לא ידוע" options={settings.lists.leadSources.map((x) => ({ value: x, label: x }))} />}</Field>
              <Field label="קמפיין">{(p) => <Input {...p} value={d.campaign} onChange={(e) => upd({ campaign: e.target.value })} />}</Field>
              <Field label="תיעוד השיחה הראשונה" className="sm:col-span-2">{(p) => <Textarea {...p} value={d.firstNote} onChange={(e) => upd({ firstNote: e.target.value })} placeholder="מה הלקוח ביקש, מה הובטח, מתי לחזור" />}</Field>
            </div>
          </Card>
        )}

        <Card title="בקשות מיוחדות">
          <Textarea aria-label="בקשות מיוחדות" value={d.specialRequests} onChange={(e) => upd({ specialRequests: e.target.value })} rows={2} />
        </Card>

        <div className="sticky bottom-0 -mx-4 flex flex-wrap justify-end gap-2 border-t border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0">
          <Button onClick={() => { sessionStorage.removeItem(draftKey); setD(initial); }}>ניקוי טופס</Button>
          <Button type="submit" variant="primary" size="lg" loading={busy}>{mode === 'hall' ? 'קליטת האירוע' : 'שמירת הפנייה'}</Button>
        </div>
      </form>
    </div>
  );
}
