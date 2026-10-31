'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/ui/Toast';
import { usePromptDialog } from '@/components/ui/PromptDialog';
import { TIPI_COMPONENTE_LABEL, fmtData } from '@/lib/ferrari';
import { Errore, } from '@/components/ferrari/Comuni';
import { PageHeader } from '@/components/ui/PageHeader';

interface Base { id: number; modello: string | null; stato: string; proposto_da: string; proposto_at: string; deciso_da: string | null; deciso_at: string | null; motivo: string | null; file_origine_id: number | null; versione_in: number | null }
interface Codice extends Base { codice: string; significato: string; categoria: string | null }
interface Componente extends Base { pattern: string; tipo: string; valore: string; esempio_testo: string | null }
interface Dati { codici: Codice[]; componenti: Componente[]; versione: number; tipi: string[] }
interface Config { sampling_pct?: string; four_eyes?: string; ia_attesa_ore?: string }

type Vista = 'proposte' | 'approvate' | 'aggiungi' | 'impostazioni';

const ambito = (m: string | null) => (m ? `solo ${m}` : 'tutti i modelli');

export default function ConoscenzaPage() {
  const { user, canManage } = useAuth();
  const toast = useToast();
  const { ask, dialog } = usePromptDialog();
  const puoOperare = canManage('ferrari_schede');
  const supervisore = canManage('ferrari_supervisore');

  const [vista, setVista] = useState<Vista>('proposte');
  const [dati, setDati] = useState<Dati | null>(null);
  const [config, setConfig] = useState<Config>({});
  const [errore, setErrore] = useState<string | null>(null);
  const [selCodici, setSelCodici] = useState<Set<number>>(new Set());
  const [selComp, setSelComp] = useState<Set<number>>(new Set());
  const [occupato, setOccupato] = useState(false);
  const [testoCodici, setTestoCodici] = useState('');
  const [ambitoNuovo, setAmbitoNuovo] = useState<'TUTTI' | 'MODELLO'>('TUTTI');
  const [modelloNuovo, setModelloNuovo] = useState('');
  const [cfgForm, setCfgForm] = useState({ sampling_pct: '100', four_eyes: true, ia_attesa_ore: '48' });

  const carica = useCallback(async () => {
    try {
      const [d, c] = await Promise.all([
        api.get<Dati>('/api/ferrari/conoscenza'),
        api.get<Config>('/api/ferrari/config'),
      ]);
      setDati(d);
      setConfig(c);
      setCfgForm({ sampling_pct: c.sampling_pct ?? '100', four_eyes: c.four_eyes !== 'false', ia_attesa_ore: c.ia_attesa_ore ?? '48' });
      setErrore(null);
    } catch (e) {
      setErrore((e as Error).message);
    }
  }, []);

  useEffect(() => { carica(); }, [carica]);

  const proposteCodici = dati?.codici.filter(c => c.stato === 'proposta') ?? [];
  const proposteComp = dati?.componenti.filter(c => c.stato === 'proposta') ?? [];
  const appCodici = dati?.codici.filter(c => c.stato === 'approvata') ?? [];
  const appComp = dati?.componenti.filter(c => c.stato === 'approvata') ?? [];

  function toggle(set: Set<number>, id: number, setter: (s: Set<number>) => void) {
    const n = new Set(set);
    if (n.has(id)) n.delete(id); else n.add(id);
    setter(n);
  }

  async function decidi(entita: 'codice' | 'componente', ids: number[], azione: 'approva' | 'rifiuta' | 'revoca') {
    if (ids.length === 0) return;
    let motivo: string | null = null;
    if (azione !== 'approva') {
      const r = await ask({ title: azione === 'rifiuta' ? 'Rifiuta la regola' : 'Revoca la regola', label: 'Motivo', confirmLabel: 'Conferma' });
      if (typeof r !== 'string' || !r.trim()) return;
      motivo = r.trim();
    }
    setOccupato(true);
    try {
      const r = await api.post<{ versione: number; aggiornati: number }>(`/api/ferrari/conoscenza/${entita}/decisione`, { ids, azione, motivo });
      toast.success(`${r.aggiornati} aggiornati — conoscenza alla versione ${r.versione}`);
      setSelCodici(new Set());
      setSelComp(new Set());
      await carica();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOccupato(false);
    }
  }

  async function aggiungiCodici() {
    const proposte = testoCodici.split('\n').map(r => r.trim()).filter(Boolean).map(r => {
      const [codice, significato, categoria] = r.split(/[;\t]/).map(s => s.trim());
      return { tipo: 'codice' as const, ambito: ambitoNuovo, modello: ambitoNuovo === 'MODELLO' ? modelloNuovo.trim().toUpperCase() : undefined,
        codice, significato, categoria: categoria || undefined };
    });
    if (proposte.length === 0) return;
    setOccupato(true);
    try {
      const r = await api.post<{ ids: number[] }>('/api/ferrari/conoscenza/proposte', { proposte });
      toast.success(`${r.ids.length} codici proposti: attendono l'approvazione del supervisore`);
      setTestoCodici('');
      setVista('proposte');
      await carica();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOccupato(false);
    }
  }

  async function salvaConfig() {
    setOccupato(true);
    try {
      await api.put('/api/ferrari/config', {
        sampling_pct: Number(cfgForm.sampling_pct), four_eyes: cfgForm.four_eyes, ia_attesa_ore: Number(cfgForm.ia_attesa_ore),
      });
      toast.success('Impostazioni salvate');
      await carica();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOccupato(false);
    }
  }

  const mio = (b: Base) => user?.username === b.proposto_da || user?.display_name === b.proposto_da;

  return (
    <div>
      <PageHeader
        back={{ label: 'Programma produzione (schede)', href: '/ferrari' }}
        title="Conoscenza"
        description={<>Codici e componenti del testo libero che la VM e la IA conoscono. Una regola vale solo dopo l&apos;approvazione di un supervisore.
          {dati && <> Versione attuale: <strong>{dati.versione}</strong>.</>}</>}
      />
      <Errore messaggio={errore} />

      <div className="flex flex-wrap gap-2 mb-5">
        {([['proposte', `Da approvare (${proposteCodici.length + proposteComp.length})`], ['approvate', `Approvate (${appCodici.length + appComp.length})`],
          ['aggiungi', 'Aggiungi codici'], ['impostazioni', 'Impostazioni']] as [Vista, string][]).map(([v, l]) => (
          <button key={v} onClick={() => setVista(v)}
            className={`px-3 py-1.5 rounded-ctl text-sm font-medium ${vista === v ? 'bg-ink-800 text-white' : 'bg-white border border-line text-ink-700 hover:bg-stone-50'}`}>
            {l}
          </button>
        ))}
      </div>

      {vista === 'proposte' && (
        <div className="space-y-6">
          {!supervisore && <p className="text-sm text-muted">Solo il supervisore può approvare o rifiutare. Qui puoi vedere cosa è in attesa.</p>}
          <Tabella titolo="Codici proposti" vuoto={proposteCodici.length === 0}
            azioni={supervisore && (
              <div className="flex gap-2">
                <button className="btn-primary text-xs" disabled={occupato || selCodici.size === 0} onClick={() => decidi('codice', [...selCodici], 'approva')}>Approva selezionati</button>
                <button className="btn-secondary text-xs" disabled={occupato || selCodici.size === 0} onClick={() => decidi('codice', [...selCodici], 'rifiuta')}>Rifiuta</button>
              </div>
            )}>
            {proposteCodici.map(c => (
              <tr key={c.id} className="border-b border-stone-100">
                <td className="py-2 px-3 w-8">{supervisore && <input type="checkbox" checked={selCodici.has(c.id)} onChange={() => toggle(selCodici, c.id, setSelCodici)} />}</td>
                <td className="py-2 px-3 font-mono font-medium">{c.codice}</td>
                <td className="py-2 px-3">{c.significato}{c.categoria && <span className="text-muted"> · {c.categoria}</span>}</td>
                <td className="py-2 px-3 text-muted">{ambito(c.modello)}</td>
                <td className="py-2 px-3 text-muted text-xs">{c.proposto_da}<br />{fmtData(c.proposto_at)}{mio(c) && <span className="text-warning"> (tua)</span>}</td>
                <td className="py-2 px-3 text-xs">{c.file_origine_id && <Link className="text-accent-ink hover:underline" href={`/ferrari/${c.file_origine_id}`}>scheda #{c.file_origine_id}</Link>}</td>
              </tr>
            ))}
          </Tabella>

          <Tabella titolo="Componenti del testo proposti" vuoto={proposteComp.length === 0}
            azioni={supervisore && (
              <div className="flex gap-2">
                <button className="btn-primary text-xs" disabled={occupato || selComp.size === 0} onClick={() => decidi('componente', [...selComp], 'approva')}>Approva selezionati</button>
                <button className="btn-secondary text-xs" disabled={occupato || selComp.size === 0} onClick={() => decidi('componente', [...selComp], 'rifiuta')}>Rifiuta</button>
              </div>
            )}>
            {proposteComp.map(c => (
              <tr key={c.id} className="border-b border-stone-100">
                <td className="py-2 px-3 w-8">{supervisore && <input type="checkbox" checked={selComp.has(c.id)} onChange={() => toggle(selComp, c.id, setSelComp)} />}</td>
                <td className="py-2 px-3 font-medium">{c.pattern}</td>
                <td className="py-2 px-3">{TIPI_COMPONENTE_LABEL[c.tipo] ?? c.tipo}{c.tipo !== 'NEUTRO' && <> = <strong>{c.valore}</strong></>}</td>
                <td className="py-2 px-3 text-muted">{ambito(c.modello)}</td>
                <td className="py-2 px-3 text-muted text-xs">{c.proposto_da}<br />{fmtData(c.proposto_at)}{mio(c) && <span className="text-warning"> (tua)</span>}</td>
                <td className="py-2 px-3 text-xs">{c.file_origine_id && <Link className="text-accent-ink hover:underline" href={`/ferrari/${c.file_origine_id}`}>scheda #{c.file_origine_id}</Link>}</td>
              </tr>
            ))}
          </Tabella>
          {config.four_eyes !== 'false' && <p className="text-xs text-muted">Doppia firma attiva: chi propone una regola non può approvarla.</p>}
        </div>
      )}

      {vista === 'approvate' && (
        <div className="space-y-6">
          <Tabella titolo="Codici approvati" vuoto={appCodici.length === 0}>
            {appCodici.map(c => (
              <tr key={c.id} className="border-b border-stone-100">
                <td className="py-2 px-3 w-8" />
                <td className="py-2 px-3 font-mono font-medium">{c.codice}</td>
                <td className="py-2 px-3">{c.significato}</td>
                <td className="py-2 px-3 text-muted">{ambito(c.modello)}</td>
                <td className="py-2 px-3 text-muted text-xs">v{c.versione_in} · {c.deciso_da}</td>
                <td className="py-2 px-3 text-right">{supervisore && <button className="text-xs text-danger hover:underline" disabled={occupato} onClick={() => decidi('codice', [c.id], 'revoca')}>Revoca</button>}</td>
              </tr>
            ))}
          </Tabella>
          <Tabella titolo="Componenti approvati" vuoto={appComp.length === 0}>
            {appComp.map(c => (
              <tr key={c.id} className="border-b border-stone-100">
                <td className="py-2 px-3 w-8" />
                <td className="py-2 px-3 font-medium">{c.pattern}</td>
                <td className="py-2 px-3">{TIPI_COMPONENTE_LABEL[c.tipo] ?? c.tipo}{c.tipo !== 'NEUTRO' && <> = <strong>{c.valore}</strong></>}</td>
                <td className="py-2 px-3 text-muted">{ambito(c.modello)}</td>
                <td className="py-2 px-3 text-muted text-xs">v{c.versione_in} · {c.deciso_da}</td>
                <td className="py-2 px-3 text-right">{supervisore && <button className="text-xs text-danger hover:underline" disabled={occupato} onClick={() => decidi('componente', [c.id], 'revoca')}>Revoca</button>}</td>
              </tr>
            ))}
          </Tabella>
        </div>
      )}

      {vista === 'aggiungi' && (
        <div className="card max-w-3xl">
          <h2 className="font-semibold text-ink-900 mb-1">Proponi codici in blocco</h2>
          <p className="text-sm text-muted mb-3">
            Una riga per codice: <code>CODICE;significato;categoria</code> (la categoria è facoltativa). Diventano proposte da approvare.
            I componenti del testo libero si definiscono invece durante la revisione di una scheda.
          </p>
          {!puoOperare ? <p className="text-sm text-muted">Non hai il permesso di proporre regole.</p> : (
            <>
              <textarea className="input font-mono min-h-[180px]" placeholder={'CEL2;Allestimento vano motore in carbonio;Carbonio\nRSFD;Cerchi forgiati diamantati;Cerchi'}
                value={testoCodici} onChange={e => setTestoCodici(e.target.value)} />
              <div className="flex flex-wrap items-end gap-3 mt-3">
                <div>
                  <label className="label">Ambito</label>
                  <select className="input" value={ambitoNuovo} onChange={e => setAmbitoNuovo(e.target.value as 'TUTTI' | 'MODELLO')}>
                    <option value="TUTTI">Tutti i modelli</option>
                    <option value="MODELLO">Solo un modello</option>
                  </select>
                </div>
                {ambitoNuovo === 'MODELLO' && (
                  <div>
                    <label className="label">Modello</label>
                    <input className="input" placeholder="F171VS" value={modelloNuovo} onChange={e => setModelloNuovo(e.target.value)} />
                  </div>
                )}
                <button className="btn-primary" disabled={occupato || !testoCodici.trim() || (ambitoNuovo === 'MODELLO' && !modelloNuovo.trim())} onClick={aggiungiCodici}>Proponi</button>
              </div>
            </>
          )}
        </div>
      )}

      {dialog}

      {vista === 'impostazioni' && (
        <div className="card max-w-xl space-y-4">
          <div>
            <label className="label">Controllo a campione delle schede VERDI (%)</label>
            <input className="input" type="number" min={0} max={100} disabled={!supervisore} value={cfgForm.sampling_pct}
              onChange={e => setCfgForm({ ...cfgForm, sampling_pct: e.target.value })} />
            <p className="text-xs text-muted mt-1">100 = tutte le schede passano da una persona (consigliato all&apos;inizio). Scende quando ci si fida.</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" disabled={!supervisore} checked={cfgForm.four_eyes} onChange={e => setCfgForm({ ...cfgForm, four_eyes: e.target.checked })} />
            Doppia firma: chi propone una regola non può approvarla
          </label>
          <div>
            <label className="label">Ore di attesa della risposta IA prima di segnalare il ritardo</label>
            <input className="input" type="number" min={1} disabled={!supervisore} value={cfgForm.ia_attesa_ore}
              onChange={e => setCfgForm({ ...cfgForm, ia_attesa_ore: e.target.value })} />
          </div>
          {supervisore ? <button className="btn-primary" disabled={occupato} onClick={salvaConfig}>Salva</button>
            : <p className="text-sm text-muted">Solo il supervisore può modificare le impostazioni.</p>}
        </div>
      )}
    </div>
  );
}

function Tabella({ titolo, vuoto, azioni, children }: { titolo: string; vuoto: boolean; azioni?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold text-ink-900">{titolo}</h2>
        {azioni}
      </div>
      <div className="bg-white rounded-card border border-line overflow-x-auto">
        {vuoto ? <p className="text-center text-muted py-6 text-sm">Nessun elemento</p> : (
          <table className="w-full text-sm"><tbody>{children}</tbody></table>
        )}
      </div>
    </section>
  );
}
