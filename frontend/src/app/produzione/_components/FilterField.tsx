import React from 'react';

// Campo filtro con etichetta sopra: stessa altezza e allineamento in tutti i fogli.
export function FilterField({ label, highlight, children }: { label: string; highlight?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className={`text-xs font-medium ${highlight ? 'text-accent-ink' : 'text-muted'}`}>{label}</label>
      {children}
    </div>
  );
}
