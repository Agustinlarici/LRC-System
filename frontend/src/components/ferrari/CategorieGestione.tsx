'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Errore } from '@/components/ferrari/Comuni';
import { IconaOk } from '@/components/ferrari/Icone';
import { EmptyState } from '@/components/ui/EmptyState';

interface Categoria { id: number; nome: string; ordine: number; termini: string[] }
interface Bozza { nome: string; testo: string }

const daTesto = (t: string) => t.split(/[\n,;]+/).map(x => x.trim()).filter(Boolean);
const FRECCIA = 'M5 12l5-5 5 5';

/** Impostazioni, scheda Categorie: raggruppano le colonne della tabella (es. LIVREA, DREAMLINE). Valgono per tutti i modelli. */
export function CategorieGestione() {
  const [cat, setCat] = useState<Categoria[] | null>(null);
  const [bozze, setBozze] = useState<Record<number, Bozza>>({});
  const [nuovoNome, setNuovoNome] = useState('');
  const [errore, setErrore] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [occupato, setOccupato] = useState(false);
  const [salvata, setSalvata] = useState<number | null>(null);

  const carica = useCallback(async () => {
    try {
      const { categorie } = await api.get<{ categorie: Categoria[] }>('/api/ferrari/categorie');
      setCat(categorie);
      setBozze(Object.fromEntries(categorie.map(c => [c.id, { nome: c.nome, testo: c.termini.join(', ') }])));
      setErrore(null);
    } catch (e) { setErrore((e as Error).message); }
  }, []);
  useEffect(() => { carica(); }, [carica]);

  async function esegui(f: () => Promise<unknown>) {
    setOccupato(true); setMsg(null);
    try { await f(); setErrore(null); await carica(); } catch (e) { setErrore((e as Error).message); } finally { setOccupato(false); }
  }

  const aggiungi = () => {
    const nome = nuovoNome.trim();
    if (!nome) return;
    esegui(async () => { await api.post('/api/ferrari/categorie', { nome, termini: [] }); setNuovoNome(''); });
  };
  const salva = (c: Categoria) => esegui(async () => {
    const b = bozze[c.id]!;
    await api.post('/api/ferrari/categorie', { id: c.id, nome: b.nome, termini: daTesto(b.testo) });
    setSalvata(c.id); setTimeout(() => setSalvata(null), 2000);
  });
  const elimina = (c: Categoria) => {
    if (!confirm(`Eliminare la categoria «${c.nome}»? Le colonne tornano fra le «Altre».`)) return;
    esegui(() => api.delete(`/api/ferrari/categorie/${c.id}`));
  };
  const sposta = (i: number, verso: -1 | 1) => {
    const ids = cat!.map(c => c.id);
    const j = i + verso;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    esegui(() => api.post('/api/ferrari/categorie/ordine', { ids }));
  };
  const esempio = () => esegui(async () => {
    const r = await api.post<{ aggiunte: number }>('/api/ferrari/categorie/esempio');
    setMsg(r.aggiunte ? `${r.aggiunte} categorie aggiunte: controlla i codici e correggili se serve.` : 'Le categorie di esempio ci sono già.');
  });

  if (!cat) return <Errore messaggio={errore} />;
  return (
    <div>
      <p className="mb-3 text-sm text-muted">
        Una categoria raggruppa le colonne della tabella (es. LIVREA, DREAMLINE). Scrivi i codici o le parole che la compongono, separati da virgola.
        Una colonna entra nella categoria se il suo codice è uno di questi (o comincia così), oppure se la sua descrizione contiene la parola.
        Le colonne senza categoria vanno in «Altre». Vale per tutti i modelli.
      </p>
      <Errore messaggio={errore} />
      {msg && <p className="mb-3 text-xs text-muted">{msg}</p>}

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-card border border-line bg-white px-4 py-3">
        <input className="input !w-72 !py-1" placeholder="Nuova categoria (es. LIVREA)" value={nuovoNome} maxLength={40}
          onChange={e => setNuovoNome(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') aggiungi(); }} />
        <button className="btn-primary !py-1" disabled={occupato || !nuovoNome.trim()} onClick={aggiungi}>Aggiungi</button>
        {cat.length > 0 && <button className="btn-secondary ml-auto !py-1" disabled={occupato} onClick={esempio} title="Aggiunge LIVREA, DREAMLINE, CAVAL., CARB., PLAST. e GRIGLIE se non ci sono già">Aggiungi le categorie di esempio</button>}
      </div>

      {cat.length === 0 ? (
        <div className="rounded-card border border-line bg-white">
          <EmptyState title="Nessuna categoria" hint="Senza categorie la tabella resta come prima. Creane una qui sopra, oppure parti dalle categorie di esempio."
            action={<button className="btn-primary" disabled={occupato} onClick={esempio}>Aggiungi le categorie di esempio</button>} />
        </div>
      ) : (
        <div className="space-y-3">
          {cat.map((c, i) => {
            const b = bozze[c.id] ?? { nome: c.nome, testo: c.termini.join(', ') };
            const cambiata = b.nome.trim() !== c.nome || JSON.stringify(daTesto(b.testo)) !== JSON.stringify(c.termini);
            return (
              <div key={c.id} className="rounded-card border border-line bg-white px-4 py-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="flex flex-col">
                    {([-1, 1] as const).map(v => (
                      <button key={v} className="rounded text-muted hover:text-ink-900 disabled:opacity-30" aria-label={v < 0 ? 'Sposta su' : 'Sposta giù'}
                        disabled={occupato || (v < 0 ? i === 0 : i === cat.length - 1)} onClick={() => sposta(i, v)}>
                        <svg viewBox="0 0 20 20" className={`h-4 w-4 ${v > 0 ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={FRECCIA} /></svg>
                      </button>
                    ))}
                  </span>
                  <input className="input !w-56 !py-1 font-semibold" value={b.nome} maxLength={40} aria-label="Nome della categoria"
                    onChange={e => setBozze(x => ({ ...x, [c.id]: { ...b, nome: e.target.value } }))} />
                  <span className="text-xs text-muted">{daTesto(b.testo).length} codici o parole</span>
                  <span className="ml-auto flex items-center gap-2">
                    {salvata === c.id && <span className="inline-flex items-center gap-1 text-sm text-success"><IconaOk /> Salvato</span>}
                    <button className="btn-primary !py-1" disabled={occupato || !cambiata || !b.nome.trim()} onClick={() => salva(c)}>Salva</button>
                    <button className="btn-secondary !py-1" disabled={occupato} onClick={() => elimina(c)}>Elimina</button>
                  </span>
                </div>
                <textarea className="input w-full font-mono text-xs" rows={Math.min(6, Math.max(2, Math.ceil(b.testo.length / 90)))} value={b.testo}
                  aria-label={`Codici o parole di ${c.nome}`} placeholder="PN5X, PNT5, LI01, CAVALL…"
                  onChange={e => setBozze(x => ({ ...x, [c.id]: { ...b, testo: e.target.value } }))} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
