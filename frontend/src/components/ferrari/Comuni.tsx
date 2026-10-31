'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Esito, StatoFile } from '@/lib/ferrari';
import { STATI } from '@/lib/ferrari';
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge';

export function Cella({ testo, intero }: { testo?: string; intero?: string }) {
  if (!testo) return <span className="text-stone-300">—</span>;
  if (testo === 'Sì') return <span className="font-bold text-success" title={intero}>Sì</span>;
  if (testo === 'Extra campionario') return <span className="font-bold text-warning" title={intero}>Extra campionario</span>;
  let testa: React.ReactNode = null;
  let corpo = testo;
  if (testo.startsWith('Sì — ')) { testa = <span className="font-bold text-success">Sì </span>; corpo = testo.slice(5); }
  else if (testo.startsWith('Extra campionario — ')) { testa = <span className="font-bold text-warning">Extra campionario </span>; corpo = testo.slice(20); }
  // più pezzi distinti (es. due livree): uno per riga
  const pezzi = corpo.split(' | ');
  return (
    <span title={intero}>
      {testa}
      {pezzi.length > 1
        ? pezzi.map((p, i) => <div key={i} className={i > 0 ? 'mt-1 border-t border-dashed border-line pt-1' : ''}>{p}</div>)
        : corpo}
    </span>
  );
}

/** Come si guarda la tabella: per sigle (colonne) o per componente (paraurti, spoiler...). Pestanas come nelle altre pagine. */
export function VistaToggle() {
  const pathname = usePathname();
  const cls = (on: boolean) => `whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${on ? 'bg-ink-800 text-white' : 'text-muted hover:bg-stone-100 hover:text-ink-900'}`;
  return (
    <div className="d-print-none mb-6 inline-flex gap-1 rounded-full bg-white p-1 shadow-card">
      <Link href="/ferrari" className={cls(pathname === '/ferrari')}>Per sigle</Link>
      <Link href="/ferrari/componenti" className={cls(pathname.startsWith('/ferrari/componenti'))}>Per componente</Link>
    </div>
  );
}

const STATO_TONE: Record<StatoFile, Tone> = {
  QUARANTENA:     'danger',
  IN_ATTESA_IA:   'info',
  IN_REVISIONE:   'warning',
  ACCETTATO_AUTO: 'success',
  VALIDATO:       'success',
  RIFIUTATO:      'neutral',
  SOSTITUITO:     'neutral',
};

export function StatoBadge({ stato }: { stato: StatoFile }) {
  const label = STATI.find(s => s.value === stato)?.label ?? stato;
  return <StatusBadge tone={STATO_TONE[stato] ?? 'neutral'}>{label}</StatusBadge>;
}

const ESITO_CLS: Record<Esito, string> = {
  VERDE: 'bg-green-500', AMBRA: 'bg-amber-400', ROSSO: 'bg-red-500',
};

export function EsitoDot({ esito, mostraTesto = true }: { esito: Esito | null; mostraTesto?: boolean }) {
  if (!esito) return <span className="text-stone-300">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-700">
      <span className={`inline-block w-2.5 h-2.5 rounded-full ${ESITO_CLS[esito]}`} />
      {mostraTesto && esito}
    </span>
  );
}

export function Errore({ messaggio }: { messaggio: string | null }) {
  if (!messaggio) return null;
  return <div className="mb-4 rounded-ctl bg-danger-soft border border-danger/30 text-danger text-sm px-4 py-2">{messaggio}</div>;
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

const btnFix = 'rounded-full border border-line bg-white px-2 py-0 text-xs hover:bg-stone-50';

/** Un errore di scrittura dentro un testo (es. TLM15 al posto di TLM16) con i pulsanti per correggerlo. */
export function SottoSigla({ x, modello, onFatto, onErrore }: {
  x: { codice: string; testo: string; avviso: string | null; scritto?: string | null }; modello: string; onFatto: () => void; onErrore: (m: string) => void;
}) {
  const correggibile = !!x.scritto && /^[A-Z0-9]{3,8}$/.test(x.scritto) && !/corretta in/.test(x.avviso ?? '');
  const vai = (az: Correzione) => correggiCodice(modello, x.scritto!, x.codice, az).then(ok => ok && onFatto()).catch(e => onErrore((e as Error).message));
  return (
    <div className="mt-1 rounded-ctl border-l-[3px] border-line bg-white/60 px-2 py-0.5 text-xs text-ink-700">
      {x.avviso && (
        <div className="font-semibold text-warning">
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
        <div key={i} className="text-xs font-semibold text-warning">
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
