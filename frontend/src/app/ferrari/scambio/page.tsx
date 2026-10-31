'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/ui/Toast';
import { fmtData, inviaFile, scaricaFile, type FileRiga } from '@/lib/ferrari';
import { Errore, } from '@/components/ferrari/Comuni';
import { PageHeader } from '@/components/ui/PageHeader';

interface BundleRiga {
  bundle_id: string; tipo: 'to-ai' | 'from-ai' | 'knowledge'; direzione: 'out' | 'in'; batch_id: string | null;
  in_reply_to: string | null; stato: string; file_ids: number[]; creato_da: string; creato_at: string; scaricabile: boolean;
}
interface Rifiutato { id: number; filename: string | null; motivo: string; utente: string; creato_at: string }
interface EsitoImport {
  bundle_id: string; mancanti: number[];
  report: { file_id: string; id: number | null; esito: string | null; stato: string | null; errore?: string }[];
}

const TIPO_LABEL = { 'to-ai': 'Verso la IA', 'from-ai': 'Risposta della IA', knowledge: 'Conoscenza' } as const;

export default function ScambioPage() {
  const { canManage } = useAuth();
  const toast = useToast();
  const puoOperare = canManage('ferrari_schede');
  const supervisore = canManage('ferrari_supervisore');

  const [attesa, setAttesa] = useState<FileRiga[]>([]);
  const [bundle, setBundle] = useState<BundleRiga[]>([]);
  const [rifiutati, setRifiutati] = useState<Rifiutato[]>([]);
  const [errore, setErrore] = useState<string | null>(null);
  const [occupato, setOccupato] = useState<string | null>(null);
  const [esitoImport, setEsitoImport] = useState<EsitoImport | null>(null);
  const [segreto, setSegreto] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const carica = useCallback(async () => {
    try {
      const [lista, b] = await Promise.all([
        api.get<{ righe: FileRiga[] }>('/api/ferrari/files?stato=IN_ATTESA_IA&limite=200'),
        api.get<{ bundle: BundleRiga[]; rifiutati: Rifiutato[] }>('/api/ferrari/bundle'),
      ]);
      setAttesa(lista.righe);
      setBundle(b.bundle);
      setRifiutati(b.rifiutati);
      setErrore(null);
    } catch (e) {
      setErrore((e as Error).message);
    }
  }, []);

  useEffect(() => { carica(); }, [carica]);

  const daInviare = attesa.filter(f => f.ia_stato === 'in_attesa' && !f.inviato_ia_at);
  const inviate = attesa.filter(f => f.ia_stato === 'in_attesa' && f.inviato_ia_at);

  async function esegui(chiave: string, fn: () => Promise<void>) {
    setOccupato(chiave);
    try { await fn(); await carica(); } catch (e) { toast.error((e as Error).message); } finally { setOccupato(null); }
  }

  const creaToAi = (soloNuove: boolean) => esegui('to-ai', async () => {
    await scaricaFile('/api/ferrari/bundle/to-ai', {
      method: 'POST', body: soloNuove ? { file_ids: daInviare.map(f => f.id) } : {}, nome: 'FERRARI_to-ai.zip',
    });
    toast.success('Pacchetto creato: copialo sulla PC IA');
  });

  const creaConoscenza = () => esegui('knowledge', async () => {
    await scaricaFile('/api/ferrari/bundle/knowledge', { method: 'POST', body: {}, nome: 'FERRARI_knowledge.zip' });
    toast.success('Pacchetto di conoscenza creato');
  });

  const importa = (f: File | undefined) => {
    if (!f) return;
    void esegui('import', async () => {
      setEsitoImport(null);
      try {
        setEsitoImport(await inviaFile<EsitoImport>('/api/ferrari/bundle/import', 'file', [f]));
        toast.success('Risposta della IA importata');
      } finally {
        if (inputRef.current) inputRef.current.value = '';
      }
    });
  };

  const soloVm = (id: number) => esegui(`vm${id}`, async () => {
    await api.post(`/api/ferrari/files/${id}/solo-vm`);
    toast.info('La scheda passa alla revisione senza IA');
  });

  const mostraSegreto = () => esegui('segreto', async () => {
    setSegreto((await api.get<{ segreto: string }>('/api/ferrari/segreto')).segreto);
  });

  return (
    <div>
      <PageHeader
        back={{ label: 'Programma produzione (schede)', href: '/ferrari' }}
        title="Scambio con la PC IA"
        description="La PC IA non è nel dominio: i file viaggiano in pacchetti firmati (.zip) che si copiano a mano (USB, cartella o OneDrive)."
      />
      <Errore messaggio={errore} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <section className="card">
          <h2 className="font-semibold text-ink-900 mb-1">1. Invia alla IA</h2>
          <p className="text-sm text-muted mb-3">
            Il pacchetto contiene le schede ricevute e la conoscenza approvata. Copialo nella cartella <code>inbox</code> della PC IA.
          </p>
          <div className="text-sm mb-3">
            <span className="text-2xl font-bold text-ink-900">{daInviare.length}</span> schede da inviare
            {inviate.length > 0 && <span className="text-muted"> · {inviate.length} già inviate, senza risposta</span>}
          </div>
          {puoOperare && (
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" disabled={occupato !== null || daInviare.length === 0} onClick={() => creaToAi(true)}>
                {occupato === 'to-ai' ? 'Creazione…' : 'Crea pacchetto per la IA'}
              </button>
              {inviate.length > 0 && (
                <button className="btn-secondary" disabled={occupato !== null} onClick={() => creaToAi(false)}
                  title="Rigenera un pacchetto con tutte le schede ancora in attesa, comprese quelle già inviate">
                  Reinvia anche le già inviate
                </button>
              )}
            </div>
          )}
        </section>

        <section className="card">
          <h2 className="font-semibold text-ink-900 mb-1">2. Importa la risposta della IA</h2>
          <p className="text-sm text-muted mb-3">
            Carica il file <code>from-ai</code> prodotto dalla PC IA. Viene controllata la firma, l&apos;hash di ogni file e che risponda a un invio noto.
            Lo stesso pacchetto non si importa due volte.
          </p>
          {puoOperare && (
            <>
              <input ref={inputRef} type="file" accept=".zip" className="hidden" onChange={e => importa(e.target.files?.[0])} />
              <button className="btn-primary" disabled={occupato !== null} onClick={() => inputRef.current?.click()}>
                {occupato === 'import' ? 'Importazione…' : 'Scegli il pacchetto della IA'}
              </button>
            </>
          )}
        </section>
      </div>

      {esitoImport && (
        <section className="card mb-8">
          <h2 className="font-semibold text-ink-900 mb-3">Esito dell&apos;importazione</h2>
          <table className="w-full text-sm">
            <tbody>
              {esitoImport.report.map(r => (
                <tr key={r.file_id} className="border-b border-stone-100">
                  <td className="py-1.5 pr-4">
                    {r.id ? <Link className="text-accent-ink hover:underline" href={`/ferrari/${r.id}`}>Scheda #{r.id}</Link> : r.file_id}
                  </td>
                  <td className="py-1.5 pr-4">{r.esito ?? '—'}</td>
                  <td className="py-1.5 pr-4">{r.stato ?? '—'}</td>
                  <td className="py-1.5 text-danger">{r.errore}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {esitoImport.mancanti.length > 0 && (
            <p className="mt-3 text-sm text-warning">
              Senza risposta nel pacchetto: {esitoImport.mancanti.map(id => `#${id}`).join(', ')} (restano in attesa).
            </p>
          )}
        </section>
      )}

      {inviate.length > 0 && (
        <section className="card mb-8">
          <h2 className="font-semibold text-ink-900 mb-1">Inviate, in attesa di risposta</h2>
          <p className="text-sm text-muted mb-3">
            Se la IA non è disponibile si può procedere con la sola VM: la scheda finisce in revisione e non viene mai accettata in automatico.
          </p>
          <table className="w-full text-sm">
            <tbody>
              {inviate.map(f => (
                <tr key={f.id} className="border-b border-stone-100">
                  <td className="py-1.5 pr-4"><Link className="text-accent-ink hover:underline" href={`/ferrari/${f.id}`}>{f.commessa ?? f.filename}</Link></td>
                  <td className="py-1.5 pr-4 text-muted">{f.modello}</td>
                  <td className="py-1.5 pr-4 text-muted">inviata {fmtData(f.inviato_ia_at)}</td>
                  <td className="py-1.5 text-right">
                    {puoOperare && (
                      <button className="btn-secondary text-xs" disabled={occupato !== null} onClick={() => soloVm(f.id)}>Rivedi senza IA</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="card mb-8">
        <h2 className="font-semibold text-ink-900 mb-1">Conoscenza per la IA</h2>
        <p className="text-sm text-muted mb-3">
          Ogni pacchetto verso la IA già include la conoscenza approvata. Questo pacchetto serve solo per aggiornarla senza inviare schede.
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          {puoOperare && (
            <button className="btn-secondary" disabled={occupato !== null} onClick={creaConoscenza}>Crea pacchetto di conoscenza</button>
          )}
          {supervisore && (
            <button className="btn-secondary" disabled={occupato !== null} onClick={mostraSegreto}>Mostra il segreto condiviso</button>
          )}
        </div>
        {segreto && (
          <div className="mt-3 text-sm">
            <p className="text-muted mb-1">
              Da inserire come <code>FERRARI_BUNDLE_SECRET</code> nel <code>config.txt</code> della PC IA. Non va mai nei pacchetti né nel repository.
            </p>
            <code className="block bg-stone-100 rounded px-3 py-2 break-all select-all">{segreto}</code>
          </div>
        )}
      </section>

      <h2 className="font-semibold text-ink-900 mb-3">Storico pacchetti</h2>
      <div className="bg-white rounded-card border border-line overflow-x-auto mb-8">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-stone-50 text-muted">
              <th className="py-2.5 px-4 text-left font-medium">Tipo</th>
              <th className="py-2.5 px-4 text-left font-medium">Identificativo</th>
              <th className="py-2.5 px-4 text-right font-medium">Schede</th>
              <th className="py-2.5 px-4 text-left font-medium">Creato</th>
              <th className="py-2.5 px-4" />
            </tr>
          </thead>
          <tbody>
            {bundle.length === 0 ? (
              <tr><td colSpan={5} className="text-center text-muted py-6">Nessun pacchetto</td></tr>
            ) : bundle.map(b => (
              <tr key={b.bundle_id} className="border-b border-stone-100">
                <td className="py-2 px-4">{TIPO_LABEL[b.tipo]} <span className="text-xs text-muted">({b.direzione === 'out' ? 'uscita' : 'entrata'})</span></td>
                <td className="py-2 px-4 font-mono text-xs text-muted">{b.bundle_id}</td>
                <td className="py-2 px-4 text-right">{b.file_ids.length || '—'}</td>
                <td className="py-2 px-4 text-muted whitespace-nowrap">{fmtData(b.creato_at)}<div className="text-xs">{b.creato_da}</div></td>
                <td className="py-2 px-4 text-right">
                  {b.scaricabile && (
                    <button className="text-accent-ink hover:underline text-xs"
                      onClick={() => esegui(b.bundle_id, () => scaricaFile(`/api/ferrari/bundle/${b.bundle_id}/download`, { nome: `${b.bundle_id}.zip` }))}>
                      Scarica
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rifiutati.length > 0 && (
        <>
          <h2 className="font-semibold text-ink-900 mb-3">Pacchetti rifiutati</h2>
          <div className="bg-white rounded-card border border-danger/30 divide-y divide-stone-100 mb-8">
            {rifiutati.map(r => (
              <div key={r.id} className="px-4 py-2 text-sm">
                <span className="font-medium">{r.filename ?? 'sconosciuto'}</span>
                <span className="text-muted"> · {fmtData(r.creato_at)} · {r.utente}</span>
                <div className="text-danger">{r.motivo}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
