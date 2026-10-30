import React from 'react';
import Link from 'next/link';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANT: Record<Variant, string> = {
  primary:   'btn-primary',
  secondary: 'btn-secondary',
  danger:    'btn-danger',
  ghost:     'inline-flex items-center justify-center gap-1.5 text-sm font-medium px-3 py-2 rounded-ctl text-muted hover:bg-stone-100 hover:text-ink-800 transition-colors',
};

interface Props {
  variant?:   Variant;
  href?:      string;
  className?: string;
  children:   React.ReactNode;
}

type ButtonProps = Props & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof Props>;

// Unico punto in cui si definisce l'aspetto di un bottone: con `href` diventa un link.
export function Button({ variant = 'secondary', href, className = '', children, ...rest }: ButtonProps) {
  const cls = `${VARIANT[variant]} ${className}`.trim();
  if (href) return <Link href={href} className={cls}>{children}</Link>;
  return <button type="button" className={cls} {...rest}>{children}</button>;
}
