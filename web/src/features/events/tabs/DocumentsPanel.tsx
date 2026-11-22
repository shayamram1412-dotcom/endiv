import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, FileText, Trash2, Download } from 'lucide-react';
import { api, ApiError, qs } from '../../../lib/api.ts';
import { useAction } from '../../../lib/query.ts';
import { useToast } from '../../../ui/Toast.tsx';
import { Card, EmptyState, QueryView } from '../../../ui/layout.tsx';
import { Button } from '../../../ui/Button.tsx';
import { Badge } from '../../../ui/Badge.tsx';
import { FormError, Select, optionsOf } from '../../../ui/form.tsx';
import { DOC_KIND } from '@shared/domain.ts';
import { formatTs } from '@shared/dates.ts';
import type { DocumentRecord } from '@shared/types.ts';

/** Documents attached to a client; on an event page, scoped to that event. */
export function DocumentsPanel({ eventId, clientId, canEdit, events }: { eventId: number | null; clientId: number | null; canEdit: boolean; events?: { id: number; title: string }[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = ['documents', eventId ? { event: eventId } : { client: clientId }];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<DocumentRecord[]>(`/documents${qs(eventId ? { event: eventId } : { client: clientId })}`), enabled: !!(eventId || clientId) });
  const [kind, setKind] = useState('contract');
  const [forEvent, setForEvent] = useState<string>(eventId ? String(eventId) : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const del = useAction((id: number) => api.del(`/documents/${id}`), { success: 'המסמך נמחק', invalidate: [key, ['event']] });

  const upload = async (file: File) => {
    setBusy(true); setErr(null);
    const fd = new FormData();
    fd.set('file', file);
    fd.set('kind', kind);
    if (clientId) fd.set('clientId', String(clientId));
    if (forEvent) fd.set('eventId', forEvent);
    try {
      await api.upload('/documents', fd);
      toast.success('המסמך הועלה');
      await qc.invalidateQueries({ queryKey: key });
      await qc.invalidateQueries({ queryKey: ['event'] });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'ההעלאה נכשלה');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <Card title="מסמכים" actions={canEdit && (
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="סוג מסמך" value={kind} onChange={(e) => setKind(e.target.value)} options={optionsOf(DOC_KIND)} className="h-8 w-36 py-0 text-sm" />
        {!eventId && events && <Select aria-label="שיוך לאירוע" value={forEvent} onChange={(e) => setForEvent(e.target.value)} placeholder="כללי ללקוח" options={events.map((e) => ({ value: e.id, label: e.title }))} className="h-8 w-48 py-0 text-sm" />}
        <input ref={input} type="file" className="sr-only" id={`up-${eventId ?? clientId}`} accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.doc,.docx,.xls,.xlsx,.txt" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
        <Button size="sm" variant="primary" icon={<Upload className="size-4" />} loading={busy} onClick={() => input.current?.click()}>העלאה</Button>
      </div>
    )} bodyClass="p-0">
      {err && <div className="p-3"><FormError message={err} /></div>}
      <QueryView q={q} empty={(l) => (l.length ? null : <EmptyState title="אין מסמכים" text="חוזה חתום, הצעות מחיר, תפריט מאושר וקבלות." />)}>
        {(list) => (
          <ul className="divide-y divide-[var(--color-border)]">
            {list.map((doc) => (
              <li key={doc.id} className="flex items-center gap-3 px-4 py-3">
                <FileText className="size-5 shrink-0 text-[var(--color-muted)]" aria-hidden />
                <div className="min-w-0 flex-1">
                  <a href={`/api/documents/${doc.id}/download`} target="_blank" rel="noreferrer" className="block truncate font-semibold hover:text-[var(--color-brand)] hover:underline">{doc.name}</a>
                  <div className="text-xs text-[var(--color-muted)]">{doc.uploadedByName} · {formatTs(doc.at)} · {Math.ceil(doc.size / 1024)}KB{!eventId && doc.eventTitle ? ` · ${doc.eventTitle}` : ''}</div>
                </div>
                <Badge>{DOC_KIND[doc.kind]}</Badge>
                <a href={`/api/documents/${doc.id}/download`} download className="grid size-8 place-items-center rounded-lg hover:bg-[var(--color-surface-2)]" aria-label={`הורדת ${doc.name}`}><Download className="size-4" /></a>
                {canEdit && <Button size="sm" variant="ghost" aria-label={`מחיקת ${doc.name}`} onClick={() => { if (window.confirm(`למחוק את ${doc.name}?`)) del.mutate(doc.id); }}><Trash2 className="size-4 text-[var(--color-danger)]" /></Button>}
              </li>
            ))}
          </ul>
        )}
      </QueryView>
    </Card>
  );
}
