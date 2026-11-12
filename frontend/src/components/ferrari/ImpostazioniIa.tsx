'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Errore } from '@/components/ferrari/Comuni';
import { IconaOk } from '@/components/ferrari/Icone';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { iaApi, leggiRiprova, scriviRiprova, type ConfigIa, type StatoIa } from '@/lib/ferrari-ia';

/** Impostazioni → Avanzate: interruttore della IA, indirizzo della PC IA, tentativi e prova della connessione. */
export function ImpostazioniIa() {
  const [stato, setStato] = useState<StatoIa | null>(null);
  const [bozza, setBozza] = useState<ConfigIa | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [esito, setEsito] = useState<{ ok: boolean; testo: string } | null>(null);
  const [occupato, setOccupato] = useState(false);
  const [salvato, setSalvato] = useState(false);
  const [riprova, setRiprova] = useState(false);
  useEffect(() => { setRiprova(leggiRiprova()); }, []);

  const carica = useCallback(async (init = false) => {
    try {
      const s = await iaApi.stato();
      setStato(s);
      if (init) setBozza(s.config);
    } catch (e) { setErrore((e as Error).message); }
  }, []);
  useEffect(() => { carica(true); }, [carica]);

  if (!stato || !bozza) return <Errore messaggio={errore} />;
  const cambiata = JSON.stringify(bozza) !== JSON.stringify(stato.config);
  const c = stato.connessione;

  async function salva(patch: Partial<ConfigIa>) {
    setOccupato(true);
    try {
      await iaApi.salvaConfig(patch);
      await carica(true);
      setErrore(null); setSalvato(true); setTimeout(() => setSalvato(false), 2500);
    } catch (e) { setErrore((e as Error).message); } finally { setOccupato(false); }
  }

  async function prova() {
    setOccupato(true); setEsito(null);
    try {
      if (cambiata) await iaApi.salvaConfig({ url: bozza!.url });          // si prova l'indirizzo scritto, non quello vecchio
      const r = await iaApi.prova();
      setEsito(r.ok
        ? { ok: true, testo: `Raggiungibile · ${r.salute.ollama ? `Ollama acceso${r.salute.modello ? ` (${r.salute.modello})` : ''}` : 'ma Ollama e\' spento'} · ${r.salute.in_coda + r.salute.in_corso} lavori in corso` }
        : { ok: false, testo: r.errore });
      await carica(true);
    } catch (e) { setErrore((e as Error).message); } finally { setOccupato(false); }
  }

  async function sincronizzaSigle() {
    setOccupato(true); setEsito(null);
    try {
      if (cambiata) await iaApi.salvaConfig({ url: bozza!.url });
      const r = await iaApi.sincronizzaSigle();
      setEsito(r.ok
        ? { ok: true, testo: `Sigle inviate alla PC IA: ${r.colonne} colonne, ${r.sottoSigle} sotto-sigle` }
        : { ok: false, testo: r.errore });
      await carica(true);
    } catch (e) { setErrore((e as Error).message); } finally { setOccupato(false); }
  }

  return (
    <div className="rounded-card border border-line bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink-700">Analisi con la PC IA</h2>
          <p className="mt-1 max-w-2xl text-xs text-muted">
            Quando e&apos; accesa, ogni scheda letta viene mandata alla PC IA: la IA riassume i testi lunghi e rilegge la scheda per controllo. La VM confronta le due letture per codice di sigla.
            La scheda e&apos; usabile subito, senza aspettare la IA, e se la PC IA e&apos; spenta il programma riprova da solo.
          </p>
        </div>
        {stato.config.attiva
          ? c.stato === 'non_raggiungibile' ? <StatusBadge tone="warning">PC IA non raggiungibile</StatusBadge> : <StatusBadge tone="success">Accesa</StatusBadge>
          : <StatusBadge tone="neutral">Spenta</StatusBadge>}
      </div>

      <Errore messaggio={errore} />

      <div className="mt-4 flex items-center gap-3">
        <button type="button" role="switch" aria-checked={bozza.attiva} disabled={occupato} aria-label="Analisi con la PC IA"
          onClick={() => { if (bozza.attiva || bozza.url) salva({ attiva: !bozza.attiva, url: bozza.url }); else setErrore('Prima scrivi l\'indirizzo della PC IA'); }}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${bozza.attiva ? 'bg-success' : 'bg-stone-300'}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-card transition-all ${bozza.attiva ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
        <span className="text-sm font-medium text-ink-900">{bozza.attiva ? 'La IA e\' accesa' : 'La IA e\' spenta'}</span>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_8rem_8rem]">
        <div className="flex flex-col gap-1">
          <label htmlFor="ia-url" className="label">Indirizzo della PC IA</label>
          <input id="ia-url" className="input" placeholder="http://192.168.1.50:5000" value={bozza.url} onChange={e => setBozza({ ...bozza, url: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="ia-tent" className="label">Tentativi</label>
          <input id="ia-tent" type="number" min={1} max={20} className="input" value={bozza.maxTentativi} onChange={e => setBozza({ ...bozza, maxTentativi: Number(e.target.value) })} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="ia-to" className="label">Timeout (s)</label>
          <input id="ia-to" type="number" min={5} max={300} className="input" value={bozza.timeoutS} onChange={e => setBozza({ ...bozza, timeoutS: Number(e.target.value) })} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button className="btn-primary" disabled={!cambiata || occupato} onClick={() => salva({ url: bozza.url, maxTentativi: bozza.maxTentativi, timeoutS: bozza.timeoutS })}>
          {salvato ? <span className="inline-flex items-center gap-1"><IconaOk /> Salvato</span> : 'Salva'}
        </button>
        <button className="btn-secondary" disabled={occupato || !bozza.url.trim()} onClick={prova}>Prova la connessione</button>
        <button className="btn-secondary" disabled={occupato || !bozza.url.trim()} onClick={sincronizzaSigle}
          title="Manda subito alla PC IA l'elenco attuale di sigle e sotto-sigle (di solito parte da sola prima di ogni scheda)">Sincronizza le sigle</button>
        <Link href="/ferrari/elaborazione" className="btn-secondary">Vedi l&apos;elaborazione</Link>
        {esito && <span className={`text-sm ${esito.ok ? 'text-success' : 'text-danger'}`} role="status">{esito.testo}</span>}
      </div>

      <label className="mt-4 flex items-start gap-2 text-sm text-ink-700"
        title="Solo per prova: caricando un file già caricato non viene rifiutato ma rimandato alla IA per una nuova analisi (serve la IA accesa)">
        <input type="checkbox" className="mt-0.5" checked={riprova} onChange={e => { setRiprova(e.target.checked); scriviRiprova(e.target.checked); }} />
        <span>Modalità prova: rianalizza i file già caricati<span className="block text-xs text-muted">Vale per «Carica Excel» e per i file trascinati, solo su questo browser.</span></span>
      </label>

      {stato.config.attiva && c.stato === 'non_raggiungibile' && (
        <p className="mt-3 text-xs text-warning">Ultimo errore: {c.errore}. Il programma controlla di nuovo ogni minuto.</p>
      )}
    </div>
  );
}
