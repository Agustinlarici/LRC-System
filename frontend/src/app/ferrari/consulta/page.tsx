'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { STATI, fmtData, type Esito, type FileRiga, type StatoFile } from '@/lib/ferrari';
import { Errore, EsitoDot, FerrariNav, StatoBadge } from '@/components/ferrari/Comuni';

interface Risultati {
  file: { id: number; filename: string; stato: StatoFile; esito: Esito | null; commessa: string | null; modello: string | null; caricato_at: string }[];
  codici: { id: number; codice: string; modello: string | null; significato: string; stato: string }[];
  componenti: { id: number; pattern: string; tipo: string; valore: string; modello: string | null; stato: string }[];
  decisioni: { id: number; file_id: number; item_key: string; decisione: string; motivo: string | null; username: string; creata_at: string }[];
  storico: { id: number; ts: string; username: string | null; azione: string; entita: string | null; entita_id: string | null }[];
}
interface Audit { id: number; ts: string; username: string | null; azione: string; entita: string | null; entita_id: string | null; dettagli: Record<string, unknown> | null }

export default function ConsultaPage() {
  const [q, setQ] = useState('');
  const [ris, setRis] = useState<Risultati | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [cerca, setCerca] = useState(false);

  // Filtri strutturati sulle schede
  const [modello, setModello] = useState('');
  const [codice, setCodice] = useState('');
  const [stato, setStato] = useState<StatoFile | ''>('');
  const [esito, setEsito] = useState<Esito | ''>('');
  const [dal, setDal] = useState('');
  const [al, setAl] = useState('');
  const [schede, setSchede] = useState<FileRiga[] | null>(null);
  const [totale, setTotale] = useState(0);

  const [audit, setAudit] = useState<Audit[]>([]);
  const [verifica, setVerifica] = useState<{ ok: boolean; righe: number; errore?: string } | null>(null);

  const caricaAudit = useCallback(async () => {
    try { setAudit(await api.get<Audit[]>('/api/ferrari/audit?limite=100')); } catch (e) { setErrore((e as Error).message); }
  }, []);
  useEffect(() => { caricaAudit(); }, [caricaAudit]);

  async function testo(e: React.FormEvent) {
    e.preventDefault();
    setCerca(true);
    setErrore(null);
    try {
      setRis(await api.get<Risultati>(`/api/ferrari/cerca?q=${encodeURIComponent(q.trim())}`));
    } catch (err) {
      setRis(null);
      setErrore((err as Error).message);
    } finally {
      setCerca(false);
    }
  }

  async function filtra(e: React.FormEvent) {
    e.preventDefault();
    const p = new URLSearchParams({ limite: '100' });
    if (modello.trim()) p.set('modello', modello.trim());
    if (codice.trim()) p.set('codice', codice.trim());
    if (stato) p.set('stato', stato);
    if (esito) p.set('esito', esito);
    if (dal) p.set('dal', dal);
    if (al) p.set('al', al);
    try {
      const r = await api.get<{ totale: number; righe: FileRiga[] }>(`/api/ferrari/files?${p}`);
      setSchede(r.righe);
      setTotale(r.totale);
      setErrore(null);
    } catch (err) {
      setErrore((err as Error).message);
    }
  }

  async function verificaCatena() {
    try { setVerifica(await api.get('/api/ferrari/audit/verifica')); } catch (err) { setErrore((err as Error).message); }
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-3xl font-bold text-gray-900">Consulta</h1>
        <p className="mt-1 text-gray-500">Cerca in schede, codici, componenti, decisioni e storico.</p>
      </div>
      <FerrariNav />
      <Errore messaggio={errore} />

      <section className="card mb-6">
        <h2 className="font-semibold text-gray-900 mb-3">Ricerca libera</h2>
        <form className="flex gap-3" onSubmit={testo}>
          <input className="input" placeholder="Es. una commessa, un codice (CEL2), una parola del testo libero, un utente…" value={q} onChange={e => setQ(e.target.value)} />
          <button className="btn-primary" disabled={cerca || q.trim().length < 2}>Cerca</button>
        </form>

        {ris && (
          <div className="mt-5 space-y-5 text-sm">
            <Gruppo titolo="Schede" n={ris.file.length}>
              {ris.file.map(f => (
                <Link key={f.id} href={`/ferrari/${f.id}`} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50">
                  <span className="font-medium text-blue-700">{f.commessa ?? f.filename}</span>
                  <span className="text-gray-500">{f.modello}</span><StatoBadge stato={f.stato} /><EsitoDot esito={f.esito} mostraTesto={false} />
                  <span className="ml-auto text-gray-400">{fmtData(f.caricato_at)}</span>
                </Link>
              ))}
            </Gruppo>
            <Gruppo titolo="Codici" n={ris.codici.length}>
              {ris.codici.map(c => (
                <div key={c.id} className="px-3 py-2"><span className="font-mono font-medium">{c.codice}</span> {c.significato}
                  <span className="text-gray-400"> · {c.modello ?? 'tutti'} · {c.stato}</span></div>
              ))}
            </Gruppo>
            <Gruppo titolo="Componenti del testo" n={ris.componenti.length}>
              {ris.componenti.map(c => (
                <div key={c.id} className="px-3 py-2"><span className="font-medium">{c.pattern}</span> → {c.tipo}{c.tipo !== 'NEUTRO' && <> = {c.valore}</>}
                  <span className="text-gray-400"> · {c.modello ?? 'tutti'} · {c.stato}</span></div>
              ))}
            </Gruppo>
            <Gruppo titolo="Decisioni" n={ris.decisioni.length}>
              {ris.decisioni.map(d => (
                <Link key={d.id} href={`/ferrari/${d.file_id}`} className="block px-3 py-2 hover:bg-gray-50">
                  <span className="font-medium">{d.decisione}</span> · {d.username} · <span className="text-gray-400">{fmtData(d.creata_at)}</span>
                  {d.motivo && <div className="text-gray-600">{d.motivo}</div>}
                </Link>
              ))}
            </Gruppo>
            <Gruppo titolo="Storico" n={ris.storico.length}>
              {ris.storico.map(s => (
                <div key={s.id} className="px-3 py-2"><span className="font-mono text-xs">{s.azione}</span> · {s.username ?? 'sistema'}
                  <span className="text-gray-400"> · {fmtData(s.ts)}{s.entita ? ` · ${s.entita} ${s.entita_id ?? ''}` : ''}</span></div>
              ))}
            </Gruppo>
          </div>
        )}
      </section>

      <section className="card mb-6">
        <h2 className="font-semibold text-gray-900 mb-3">Filtra le schede</h2>
        <form className="grid grid-cols-2 md:grid-cols-6 gap-3 items-end" onSubmit={filtra}>
          <div><label className="label">Modello</label><input className="input" placeholder="F171VS" value={modello} onChange={e => setModello(e.target.value)} /></div>
          <div><label className="label">Contiene il codice</label><input className="input" placeholder="CEL2" maxLength={4} value={codice} onChange={e => setCodice(e.target.value)} /></div>
          <div><label className="label">Stato</label>
            <select className="input" value={stato} onChange={e => setStato(e.target.value as StatoFile | '')}>
              <option value="">Tutti</option>{STATI.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select></div>
          <div><label className="label">Esito</label>
            <select className="input" value={esito} onChange={e => setEsito(e.target.value as Esito | '')}>
              <option value="">Tutti</option><option value="VERDE">Verde</option><option value="AMBRA">Ambra</option><option value="ROSSO">Rosso</option>
            </select></div>
          <div><label className="label">Dal</label><input className="input" type="date" value={dal} onChange={e => setDal(e.target.value)} /></div>
          <div><label className="label">Al</label><input className="input" type="date" value={al} onChange={e => setAl(e.target.value)} /></div>
          <button className="btn-secondary md:col-span-6 md:justify-self-start" type="submit">Applica filtri</button>
        </form>
        {schede && (
          <div className="mt-4 overflow-x-auto">
            <p className="text-xs text-gray-400 mb-2">{totale} schede{totale > schede.length ? ` (prime ${schede.length})` : ''}</p>
            <table className="w-full text-sm">
              <tbody>
                {schede.map(f => (
                  <tr key={f.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-1.5 pr-4"><Link className="text-blue-700 hover:underline font-medium" href={`/ferrari/${f.id}`}>{f.commessa ?? f.filename}</Link></td>
                    <td className="py-1.5 pr-4">{f.modello}</td>
                    <td className="py-1.5 pr-4">{f.paese}</td>
                    <td className="py-1.5 pr-4"><StatoBadge stato={f.stato} /></td>
                    <td className="py-1.5 pr-4"><EsitoDot esito={f.esito} /></td>
                    <td className="py-1.5 text-gray-400">{fmtData(f.caricato_at)}</td>
                  </tr>
                ))}
                {schede.length === 0 && <tr><td className="py-4 text-center text-gray-400">Nessuna scheda</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900">Storico completo (ultime 100 voci)</h2>
          <div className="flex items-center gap-3">
            {verifica && (
              <span className={`text-sm font-medium ${verifica.ok ? 'text-green-700' : 'text-red-600'}`}>
                {verifica.ok ? `Catena integra (${verifica.righe} voci)` : verifica.errore}
              </span>
            )}
            <button className="btn-secondary text-xs" onClick={verificaCatena}>Verifica integrità</button>
          </div>
        </div>
        <p className="text-xs text-gray-400 mb-3">Lo storico è di sola aggiunta e ogni voce contiene l&apos;hash della precedente: una modifica nel database rompe la catena.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {audit.map(a => (
                <tr key={a.id} className="border-b border-gray-100 align-top">
                  <td className="py-1.5 pr-3 text-gray-400 whitespace-nowrap">{fmtData(a.ts)}</td>
                  <td className="py-1.5 pr-3">{a.username ?? 'sistema'}</td>
                  <td className="py-1.5 pr-3 font-mono text-xs">{a.azione}</td>
                  <td className="py-1.5 pr-3">
                    {a.entita === 'file' && a.entita_id ? <Link className="text-blue-700 hover:underline" href={`/ferrari/${a.entita_id}`}>scheda #{a.entita_id}</Link> : `${a.entita ?? ''} ${a.entita_id ?? ''}`}
                  </td>
                  <td className="py-1.5 text-xs text-gray-500 break-all">{a.dettagli ? JSON.stringify(a.dettagli) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Gruppo({ titolo, n, children }: { titolo: string; n: number; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="font-medium text-gray-700 mb-1">{titolo} <span className="text-gray-400">({n})</span></h3>
      {n === 0 ? <p className="text-gray-400 text-xs">Nessun risultato</p> : <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">{children}</div>}
    </div>
  );
}
