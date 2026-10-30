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

/** Si parte sempre da «Vedere»: le Impostazioni (cartella, sigle, modelli, componenti) stanno dietro l'ingranaggio in alto a destra. */
export function FerrariNav({ badge = 0 }: { badge?: number }) {
  const pathname = usePathname();
  const inImpostazioni = pathname.startsWith('/ferrari/impostazioni') || pathname.startsWith('/ferrari/schede') || pathname.startsWith('/ferrari/scambio')
    || pathname.startsWith('/ferrari/conoscenza') || pathname.startsWith('/ferrari/consulta') || /^\/ferrari\/\d+/.test(pathname);
  return (
    <nav className="d-print-none flex items-center justify-between mb-4">
      {inImpostazioni
        ? <Link href="/ferrari" className="text-sm font-medium text-blue-700 hover:underline">← Vedere</Link>
        : <span />}
      {pathname.startsWith('/ferrari/impostazioni')
        ? <span />
        : (
          <Link href="/ferrari/impostazioni" title="Impostazioni" aria-label="Impostazioni"
            className="relative rounded-full border border-gray-200 bg-white p-2 text-gray-600 hover:bg-gray-50 hover:text-gray-900">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            {badge > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-amber-500 px-1.5 text-[11px] font-bold leading-4 text-white">{badge}</span>}
          </Link>
        )}
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

type Correzione = 'alias' | 'altro' | 'no' | 'nonsigla';

/** Correzione di un codice scritto male: «È X» (si ricorda come alias), «Correggi…» (si indica il codice giusto), «Non è una sigla» / «Non è un errore». */
export async function correggiCodice(modello: string, scritto: string, giusto: string, azione: Correzione): Promise<boolean> {
  const { api } = await import('@/lib/api');
  let alias = giusto;
  if (azione === 'altro') {
    alias = (prompt(`Qual è il codice giusto di «${scritto}»? (es. TLM15)`, giusto !== scritto ? giusto : '') ?? '').trim().toUpperCase();
    if (!alias) return false;
  }
  const body = azione === 'no' || azione === 'nonsigla'
    ? { codice: scritto, stato: azione, modelli: [modello] }
    : { codice: scritto, stato: 'alias', modelli: [modello], alias };
  await api.post('/api/ferrari/sigle/imposta', body);
  return true;
}

const btnFix = 'rounded-full border border-gray-300 bg-white px-2 py-0 text-xs hover:bg-gray-50';

/** Un errore di scrittura dentro un testo (es. TLM15 al posto di TLM16) con i pulsanti per correggerlo. */
export function SottoSigla({ x, modello, onFatto, onErrore }: {
  x: { codice: string; testo: string; avviso: string | null; scritto?: string | null }; modello: string; onFatto: () => void; onErrore: (m: string) => void;
}) {
  const correggibile = !!x.scritto && /^[A-Z0-9]{3,8}$/.test(x.scritto) && !/corretta in/.test(x.avviso ?? '');
  const vai = (az: Correzione) => correggiCodice(modello, x.scritto!, x.codice, az).then(ok => ok && onFatto()).catch(e => onErrore((e as Error).message));
  return (
    <div className="mt-1 rounded-lg border-l-[3px] border-gray-300 bg-white/60 px-2 py-0.5 text-xs text-gray-600">
      {x.avviso && (
        <div className="font-semibold text-amber-700">
          {x.avviso}
          {correggibile && (
            <span className="ml-1.5 inline-flex flex-wrap gap-1 font-normal">
              {x.codice !== x.scritto && <button className={btnFix} onClick={() => vai('alias')}>È {x.codice}</button>}
              <button className={btnFix} onClick={() => vai('altro')}>Correggi…</button>
              <button className={btnFix} onClick={() => vai('no')}>Non è un errore</button>
            </span>
          )}
        </div>
      )}
      <b>{x.codice}</b> {x.testo}
    </div>
  );
}

/** Righe dell'Excel toccate a mano (codice scritto male, colonna spostata, valore cancellato...) con la correzione proposta. */
export function AnomalieRiga({ anomalie, modello, onFatto, onErrore }: {
  anomalie: { codice: string; riga: number | null; motivo: string; suggerito: string | null }[]; modello: string; onFatto: () => void; onErrore: (m: string) => void;
}) {
  if (!anomalie?.length) return null;
  const vai = (a: { codice: string; suggerito: string | null }, az: Correzione) =>
    correggiCodice(modello, a.codice, a.suggerito || a.codice, az).then(ok => ok && onFatto()).catch(e => onErrore((e as Error).message));
  return (
    <div className="mt-1 space-y-1">
      {anomalie.map((a, i) => (
        <div key={i} className="text-xs font-semibold text-amber-700">
          {a.riga ? `Riga ${a.riga} · ` : ''}{a.codice && <b>{a.codice}</b>}{a.codice ? ': ' : ''}{a.motivo}
          {a.suggerito && (
            <span className="ml-1.5 inline-flex flex-wrap gap-1 font-normal">
              <button className={btnFix} onClick={() => vai(a, 'alias')}>È {a.suggerito}</button>
              <button className={btnFix} onClick={() => vai(a, 'altro')}>Correggi…</button>
              <button className={btnFix} onClick={() => vai(a, 'nonsigla')}>Non è una sigla</button>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
