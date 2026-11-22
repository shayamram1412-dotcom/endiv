import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api.ts';
import { Button } from '../../ui/Button.tsx';
import { Field, FormError, Input } from '../../ui/form.tsx';
import { ROLES, type Role } from '@shared/permissions.ts';
import { VENUE_LABEL, type VenueCode } from '@shared/domain.ts';

export function LoginPage() {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const demo = useQuery({ queryKey: ['demo-users'], queryFn: () => api.get<{ email: string; name: string; roles: string }[]>('/auth/demo-users') });

  const login = async (e: string, p: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/login', { email: e, password: p });
      await qc.invalidateQueries({ queryKey: ['me'] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'שגיאה בהתחברות');
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); void login(email, password); };

  return (
    <div className="grid min-h-dvh place-items-center bg-[var(--color-bg)] p-4">
      <div className="w-full max-w-4xl gap-6 lg:grid lg:grid-cols-[1fr_1.1fr]">
        <div className="card p-6 sm:p-8">
          <div className="mb-6 flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-xl bg-[var(--color-brand)] text-xl font-black text-[var(--color-on-brand)]" aria-hidden>מ</div>
            <div>
              <h1 className="text-xl font-extrabold">מטבחון</h1>
              <p className="text-sm text-[var(--color-muted)]">ניהול אירועים, מטבח ותפעול</p>
            </div>
          </div>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <FormError message={error} />
            <Field label="מייל" required>{(p) => <Input {...p} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" />}</Field>
            <Field label="סיסמה" required>{(p) => <Input {...p} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" />}</Field>
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>כניסה</Button>
          </form>
        </div>
        {!!demo.data?.length && (
          <div className="card mt-4 p-5 lg:mt-0">
            <h2 className="font-bold">סביבת הדגמה – כניסה לפי תפקיד</h2>
            <p className="mb-3 text-sm text-[var(--color-muted)]">כל משתמש רואה את המערכת לפי ההרשאות שלו. סיסמה: <span className="num font-semibold">demo1234</span></p>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {demo.data.map((u) => (
                <li key={u.email}>
                  <button disabled={busy} onClick={() => void login(u.email, 'demo1234')}
                    className="w-full rounded-[10px] border border-[var(--color-border)] px-3 py-2 text-start transition-colors hover:border-[var(--color-brand)] hover:bg-[var(--color-brand-soft)]">
                    <div className="text-sm font-semibold">{u.name}</div>
                    <div className="truncate text-xs text-[var(--color-muted)]">
                      {u.roles.split(',').map((r) => { const [role, venue] = r.split(':'); return `${ROLES[role as Role]}${venue !== '*' ? ` · ${VENUE_LABEL[venue as VenueCode]}` : ''}`; }).join(', ')}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
