import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import clsx from 'clsx';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type Size = 'sm' | 'md' | 'lg';

const base = 'inline-flex items-center justify-center gap-1.5 rounded-[10px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55 whitespace-nowrap select-none';
const variants: Record<Variant, string> = {
  primary: 'bg-[var(--color-brand)] text-[var(--color-on-brand)] hover:bg-[var(--color-brand-strong)]',
  secondary: 'bg-[var(--color-surface)] text-[var(--color-ink)] border border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)]',
  ghost: 'text-[var(--color-ink-2)] hover:bg-[var(--color-surface-2)]',
  danger: 'bg-[var(--color-danger)] text-white hover:opacity-90',
  success: 'bg-[var(--color-ok)] text-white hover:opacity-90',
};
const sizes: Record<Size, string> = {
  sm: 'h-8 px-2.5 text-[13px]',
  md: 'h-10 px-3.5 text-sm',
  lg: 'h-12 px-5 text-base',
};

export function buttonClass(variant: Variant = 'secondary', size: Size = 'md', className?: string) {
  return clsx(base, variants[variant], sizes[size], className);
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest }, ref,
) {
  return (
    <button ref={ref} type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function LinkButton({ variant = 'secondary', size = 'md', className, icon, children, ...rest }: LinkProps & { variant?: Variant; size?: Size; icon?: ReactNode }) {
  return (
    <Link className={buttonClass(variant, size, className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}

export function IconButton({ label, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label}
      className={clsx('inline-grid size-10 place-items-center rounded-[10px] text-[var(--color-ink-2)] hover:bg-[var(--color-surface-2)]', className)} {...rest}>
      {children}
    </button>
  );
}
