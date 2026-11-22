import { forwardRef, useId, useState, useEffect, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import clsx from 'clsx';
import { parseShekels, toShekelInput } from '@shared/money.ts';

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: (p: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) => ReactNode;
}

/** Label + control + error right next to it (spec: "הסבר לשגיאה ליד השדה"). */
export function Field({ label, error, hint, required, className, children }: FieldProps) {
  const id = useId();
  const descId = error || hint ? `${id}-desc` : undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {label}
        {required && <span className="text-[var(--color-danger)]" aria-hidden> *</span>}
      </label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': descId })}
      {error ? (
        <p id={descId} className="mt-1 text-xs font-medium text-[var(--color-danger)]" role="alert">{error}</p>
      ) : hint ? (
        <p id={descId} className="mt-1 text-xs text-[var(--color-muted)]">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={clsx('input', className)} {...p} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, rows = 3, ...p }, ref) {
  return <textarea ref={ref} rows={rows} className={clsx('input min-h-[auto] leading-relaxed', className)} {...p} />;
});

export function Select({ className, options, placeholder, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string | number; label: string }[]; placeholder?: string }) {
  return (
    <select className={clsx('input pe-8', className)} {...p}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export const optionsOf = (rec: Record<string, string>) => Object.entries(rec).map(([value, label]) => ({ value, label }));

/** Number input that reports numbers (or null when empty). */
export function NumberInput({ value, onChange, min = 0, step, ...p }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <input type="number" inputMode="decimal" className="input num text-start" min={min} step={step}
      value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} {...p} />
  );
}

/** Money input in shekels; emits integer agorot. */
export function MoneyInput({ value, onChange, ...p }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: number | null; onChange: (agorot: number | null) => void }) {
  const [text, setText] = useState(toShekelInput(value));
  useEffect(() => {
    if (parseShekels(text) !== value) setText(toShekelInput(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className="relative">
      <input inputMode="decimal" className="input num ps-7 text-start" value={text}
        onChange={(e) => { setText(e.target.value); onChange(parseShekels(e.target.value)); }} {...p} />
      <span className="pointer-events-none absolute inset-y-0 start-2.5 grid place-items-center text-[var(--color-muted)]" aria-hidden>₪</span>
    </div>
  );
}

export function Checkbox({ label, checked, onChange, disabled, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string }) {
  return (
    <label className={clsx('flex cursor-pointer items-start gap-2.5 py-1', disabled && 'cursor-not-allowed opacity-60')}>
      <input type="checkbox" className="mt-1 size-[18px] accent-[var(--color-brand)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="text-sm">{label}</span>
        {hint && <span className="block text-xs text-[var(--color-muted)]">{hint}</span>}
      </span>
    </label>
  );
}

/** Shows server-side validation summary at the top of a form. */
export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return <div role="alert" className="rounded-[10px] border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-3 py-2 text-sm font-medium text-[var(--color-danger)]">{message}</div>;
}

/** After a failed save, bring the first field with an error into view and focus it. */
export function focusFirstError(): void {
  setTimeout(() => {
    const el = document.querySelector<HTMLElement>('[aria-invalid="true"]') ?? document.querySelector<HTMLElement>('[role="alert"]');
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (el.matches('input, select, textarea')) el.focus({ preventScroll: true });
  }, 60);
}
