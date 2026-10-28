'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Esito, StatoFile } from '@/lib/ferrari';
import { STATI } from '@/lib/ferrari';

const SCHEDE = [
  { href: '/ferrari',            label: 'Commesse' },
  { href: '/ferrari/componenti', label: 'Componenti' },
  { href: '/ferrari/schede',     label: 'Revisione' },
  { href: '/ferrari/scambio',    label: 'Scambio con la IA' },
  { href: '/ferrari/conoscenza', label: 'Conoscenza' },
  { href: '/ferrari/consulta',   label: 'Consulta' },
];

export function Cella({ testo, intero }: { testo?: string; intero?: string }) {
  if (!testo) return <span className="text-gray-300">—</span>;
  if (testo === 'Sì') return <span className="font-bold text-green-600" title={intero}>Sì</span>;
  if (testo === 'Extra campionario') return <span className="font-bold text-amber-700" title={intero}>Extra campionario</span>;
  let testa: React.ReactNode = null;
  let corpo = testo;
  if (testo.startsWith('Sì — ')) { testa = <span className="font-bold text-green-600">Sì </span>; corpo = testo.slice(5); }
  else if (testo.startsWith('Extra campionario — ')) { testa = <span className="font-bold text-amber-700">Extra campionario </span>; corpo = testo.slice(20); }
  // più pezzi distinti (es. due livree): uno per riga
  const pezzi = corpo.split(' | ');
  return (
    <span title={intero}>
      {testa}
      {pezzi.length > 1
        ? pezzi.map((p, i) => <div key={i} className={i > 0 ? 'mt-1 border-t border-dashed border-gray-200 pt-1' : ''}>{p}</div>)
        : corpo}
    </span>
  );
}

export function FerrariNav() {
  const pathname = usePathname();
  const attiva = (href: string) => {
    if (href === '/ferrari') return pathname === '/ferrari';
    if (href === '/ferrari/schede') return pathname.startsWith('/ferrari/schede') || /^\/ferrari\/\d+/.test(pathname);
    return pathname.startsWith(href);
  };
  const avanzate = SCHEDE.slice(2);
  const inAvanzate = avanzate.some(s => attiva(s.href));
  const cls = (on: boolean) =>
    `px-4 py-2 text-sm font-medium rounded-t-lg -mb-px border-b-2 transition-colors ${
      on ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`;
  return (
    <nav className="flex flex-wrap items-center gap-1 border-b border-gray-200 mb-6">
      {SCHEDE.slice(0, 2).map(s => <Link key={s.href} href={s.href} className={cls(attiva(s.href))}>{s.label}</Link>)}
      {/* il flusso a revisione completa non serve nell'uso quotidiano: resta raggiungibile da qui */}
      <details className="relative" open={inAvanzate}>
        <summary className={`${cls(inAvanzate)} cursor-pointer list-none`}>Avanzate</summary>
        <div className="flex flex-wrap gap-1">
          {avanzate.map(s => (
            <Link key={s.href} href={s.href} className={cls(attiva(s.href))}>{s.label}</Link>
          ))}
        </div>
      </details>
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
