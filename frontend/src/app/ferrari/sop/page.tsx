'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { inviaFile } from '@/lib/ferrari';
import { sopApi, TIPO_DIFFERENZA, type ConfrontoSop, type DifferenzaSop, type ImportSop, type TipoDifferenza } from '@/lib/ferrari-sop';
import { Errore, VistaToggle } from '@/components/ferrari/Comuni';
import { SopRegole } from '@/components/ferrari/SopRegole';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge';
import { Tabs } from '@/components/ui/Tabs';

type Scheda = 'confronto' | 'regole';
const TONO: Record<TipoDifferenza, Tone> = { diverso: 'danger', solo_sop: 'warning', solo_vm: 'info' };
const PASSO = 100;
const data = (iso: string) => new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const num = (n: number) => n.toLocaleString('it-IT');

export default function ControlloSopPage() {
  const { canManage } = useAuth();
  const puoGestire = canManage('ferrari_schede');
  const [tab, setTab] = useState<Scheda>('confronto');
  const [imp, setImp] = useState<ImportSop | null | undefined>(undefined);      // undefined = sto leggendo, null = nessun SOP caricato
  const [conf, setConf] = useState<ConfrontoSop | null>(null);
  const [calcolo, setCalcolo] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [occupato, setOccupato] = useState(false);
  const [trascina, setTrascina] = useState(false);
  const [fCol, setFCol] = useState('');
  const [fTipo, setFTipo] = useState('');
  const [fCom, setFCom] = useState('');
  const [limite, setLimite] = useState(PASSO);

  const confronta = useCallback(async () => {
    setCalcolo(true);
    try { setConf(await sopApi.confronto()); setErrore(null); } catch (e) { setErrore((e as Error).message); } finally { setCalcolo(false); }
  }, []);

  const inizio = useCallback(async () => {
    try {
      const { importazioni } = await sopApi.importazioni();
      setImp(importazioni[0] ?? null);
      if (importazioni[0]) await confronta();
    } catch (e) { setErrore((e as Error).message); setImp(null); }
  }, [confronta]);
  useEffect(() => { inizio(); }, [inizio]);

  async function carica(f: File | undefined) {
    if (!f) return;
    if (!/\.(xls|xlsx)$/i.test(f.name)) { setErrore('Carica un file Excel (.xls o .xlsx)'); return; }
    setOccupato(true); setErrore(null);
    try {
      setImp(await inviaFile<ImportSop>('/api/ferrari/sop/import', 'file', [f]));
      setFCol(''); setFTipo(''); setFCom(''); setLimite(PASSO);
      await confronta();
    } catch (e) { setErrore((e as Error).message); } finally { setOccupato(false); }
  }

  const haFile = (e: React.DragEvent) => puoGestire && Array.from(e.dataTransfer?.types ?? []).includes('Files');
  const differenze = useMemo(() => {
    const c = fCom.trim().toLowerCase();
    return (conf?.differenze ?? []).filter(d => (!fCol || d.colonna === fCol) && (!fTipo || d.tipo === fTipo) && (!c || d.commessa.toLowerCase().includes(c)));
  }, [conf, fCol, fTipo, fCom]);

  async function esporta() {
    if (!conf) return;
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const diff = (d: DifferenzaSop) => ({ Commessa: d.commessa, Colonna: d.colonna, SOP: d.sop, VM: d.vm, Tipo: TIPO_DIFFERENZA[d.tipo], Nota: d.nota === 'senza_regola' ? 'MRKT senza regola' : '' });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(differenze.map(diff)), 'Differenze');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(conf.colonne.map(c => ({ Colonna: c.colonna, Coincidono: c.ok, 'Valori diversi': c.diverso, 'Solo nel SOP': c.solo_sop, 'Solo nella VM': c.solo_vm }))), 'Per colonna');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(conf.non_caricate.map(c => ({ Commessa: c }))), 'Non caricate nella VM');
    XLSX.writeFile(wb, `controllo-sop-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const r = conf?.riepilogo;
  return (
    <div
      onDragEnter={e => { if (haFile(e)) { e.preventDefault(); setTrascina(true); } }}
      onDragOver={e => { if (haFile(e)) e.preventDefault(); }}
      onDragLeave={e => { if (haFile(e) && e.currentTarget === e.target) setTrascina(false); }}
      onDrop={e => { if (!haFile(e)) return; e.preventDefault(); setTrascina(false); void carica(e.dataTransfer.files[0]); }}
    >
      {trascina && (
        <div className="d-print-none pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-white/80 p-6" role="status">
          <div className="rounded-card border-2 border-dashed border-accent bg-white px-10 py-8 text-center shadow-float">
            <p className="text-base font-semibold text-ink">Rilascia l&apos;Excel del SOP</p>
          </div>
        </div>
      )}
      <PageHeader
        title="Programma produzione (schede)"
        actions={
          <>
            {conf && <button className="btn-secondary" onClick={esporta}>Scarica differenze</button>}
            {puoGestire && (
              <label className="btn-primary cursor-pointer">
                {occupato ? 'Caricamento…' : imp ? 'Carica un altro SOP' : 'Carica il SOP'}
                <input type="file" accept=".xls,.xlsx" className="hidden" disabled={occupato} onChange={e => { void carica(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
            )}
          </>
        }
      />
      <Errore messaggio={errore} />
      <VistaToggle />
      {puoGestire && <Tabs tabs={['confronto', 'regole'] as const} value={tab} onChange={setTab} labels={{ confronto: 'Confronto', regole: 'Regole' }} />}

      {tab === 'regole' && puoGestire ? <SopRegole colonneSop={imp?.colonne ?? []} onCambia={() => { if (imp) void confronta(); }} /> : imp === undefined ? (
        <p className="py-10 text-center text-sm text-muted">Caricamento…</p>
      ) : imp === null ? (
        <div className="rounded-card border border-line bg-white">
          <EmptyState title="Nessun SOP caricato" hint="Carica l'Excel del SOP (una riga per commessa): la VM lo confronta con quello che legge dalle schede."
            action={puoGestire ? <label className="btn-primary cursor-pointer">Carica il SOP<input type="file" accept=".xls,.xlsx" className="hidden" onChange={e => { void carica(e.target.files?.[0]); e.target.value = ''; }} /></label> : undefined} />
        </div>
      ) : (
        <>
          <p className="mb-4 text-xs text-muted">{imp.filename} · {num(imp.righe)} commesse, {num(imp.con_dati)} con dati · caricato il {data(imp.caricato_at)}{imp.caricato_da ? ` da ${imp.caricato_da}` : ''}</p>
          {calcolo && !conf && <p className="py-6 text-sm text-muted">Confronto in corso…</p>}
          {conf?.regole_mancanti && (
            <div className="mb-4 rounded-card border border-accent/40 bg-accent-soft px-4 py-2.5 text-sm text-accent-ink">
              Non ci sono ancora regole per ricavare le colonne dalla scheda. {puoGestire && <>Vai alla scheda <button className="font-semibold underline" onClick={() => setTab('regole')}>Regole</button> e aggiungi quelle suggerite.</>}
            </div>
          )}
          {conf && r && (
            <>
              <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
                {([['Commesse con dati nel SOP', r.con_dati, ''], ['Confrontate con la VM', r.confrontate, ''], ['Coincidono del tutto', r.tutte_ok, 'text-success'],
                  ['Con differenze', r.con_differenze, r.con_differenze ? 'text-danger' : ''], ['Non caricate nella VM', r.non_caricate, r.non_caricate ? 'text-warning' : '']] as const).map(([k, v, cls]) => (
                  <div key={k} className="rounded-card border border-line bg-white px-4 py-3">
                    <div className="text-xs text-muted">{k}</div>
                    <div className={`mt-1 text-2xl font-semibold tabular-nums ${cls}`}>{num(v)}</div>
                  </div>
                ))}
              </div>
              {r.mercato_senza_regola > 0 && <p className="mb-4 text-xs text-warning">{num(r.mercato_senza_regola)} schede hanno un valore di MRKT senza traduzione: aggiungila nella regola MERCATO.</p>}

              <h2 className="mb-2 text-sm font-semibold text-ink-700">Per colonna</h2>
              <div className="mb-6 overflow-x-auto rounded-card border border-line bg-white">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-line bg-stone-50 text-left text-muted">
                    <th className="px-4 py-2 font-medium">Colonna</th><th className="px-4 py-2 text-right font-medium">Coincidono</th><th className="px-4 py-2 text-right font-medium">Valori diversi</th>
                    <th className="px-4 py-2 text-right font-medium">Solo nel SOP</th><th className="px-4 py-2 text-right font-medium">Solo nella VM</th><th className="px-4 py-2 text-right font-medium">%</th>
                  </tr></thead>
                  <tbody className="divide-y divide-line">
                    {conf.colonne.map(c => {
                      const tot = c.ok + c.diverso + c.solo_sop + c.solo_vm;
                      return (
                        <tr key={c.colonna} className="cursor-pointer hover:bg-stone-50" onClick={() => { setFCol(c.colonna); setLimite(PASSO); }}>
                          <td className="px-4 py-2 font-semibold">{c.colonna}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{num(c.ok)}</td>
                          <td className={`px-4 py-2 text-right tabular-nums ${c.diverso ? 'text-danger' : 'text-muted'}`}>{num(c.diverso)}</td>
                          <td className={`px-4 py-2 text-right tabular-nums ${c.solo_sop ? 'text-warning' : 'text-muted'}`}>{num(c.solo_sop)}</td>
                          <td className={`px-4 py-2 text-right tabular-nums ${c.solo_vm ? 'text-accent-ink' : 'text-muted'}`}>{num(c.solo_vm)}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{tot ? `${Math.round((100 * c.ok) / tot)}%` : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {conf.colonne_senza_regola.length > 0 && <p className="-mt-4 mb-6 text-xs text-muted">Colonne non controllate (senza regola): {conf.colonne_senza_regola.join(', ')}</p>}

              <h2 className="mb-2 text-sm font-semibold text-ink-700">Differenze ({num(differenze.length)}{conf.troncato ? '+' : ''})</h2>
              <div className="d-print-none mb-3 flex flex-wrap items-center gap-2">
                <input className="input !w-44" placeholder="Commessa…" value={fCom} onChange={e => { setFCom(e.target.value); setLimite(PASSO); }} />
                <select className="input !w-auto" value={fCol} onChange={e => { setFCol(e.target.value); setLimite(PASSO); }}>
                  <option value="">Tutte le colonne</option>{conf.colonne.filter(c => c.diverso + c.solo_sop + c.solo_vm > 0).map(c => <option key={c.colonna}>{c.colonna}</option>)}
                </select>
                <select className="input !w-auto" value={fTipo} onChange={e => { setFTipo(e.target.value); setLimite(PASSO); }}>
                  <option value="">Tutti i tipi</option>{(Object.keys(TIPO_DIFFERENZA) as TipoDifferenza[]).map(t => <option key={t} value={t}>{TIPO_DIFFERENZA[t]}</option>)}
                </select>
                {(fCol || fTipo || fCom) && <button className="btn-secondary !py-1" onClick={() => { setFCol(''); setFTipo(''); setFCom(''); }}>Azzera i filtri</button>}
              </div>
              {differenze.length === 0 ? (
                <p className="rounded-card border border-line bg-white px-4 py-8 text-center text-sm text-muted">{conf.differenze.length === 0 ? 'Nessuna differenza: tutto quello che si può controllare coincide.' : 'Nessuna differenza con questi filtri.'}</p>
              ) : (
                <div className="overflow-x-auto rounded-card border border-line bg-white">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-line bg-stone-50 text-left text-muted">
                      <th className="px-4 py-2 font-medium">Commessa</th><th className="px-4 py-2 font-medium">Colonna</th><th className="px-4 py-2 font-medium">SOP</th><th className="px-4 py-2 font-medium">VM</th><th className="px-4 py-2 font-medium">Differenza</th>
                    </tr></thead>
                    <tbody className="divide-y divide-line">
                      {differenze.slice(0, limite).map((d, i) => (
                        <tr key={`${d.commessa}-${d.colonna}-${i}`} className="hover:bg-stone-50">
                          <td className="px-4 py-2 font-semibold"><Link href={`/ferrari/${d.file_id}`} className="text-accent-ink hover:underline">{d.commessa}</Link></td>
                          <td className="px-4 py-2">{d.colonna}</td>
                          <td className="px-4 py-2 font-mono text-xs">{d.sop || '—'}</td>
                          <td className="px-4 py-2 font-mono text-xs">{d.vm || '—'}</td>
                          <td className="px-4 py-2"><StatusBadge tone={TONO[d.tipo]}>{TIPO_DIFFERENZA[d.tipo]}</StatusBadge>{d.nota === 'senza_regola' && <span className="ml-2 text-xs text-muted">MRKT senza traduzione</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {differenze.length > limite && <div className="border-t border-line p-3 text-center"><button className="btn-secondary" onClick={() => setLimite(l => l + PASSO)}>Mostra altre {Math.min(PASSO, differenze.length - limite)}</button></div>}
                </div>
              )}
              {conf.troncato && <p className="mt-2 text-xs text-warning">Troppe differenze: se ne mostrano le prime. Correggi le regole delle colonne con piu&apos; differenze e confronta di nuovo.</p>}

              {conf.non_caricate.length > 0 && (
                <details className="mt-6 rounded-card border border-line bg-white px-4 py-3">
                  <summary className="cursor-pointer text-sm font-semibold text-ink-700">Commesse del SOP non caricate nella VM ({num(r.non_caricate)})</summary>
                  <p className="mt-2 text-xs text-muted">Carica le loro schede per poterle confrontare.</p>
                  <p className="mt-2 break-words font-mono text-xs text-ink-700">{conf.non_caricate.join(', ')}{r.non_caricate > conf.non_caricate.length ? ` … e altre ${num(r.non_caricate - conf.non_caricate.length)}` : ''}</p>
                </details>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
