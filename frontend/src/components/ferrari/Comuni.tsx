'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Esito, StatoFile } from '@/lib/ferrari';
import { STATI } from '@/lib/ferrari';

const SCHEDE = [
  { href: '/ferrari',            label: 'Schede' },
  { href: '/ferrari/scambio',    label: 'Scambio con la IA' },
  { href: '/ferrari/conoscenza', label: 'Conoscenza' },
  { href: '/ferrari/consulta',   label: 'Consulta' },
];

export function FerrariNav() {
  const pathname = usePathname();
  const attiva = (href: string) => (href === '/ferrari' ? pathname === '/ferrari' || /^\/ferrari\/\d+/.test(pathname) : pathname.startsWith(href));
  return (
    <nav className="flex flex-wrap gap-1 border-b border-gray-200 mb-6">
      {SCHEDE.map(s => (
        <Link key={s.href} href={s.href}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg -mb-px border-b-2 transition-colors ${
            attiva(s.href) ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
          {s.label}
        </Link>
      ))}
    </nav>
  );
}

const STATO_CLS: Record<StatoFile, string> = {
  QUARANTENA:     'bg-red-100 text-red-800',
  IN_ATTESA_IA:   'bg-sky-100 text-sky-800',
  IN_REVISIONE:   'bg-amber-100 text-amber-800',
  ACCETTATO_AUTO: 'bg-emerald-100 text-emerald-800',
  VALIDATO:       'bg-green-100 text-green-800',
  RIFIUTATO:      'bg-gray-200 text-gray-700',
  SOSTITUITO:     'bg-gray-100 text-gray-500',
};

export function StatoBadge({ stato }: { stato: StatoFile }) {
  const label = STATI.find(s => s.value === stato)?.label ?? stato;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${STATO_CLS[stato] ?? 'bg-gray-100'}`}>{label}</span>;
}

const ESITO_CLS: Record<Esito, string> = {
  VERDE: 'bg-green-500', AMBRA: 'bg-amber-400', ROSSO: 'bg-red-500',
};

export function EsitoDot({ esito, mostraTesto = true }: { esito: Esito | null; mostraTesto?: boolean }) {
  if (!esito) return <span className="text-gray-300">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700">
      <span className={`inline-block w-2.5 h-2.5 rounded-full ${ESITO_CLS[esito]}`} />
      {mostraTesto && esito}
    </span>
  );
}

export function Errore({ messaggio }: { messaggio: string | null }) {
  if (!messaggio) return null;
  return <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2">{messaggio}</div>;
}
