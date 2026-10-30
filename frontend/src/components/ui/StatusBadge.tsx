import React from 'react';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand';

const TONE: Record<Tone, string> = {
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger:  'bg-danger-soft text-danger',
  info:    'bg-accent-soft text-accent-ink',
  neutral: 'bg-stone-100 text-stone-600',
  brand:   'bg-brand-soft text-brand-dark',
};

const DOT: Record<Tone, string> = {
  success: 'bg-green-600',
  warning: 'bg-amber-500',
  danger:  'bg-red-600',
  info:    'bg-accent',
  neutral: 'bg-stone-400',
  brand:   'bg-brand',
};

// Pillola di stato con pallino: i colori stanno qui e non nelle singole pagine.
export function StatusBadge({ tone = 'neutral', children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${TONE[tone]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${DOT[tone]}`} />
      {children}
    </span>
  );
}
