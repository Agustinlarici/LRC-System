'use client';

import { StatusBadge } from '@/components/ui/StatusBadge';

export interface Passo { cerca: string[]; finestra: number | null }
export interface Regola { id?: number; nome: string; attiva: boolean; gruppo: string | null; prezzo: number; passi: Passo[] }

export const nuovaRegola = (): Regola => ({ nome: '', attiva: true, gruppo: null, prezzo: 0, passi: [] });
const nuovoPasso = (): Passo => ({ cerca: [''], finestra: null });

/** Toglie vuoti prima di salvare (i passi senza parole non hanno senso). */
export function pulisciRegola(r: Regola): Regola {
  const passi = r.passi
    .map(p => ({ cerca: p.cerca.map(s => s.trim()).filter(Boolean), finestra: p.finestra }))
    .filter(p => p.cerca.length > 0);
  return { ...r, nome: r.nome.trim(), passi };
}

const sparse = 'input !w-auto';

/** Una regola = un gruppo di articoli + una catena di ricerche: se un passo non trova la parola, la regola non fa nulla. */
export function RegolaEditor({ regola, gruppi, onChange, onSu, onGiu, onElimina, manage }: {
  regola: Regola; gruppi: string[]; onChange: (p: Partial<Regola>) => void; onSu?: () => void; onGiu?: () => void; onElimina: () => void; manage: boolean;
}) {
  const setPasso = (j: number, p: Partial<Passo>) => onChange({ passi: regola.passi.map((x, m) => (m === j ? { ...x, ...p } : x)) });
  const opzioni = regola.gruppo && !gruppi.includes(regola.gruppo) ? [regola.gruppo, ...gruppi] : gruppi;
  return (
    <div className={`rounded-card border border-line bg-white p-4 ${regola.attiva ? '' : 'opacity-60'}`}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1">
          <label className="label">Nome</label>
          <input className="input" value={regola.nome} disabled={!manage} onChange={e => onChange({ nome: e.target.value })} />
        </div>
        <div className="w-60">
          <label className="label">Gruppo di articoli</label>
          <select className="input" value={regola.gruppo ?? ''} disabled={!manage} onChange={e => onChange({ gruppo: e.target.value || null })}>
            <option value="">Tutti gli articoli</option>
            {opzioni.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div className="w-32">
          <label className="label">Prezzo (EUR)</label>
          <input className="input" type="number" step="0.01" value={regola.prezzo} disabled={!manage} onChange={e => onChange({ prezzo: Number(e.target.value) })} />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-ink-800">
          <input type="checkbox" checked={regola.attiva} disabled={!manage} onChange={e => onChange({ attiva: e.target.checked })} /> Attiva
        </label>
        {manage && (
          <div className="flex gap-1.5 pb-0.5">
            <button type="button" className="btn-secondary !px-2.5" disabled={!onSu} onClick={onSu} aria-label="Sposta su">↑</button>
            <button type="button" className="btn-secondary !px-2.5" disabled={!onGiu} onClick={onGiu} aria-label="Sposta giù">↓</button>
            <button type="button" className="btn-danger" onClick={onElimina}>Elimina</button>
          </div>
        )}
      </div>

      <div className="mt-4 space-y-2 rounded-ctl border border-line bg-stone-50 p-3">
        {regola.passi.length === 0 && <StatusBadge tone="info">Nessuna parola da cercare: il prezzo vale sempre per il gruppo</StatusBadge>}
        {regola.passi.map((p, j) => (
          <div key={j}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-20 shrink-0 font-medium text-ink-900">{j === 0 ? 'Cerca' : 'Poi cerca'}</span>
              <input className={`${sparse} min-w-[14rem] flex-1`} placeholder="PPE1, @COLORI, OPACO…" aria-label="Parole da cercare (alternative separate da virgola)"
                value={p.cerca.join(', ')} disabled={!manage}
                onChange={e => setPasso(j, { cerca: e.target.value.split(',').map(s => s.trimStart()) })} />
              <span className="text-muted">{j === 0 ? 'entro i primi' : 'entro'}</span>
              <input className={`${sparse} w-20`} type="number" min={1} placeholder="ovunque" aria-label="Finestra in caratteri"
                value={p.finestra ?? ''} disabled={!manage}
                onChange={e => setPasso(j, { finestra: e.target.value ? Number(e.target.value) : null })} />
              <span className="text-muted">{j === 0 ? 'car.' : 'car. dopo la precedente'}</span>
              {manage && (
                <button type="button" className="btn-secondary !px-2.5 !py-1.5" aria-label="Elimina passo"
                  onClick={() => onChange({ passi: regola.passi.filter((_, m) => m !== j) })}>×</button>
              )}
            </div>
            <p className="ml-[5.5rem] mt-1 text-xs text-muted">
              Se non la trova: la regola non fa nulla. Se la trova: {j < regola.passi.length - 1 ? 'passa al passo successivo.' : 'aggiunge il prezzo.'}
            </p>
          </div>
        ))}
        {manage && regola.passi.length < 8 && (
          <button type="button" className="btn-secondary !px-3 !py-1.5 !text-xs" onClick={() => onChange({ passi: [...regola.passi, nuovoPasso()] })}>
            {regola.passi.length === 0 ? '+ Cerca una parola' : '+ Poi cerca un’altra parola'}
          </button>
        )}
      </div>
    </div>
  );
}
