import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = the one coral action on a screen; secondary = outlined in cream. */
  variant?: ButtonVariant;
  small?: boolean;
  /** Shows a spinner, keeps the label, and blocks repeat presses. */
  loading?: boolean;
  children: ReactNode;
}

export function Button({ variant = 'secondary', small, loading, disabled, children, className, type, ...rest }: Props) {
  return (
    <button
      {...rest}
      type={type ?? 'button'}
      data-variant={variant}
      className={['vf-btn', small ? 'vf-btn-small' : '', className ?? ''].filter(Boolean).join(' ')}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading && <span className="vf-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}
