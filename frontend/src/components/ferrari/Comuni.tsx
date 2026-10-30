'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Esito, StatoFile } from '@/lib/ferrari';
import { STATI } from '@/lib/ferrari';

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

/** Le due pagine di tutti i giorni: Vedere (tabella) e Impostazioni (cartella, sigle, componenti). Il resto sta in Impostazioni → Avanzate. */
export function FerrariNav({ badge = 0 }: { badge?: number }) {
  const pathname = usePathname();
  const inImpostazioni = pathname.startsWith('/ferrari/impostazioni') || pathname.startsWith('/ferrari/schede') || pathname.startsWith('/ferrari/scambio')
    || pathname.startsWith('/ferrari/conoscenza') || pathname.startsWith('/ferrari/consulta') || /^\/ferrari\/\d+/.test(pathname);
  const cls = (on: boolean) =>
    `px-4 py-2 text-sm font-medium rounded-t-lg -mb-px border-b-2 transition-colors ${
      on ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`;
  return (
    <nav className="d-print-none flex flex-wrap items-center gap-1 border-b border-gray-200 mb-6">
      <Link href="/ferrari" className={cls(!inImpostazioni)}>Vedere</Link>
      <Link href="/ferrari/impostazioni" className={cls(inImpostazioni)}>
        Impostazioni
        {badge > 0 && <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white">{badge}</span>}
      </Link>
    </nav>
  );
}

/** Come si guarda la tabella: per sigle (colonne) o per componente (paraurti, spoiler...). */
export function VistaToggle() {
  const pathname = usePathname();
  const cls = (on: boolean) => `px-3 py-1.5 text-sm rounded-lg border ${on ? 'bg-gray-700 text-white border-gray-700' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`;
  return (
    <div className="d-print-none flex gap-2">
      <Link href="/ferrari" className={cls(pathname === '/ferrari')}>Per sigle</Link>
      <Link href="/ferrari/componenti" className={cls(pathname.startsWith('/ferrari/componenti'))}>Per componente</Link>
    </div>
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
