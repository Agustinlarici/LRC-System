'use client';

import { StatusBadge } from '@/components/ui/StatusBadge';

export interface Passo { cerca: string[]; finestra: number | null }
export interface Condizione { passi: Passo[] }
export interface Regola {
  id?: number; nome: string; attiva: boolean; article_code: string; prezzo: number;
  logica: 'tutte' | 'qualsiasi'; condizioni: Condizione[]; eccezioni: Condizione[];
}

export const nuovaRegola = (): Regola => ({ nome: '', attiva: true, article_code: '*', prezzo: 0, logica: 'tutte', condizioni: [], eccezioni: [] });

/** Toglie vuoti prima di salvare (le alternative vuote e i passi senza parole non hanno senso). */
export function pulisciRegola(r: Regola): Regola {
  const pulisci = (cs: Condizione[]) => cs
    .map(c => ({ passi: c.passi.map(p => ({ cerca: p.cerca.map(s => s.trim()).filter(Boolean), finestra: p.finestra })).filter(p => p.cerca.length > 0) }))
    .filter(c => c.passi.length > 0);
  return { ...r, nome: r.nome.trim(), article_code: r.article_code.trim() || '*', condizioni: pulisci(r.condizioni), eccezioni: pulisci(r.eccezioni) };
}

const sparse = 'input !w-auto';

function EditorCondizioni({ condizioni, onChange, manage, vuoto }: {
  condizioni: Condizione[]; onChange: (c: Condizione[]) => void; manage: boolean; vuoto: string;
}) {
  const setPasso = (i: number, j: number, p: Partial<Passo>) =>
    onChange(condizioni.map((c, k) => (k === i ? { passi: c.passi.map((x, m) => (m === j ? { ...x, ...p } : x)) } : c)));
  return (
    <div className="space-y-2">
      {condizioni.length === 0 && <p className="text-sm text-muted">{vuoto}</p>}
      {condizioni.map((c, i) => (
        <div key={i} className="rounded-ctl border border-line bg-stone-50 p-3">
          <div className="space-y-2">
            {c.passi.map((p, j) => (
              <div key={j} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-20 shrink-0 text-muted">{j === 0 ? 'cerca' : 'poi cerca'}</span>
                <input className={`${sparse} min-w-[14rem] flex-1`} placeholder="PPE1, @COLORI, OPACO…" aria-label="Parole da cercare (alternative separate da virgola)"
                  value={p.cerca.join(', ')} disabled={!manage}
                  onChange={e => setPasso(i, j, { cerca: e.target.value.split(',').map(s => s.trimStart()) })} />
                <span className="text-muted">{j === 0 ? '— entro i primi' : '— entro'}</span>
                <input className={`${sparse} w-20`} type="number" min={1} placeholder="ovunque" aria-label="Finestra in caratteri"
                  value={p.finestra ?? ''} disabled={!manage}
                  onChange={e => setPasso(i, j, { finestra: e.target.value ? Number(e.target.value) : null })} />
                <span className="text-muted">{j === 0 ? 'car.' : 'car. dopo'}</span>
                {manage && (
                  <button type="button" className="btn-secondary !px-2.5 !py-1.5" aria-label="Elimina passo"
                    onClick={() => onChange(condizioni.map((x, k) => (k === i ? { passi: x.passi.filter((_, m) => m !== j) } : x)).filter(x => x.passi.length > 0))}>×</button>
                )}
              </div>
            ))}
          </div>
          {manage && (
            <div className="mt-2 flex gap-2">
              {c.passi.length < 8 && (
                <button type="button" className="btn-secondary !px-3 !py-1 !text-xs"
                  onClick={() => onChange(condizioni.map((x, k) => (k === i ? { passi: [...x.passi, { cerca: [''], finestra: null }] } : x)))}>+ Passo</button>
              )}
              <button type="button" className="btn-secondary !px-3 !py-1 !text-xs" onClick={() => onChange(condizioni.filter((_, k) => k !== i))}>Elimina condizione</button>
            </div>
          )}
        </div>
      ))}
      {manage && (
        <button type="button" className="btn-secondary !px-3 !py-1.5 !text-xs"
          onClick={() => onChange([...condizioni, { passi: [{ cerca: [''], finestra: null }] }])}>+ Condizione</button>
      )}
    </div>
  );
}

export function RegolaEditor({ regola, onChange, onSu, onGiu, onElimina, manage }: {
  regola: Regola; onChange: (p: Partial<Regola>) => void; onSu?: () => void; onGiu?: () => void; onElimina: () => void; manage: boolean;
}) {
  return (
    <div className={`rounded-card border border-line bg-white p-4 ${regola.attiva ? '' : 'opacity-60'}`}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1">
          <label className="label">Nome</label>
          <input className="input" value={regola.nome} disabled={!manage} onChange={e => onChange({ nome: e.target.value })} />
        </div>
        <div className="w-40">
          <label className="label">Codice (* = tutti)</label>
          <input className="input" value={regola.article_code} disabled={!manage} onChange={e => onChange({ article_code: e.target.value })} />
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

      <div className="mt-4 space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-900">
          <span>SE</span>
          <select className="input !w-auto !py-1" value={regola.logica} disabled={!manage}
            onChange={e => onChange({ logica: e.target.value as Regola['logica'] })}>
            <option value="tutte">tutte</option>
            <option value="qualsiasi">qualsiasi</option>
          </select>
          <span>queste condizioni:</span>
          {regola.condizioni.length === 0 && <StatusBadge tone="info">Prezzo base del codice</StatusBadge>}
        </div>
        <EditorCondizioni condizioni={regola.condizioni} manage={manage} onChange={condizioni => onChange({ condizioni })}
          vuoto="Nessuna condizione: la regola vale sempre per questo codice." />
      </div>

      <div className="mt-4 space-y-2 border-t border-line pt-4">
        <div className="text-sm font-medium text-ink-900">ECCETTO SE <span className="font-normal text-muted">(basta che una combaci e la regola non si applica)</span></div>
        <EditorCondizioni condizioni={regola.eccezioni} manage={manage} onChange={eccezioni => onChange({ eccezioni })} vuoto="Nessuna eccezione." />
      </div>
    </div>
  );
}
