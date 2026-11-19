'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/ui/PageHeader';

interface Passo { cerca: string[]; finestra: number | null }
interface Regola { id?: number; nome: string; attiva: boolean; article_code: string; prezzo: number; passi: Passo[] }
interface Gruppo { nome: string; parole: string[] }
interface Prova { totale: number; applicate: { nome: string; prezzo: number }[] }

const inp = 'border border-gray-300 rounded-md px-2 py-1 text-sm';
const btn = 'px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50';
const lista = (t: string) => t.split(',').map(x => x.trim()).filter(Boolean);
const err = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function FatturazioneImpostazioniPage() {
  const { canManage } = useAuth();
  const manage = canManage('fatturazione');
  const [regole, setRegole] = useState<Regola[]>([]);
  const [gruppi, setGruppi] = useState<Gruppo[]>([]);
  const [conti, setConti] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pArt, setPArt] = useState('');
  const [pDesc, setPDesc] = useState('');
  const [prova, setProva] = useState<Prova | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<Regola[]>('/api/fatturazione/regole'), api.get<Gruppo[]>('/api/fatturazione/gruppi'), api.get<string[]>('/api/fatturazione/conti'),
    ]).then(([r, g, c]) => { setRegole(r); setGruppi(g); setConti(c.join(', ')); }).catch(e => setError(err(e)));
  }, []);

  async function salva<T>(fn: () => Promise<T>, ok: string) {
    setError(null); setMsg(null);
    try { await fn(); setMsg(ok); } catch (e) { setError(err(e)); }
  }
  const upd = (i: number, p: Partial<Regola>) => setRegole(rs => rs.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const updPasso = (i: number, j: number, p: Partial<Passo>) => upd(i, { passi: regole[i]!.passi.map((x, k) => (k === j ? { ...x, ...p } : x)) });

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <PageHeader title="Regole Fatturazione" back={{ label: 'Fatturazione', href: '/fatturazione' }}
        description="Il prezzo STR di una riga = somma dei prezzi delle regole che combaciano con il suo codice e la descrizione dell'ordine." />
      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">{error}</div>}
      {msg && <div className="p-3 bg-green-50 border border-green-200 rounded-md text-sm text-green-700">{msg}</div>}

      <section className="bg-white border border-gray-200 rounded-lg p-4">
        <h2 className="font-semibold mb-2">Clienti (conti) da fatturare</h2>
        <input className={`${inp} w-72`} value={conti} onChange={e => setConti(e.target.value)} disabled={!manage} />
        <span className="text-xs text-gray-500 ml-2">separati da virgola (es. C558)</span>
        {manage && <button className={`${btn} ml-3`} onClick={() => salva(() => api.put('/api/fatturazione/conti', { conti: lista(conti) }), 'Conti salvati')}>Salva</button>}
      </section>

      <section className="bg-white border border-gray-200 rounded-lg p-4">
        <h2 className="font-semibold mb-1">Gruppi di parole</h2>
        <p className="text-xs text-gray-500 mb-2">Si usano nelle regole come @NOME (es. @COLORI).</p>
        {gruppi.map((g, i) => (
          <div key={i} className="flex gap-2 mb-2">
            <input className={`${inp} w-36`} placeholder="NOME" value={g.nome} disabled={!manage} onChange={e => setGruppi(gs => gs.map((x, k) => (k === i ? { ...x, nome: e.target.value } : x)))} />
            <input className={`${inp} flex-1`} placeholder="parole, separate da virgola" value={g.parole.join(', ')} disabled={!manage}
              onChange={e => setGruppi(gs => gs.map((x, k) => (k === i ? { ...x, parole: e.target.value.split(',').map(s => s.trim()) } : x)))} />
            {manage && <button className={btn} onClick={() => setGruppi(gs => gs.filter((_, k) => k !== i))}>✕</button>}
          </div>
        ))}
        {manage && <div className="flex gap-2">
          <button className={btn} onClick={() => setGruppi(gs => [...gs, { nome: '', parole: [] }])}>+ Gruppo</button>
          <button className={btn} onClick={() => salva(() => api.put('/api/fatturazione/gruppi', { gruppi: gruppi.map(g => ({ nome: g.nome, parole: g.parole.filter(Boolean) })) }), 'Gruppi salvati')}>Salva gruppi</button>
        </div>}
      </section>

      <section className="bg-white border border-gray-200 rounded-lg p-4">
        <h2 className="font-semibold mb-1">Regole</h2>
        <p className="text-xs text-gray-500 mb-3">Senza passi = prezzo base del codice (vale sempre). 1° passo: «entro i primi N caratteri». Passi successivi: «entro N caratteri dopo il passo precedente». Vuoto = ovunque.</p>
        {regole.map((r, i) => (
          <div key={i} className={`border border-gray-200 rounded-md p-3 mb-3 ${r.attiva ? '' : 'opacity-50'}`}>
            <div className="flex flex-wrap gap-2 items-center">
              <input className={`${inp} w-48`} placeholder="Nome" value={r.nome} disabled={!manage} onChange={e => upd(i, { nome: e.target.value })} />
              <input className={`${inp} w-36`} placeholder="Codice (* = tutti)" value={r.article_code} disabled={!manage} onChange={e => upd(i, { article_code: e.target.value })} />
              <input className={`${inp} w-28`} type="number" step="0.01" value={r.prezzo} disabled={!manage} onChange={e => upd(i, { prezzo: Number(e.target.value) })} />
              <label className="text-sm"><input type="checkbox" checked={r.attiva} disabled={!manage} onChange={e => upd(i, { attiva: e.target.checked })} /> attiva</label>
              {manage && <>
                <button className={btn} disabled={i === 0} onClick={() => setRegole(rs => { const c = [...rs]; [c[i - 1], c[i]] = [c[i]!, c[i - 1]!]; return c; })}>↑</button>
                <button className={btn} onClick={() => setRegole(rs => rs.filter((_, k) => k !== i))}>Elimina</button>
              </>}
            </div>
            {r.passi.map((p, j) => (
              <div key={j} className="flex gap-2 mt-2 items-center text-sm">
                <span className="w-16 text-gray-500">{j === 0 ? 'Cerca' : 'poi cerca'}</span>
                <input className={`${inp} flex-1`} placeholder="PPE1, @COLORI, OPACO…" value={p.cerca.join(', ')} disabled={!manage}
                  onChange={e => updPasso(i, j, { cerca: e.target.value.split(',').map(s => s.trim()) })} />
                <input className={`${inp} w-24`} type="number" min={1} placeholder={j === 0 ? 'primi N' : 'dopo N'} value={p.finestra ?? ''} disabled={!manage}
                  onChange={e => updPasso(i, j, { finestra: e.target.value ? Number(e.target.value) : null })} />
                {manage && <button className={btn} onClick={() => upd(i, { passi: r.passi.filter((_, k) => k !== j) })}>✕</button>}
              </div>
            ))}
            {manage && r.passi.length < 8 && <button className={`${btn} mt-2`} onClick={() => upd(i, { passi: [...r.passi, { cerca: [''], finestra: null }] })}>+ Passo</button>}
          </div>
        ))}
        {manage && <div className="flex gap-2">
          <button className={btn} onClick={() => setRegole(rs => [...rs, { nome: '', attiva: true, article_code: '*', prezzo: 0, passi: [] }])}>+ Regola</button>
          <button className={btn} onClick={() => salva(async () => setRegole(await api.put<Regola[]>('/api/fatturazione/regole', {
            regole: regole.map(r => ({ nome: r.nome, attiva: r.attiva, article_code: r.article_code, prezzo: r.prezzo, passi: r.passi.map(p => ({ cerca: p.cerca.filter(Boolean), finestra: p.finestra })) })),
          })), 'Regole salvate')}>Salva regole</button>
        </div>}
      </section>

      <section className="bg-white border border-gray-200 rounded-lg p-4">
        <h2 className="font-semibold mb-2">Prova (con le regole salvate, senza BC)</h2>
        <div className="flex gap-2">
          <input className={`${inp} w-40`} placeholder="Codice" value={pArt} onChange={e => setPArt(e.target.value)} />
          <input className={`${inp} flex-1`} placeholder="Descrizione dell'ordine di vendita" value={pDesc} onChange={e => setPDesc(e.target.value)} />
          <button className={btn} onClick={() => salva(async () => setProva(await api.post<Prova>('/api/fatturazione/prova', { article_code: pArt, descrizione: pDesc })), 'Calcolato')}>Calcola</button>
        </div>
        {prova && <p className="mt-2 text-sm">Totale: <b>{prova.totale.toFixed(2)}</b> — {prova.applicate.length ? prova.applicate.map(a => `${a.nome} (${a.prezzo})`).join(' + ') : 'nessuna regola applicata'}</p>}
      </section>
    </div>
  );
}
