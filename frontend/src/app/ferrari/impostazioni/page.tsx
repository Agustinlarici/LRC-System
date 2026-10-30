'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { inviaFile, scaricaFile } from '@/lib/ferrari';
import { Errore, FerrariNav } from '@/components/ferrari/Comuni';
import { ImpostazioniCartella } from '@/components/ferrari/ImpostazioniCartella';
import { ImpostazioniSigle, type ConfigSigle } from '@/components/ferrari/ImpostazioniSigle';
import { ImpostazioniModelli } from '@/components/ferrari/ImpostazioniModelli';
import { ComponentiGestione } from '@/components/ferrari/ComponentiGestione';

type Scheda = 'sigle' | 'modelli' | 'componenti' | 'cartella' | 'avanzate';
const SCHEDE: { id: Scheda; label: string }[] = [
  { id: 'sigle', label: 'Sigle' }, { id: 'modelli', label: 'Modelli' }, { id: 'componenti', label: 'Componenti' }, { id: 'cartella', label: 'Cartella Excel' }, { id: 'avanzate', label: 'Avanzate' },
];
interface Proposta { modello: string; codice: string; va: boolean; sub: boolean; alias: string | null; nome: string | null; conflitto: boolean; da: string | null }
interface Contatori { da_decidere: Record<string, number>; proposte_sigle: Proposta[]; gestione_modelli: { nuovi: unknown[] }; descrizioni_da_confermare?: number }

const scheda = (h: string): Scheda => (SCHEDE.find(s => s.id === h.replace('#', ''))?.id ?? 'sigle');

export default function ImpostazioniPage() {
  const { canManage } = useAuth();
  const puoGestire = canManage('ferrari_schede');
  const [tab, setTab] = useState<Scheda>('sigle');
  const [cont, setCont] = useState<Contatori | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const zipRef = useRef<HTMLInputElement>(null);

  const contatori = useCallback(async () => {
    try { setCont(await api.get<Contatori>('/api/ferrari/impostazioni/sigle')); } catch { /* i badge sono un di piu' */ }
  }, []);

  useEffect(() => {
    setTab(scheda(location.hash));
    const h = () => setTab(scheda(location.hash));
    window.addEventListener('hashchange', h);
    contatori();
    return () => window.removeEventListener('hashchange', h);
  }, [contatori]);

  const apri = (t: Scheda) => { setTab(t); history.replaceState(null, '', `#${t}`); };
  const daDecidere = Object.values(cont?.da_decidere ?? {}).reduce((a, b) => a + b, 0);
  const proposte = cont?.proposte_sigle ?? [];
  const modelliNuovi = cont?.gestione_modelli.nuovi.length ?? 0;

  async function risolvi(azione: string, p?: Proposta) {
    if (azione.endsWith('-tutte') && !confirm(`${azione.startsWith('accetta') ? 'Accettare' : 'Rifiutare'} tutte le modifiche della PC IA?`)) return;
    try {
      await api.post('/api/ferrari/proposte', { azione, modello: p?.modello, codice: p?.codice });
      await contatori();
    } catch (e) {
      setErrore((e as Error).message);
    }
  }

  async function importa(f: File | undefined) {
    if (!f) return;
    try {
      const r = await inviaFile<{ nuove: number; conflitti: number; uguali: number; dettagli: number }>('/api/ferrari/sigle/importa', 'file', [f]);
      setMsg(`Dalla PC IA: ${r.nuove} sigle nuove, ${r.conflitti} in conflitto, ${r.uguali} già uguali · ${r.dettagli} riassunti`);
      await contatori();
    } catch (e) {
      setErrore((e as Error).message);
    } finally {
      if (zipRef.current) zipRef.current.value = '';
    }
  }

  const badge = (n: number) => n > 0 && <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 text-[11px] font-bold leading-4 text-white">{n}</span>;

  return (
    <div>
      <FerrariNav />
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Impostazioni schede</h1>
        <p className="mt-1 text-gray-500">Cartella degli Excel, sigle, modelli e componenti.</p>
      </div>
      <Errore messaggio={errore} />

      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-gray-200">
        {SCHEDE.map(s => (
          <button key={s.id} onClick={() => apri(s.id)}
            className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors ${tab === s.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {s.label}
            {s.id === 'sigle' && badge(daDecidere + (cont?.descrizioni_da_confermare ?? 0))}
            {s.id === 'modelli' && badge(modelliNuovi)}
            {s.id === 'avanzate' && badge(proposte.length)}
          </button>
        ))}
      </div>

      {!puoGestire ? (
        <p className="rounded-xl border border-gray-200 bg-white px-4 py-6 text-sm text-gray-500">Non hai il permesso di modificare le impostazioni delle schede.</p>
      ) : (
        <>
          {tab === 'sigle' && <ImpostazioniSigle onCambia={(c: ConfigSigle) => setCont(c as unknown as Contatori)} />}
          {tab === 'modelli' && <div className="max-w-3xl"><ImpostazioniModelli onCambia={contatori} /></div>}
          {tab === 'componenti' && <div className="max-w-3xl"><ComponentiGestione /></div>}
          {tab === 'cartella' && <div className="max-w-3xl"><ImpostazioniCartella /></div>}
          {tab === 'avanzate' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h2 className="mb-1 text-sm font-semibold text-gray-700">Altre pagine</h2>
                <p className="mb-3 text-xs text-gray-500">Non servono nell&apos;uso di ogni giorno.</p>
                <div className="flex flex-wrap gap-2">
                  {[['/ferrari/schede', 'Revisione'], ['/ferrari/consulta', 'Consulta'], ['/ferrari/conoscenza', 'Conoscenza'], ['/ferrari/scambio', 'Scambio con la IA']].map(([h, l]) => (
                    <Link key={h} href={h!} className="btn-secondary">{l}</Link>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <h2 className="mb-1 text-sm font-semibold text-gray-700">PC IA (non collegata)</h2>
                <p className="mb-3 text-xs text-gray-500">La VM lavora senza IA. Questo serve solo quando la PC IA verrà collegata: scambio manuale delle sigle e dei componenti.</p>
                <input ref={zipRef} type="file" accept=".zip" className="hidden" onChange={e => importa(e.target.files?.[0])} />
                <div className="flex flex-wrap items-center gap-2">
                  <button className="btn-secondary" onClick={() => scaricaFile('/api/ferrari/sigle/esporta', { nome: 'FERRARI_sigle_vm.zip' }).catch(e => setErrore((e as Error).message))}>Invia sigle alla PC IA</button>
                  <button className="btn-secondary" onClick={() => zipRef.current?.click()}>Carica file dalla PC IA</button>
                  {msg && <span className="text-xs text-gray-500">{msg}</span>}
                </div>
                {proposte.length > 0 && (
                  <div className="mt-4 rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <b>Dalla PC IA: {proposte.length} modifiche</b>
                      <button className="btn-primary !py-0.5 text-xs" onClick={() => risolvi('accetta-tutte')}>Accetta tutte</button>
                      <button className="btn-secondary !py-0.5 text-xs" onClick={() => risolvi('rifiuta-tutte')}>Rifiuta tutte</button>
                    </div>
                    <table className="mt-2 w-full"><tbody>
                      {proposte.map(p => (
                        <tr key={`${p.modello}/${p.codice}`} className="border-t border-sky-200">
                          <td className="py-1 pr-3 font-semibold">{p.modello === '*' ? 'tutti i modelli' : p.modello}</td>
                          <td className="py-1 pr-3"><b>{p.codice}</b> <span className="text-gray-500">{p.nome}</span>{p.sub && <span className="ml-2 rounded bg-gray-100 px-1.5 text-xs">sotto-sigla</span>}{p.alias && <span className="ml-2 rounded bg-gray-100 px-1.5 text-xs">= {p.alias}</span>}</td>
                          <td className="py-1 pr-3">{p.va ? (p.sub ? 'va dentro la voce' : 'va in tabella') : 'non va'}{p.conflitto && <span className="ml-2 rounded bg-amber-100 px-1.5 text-xs text-amber-800">tu: il contrario</span>}</td>
                          <td className="py-1 text-right whitespace-nowrap">
                            <button className="btn-primary !py-0.5 text-xs mr-1" onClick={() => risolvi('accetta', p)}>Accetta</button>
                            <button className="btn-secondary !py-0.5 text-xs" onClick={() => risolvi('rifiuta', p)}>Rifiuta</button>
                          </td>
                        </tr>
                      ))}
                    </tbody></table>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
