'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import { useAuth } from '@/lib/auth';
import type { HrEmployee } from '@/types';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tabs } from '@/components/ui/Tabs';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { api } from '@/lib/api';
import { ImportCapiModal, GestisciCapiModal, type Capo } from './CapiModals';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

const TABS = ['capi', 'elenco', 'consegne'] as const;
type Tab = typeof TABS[number];

type Dividi = '' | 'funzione' | 'responsabile';
const SENZA_FUNZIONE = 'Senza funzione';
const SENZA_RESP = 'Senza responsabile';
type Consegna = { employee_id: number; consegnato_il: string; giorni: number };
type StatoConsegna = '' | 'consegnato' | 'da_consegnare';
type OrdineConsegne = 'vecchie' | 'recenti' | 'nome';

// Data di oggi «YYYY-MM-DD» nel fuso del browser
function oggi() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const fmtData = (iso: string) => iso.split('-').reverse().join('/');

const LETTER_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'];

// Ordine naturale delle taglie: XS…5XL, poi il resto
function compareSize(a: string, b: string) {
  const ia = LETTER_ORDER.indexOf(a), ib = LETTER_ORDER.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
}

export default function VestiarioPage() {
  const { canView, canManage } = useAuth();
  const manage = canManage('hr');
  const allowed = canView('hr');

  const [employees, setEmployees] = useState<HrEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('capi');
  const [funzioneSel, setFunzioneSel] = useState<string[]>([]);
  const [respSel, setRespSel] = useState<string[]>([]);
  const [dividi, setDividi] = useState<Dividi>('');
  const [capi, setCapi] = useState<Capo[]>([]);
  const [taglie, setTaglie] = useState<{ employee_id: number; capo_id: number; taglia: string }[]>([]);
  const [consegne, setConsegne] = useState<Consegna[]>([]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [dataSel, setDataSel] = useState(oggi);
  const [statoSel, setStatoSel] = useState<StatoConsegna>('');
  const [ordine, setOrdine] = useState<OrdineConsegne>('vecchie');
  const [minGiorni, setMinGiorni] = useState('');
  const [saving, setSaving] = useState(false);
  const [errore, setErrore] = useState('');
  const [modal, setModal] = useState<'import' | 'gestisci' | null>(null);

  async function loadCapi() {
    try {
      const [k, t, cg] = await Promise.all([
        api.get<Capo[]>('/api/hr/vestiario/capi'),
        api.get<{ employee_id: number; capo_id: number; taglia: string }[]>('/api/hr/vestiario/taglie'),
        api.get<Consegna[]>('/api/hr/vestiario/consegne'),
      ]);
      setCapi(k); setTaglie(t); setConsegne(cg);
    } catch { /* la pagina funziona anche senza capi */ }
  }

  useEffect(() => {
    if (!allowed) { setLoading(false); return; }
    void loadCapi();
    let cancelled = false;
    (async () => {
      const res = await fetch(`${BACKEND}/api/hr/employees`, { credentials: 'include' });
      if (cancelled) return;
      if (res.ok) setEmployees(await res.json());
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [allowed]);

  // I cessati non servono mai: niente vestiario da ordinare
  const attivi = useMemo(() => employees.filter(e => e.stato !== 'cessato'), [employees]);

  const funzioneOf = (e: HrEmployee) => e.funzione_aziendale?.trim() || SENZA_FUNZIONE;
  const respOf = (e: HrEmployee) => {
    const c = e.capo_id != null ? employees.find(x => x.id === e.capo_id) : null;
    return c ? `${c.cognome} ${c.nome}` : SENZA_RESP;
  };

  const funzioneOptions = useMemo(
    () => Array.from(new Set(attivi.map(funzioneOf))).sort((a, b) => a.localeCompare(b)).map(v => ({ value: v, label: v })),
    [attivi],
  );
  // Responsabili = chi ha persone sotto di sé
  const respOptions = useMemo(
    () => attivi.filter(e => e.n_riporti > 0).sort((a, b) => a.cognome.localeCompare(b.cognome) || a.nome.localeCompare(b.nome))
      .map(e => ({ value: String(e.id), label: `${e.cognome} ${e.nome}` })),
    [attivi],
  );

  const rows = useMemo(() => attivi.filter(e => {
    if (funzioneSel.length && !funzioneSel.includes(funzioneOf(e))) return false;
    if (respSel.length && !(e.capo_id != null && respSel.includes(String(e.capo_id)))) return false;
    return true;
  }), [attivi, funzioneSel, respSel]);

  const groupOf = (e: HrEmployee) => (dividi === 'responsabile' ? respOf(e) : funzioneOf(e));

  // Colonne della divisione scelta (funzioni o responsabili presenti nel filtro)
  const groupCols = useMemo(
    () => (dividi ? Array.from(new Set(rows.map(groupOf))).sort((a, b) => a.localeCompare(b)) : []),
    [rows, dividi],
  );

  // Per ogni capo+colore: taglia → totale e per gruppo (solo i dipendenti filtrati)
  const riepilogoCapi = useMemo(() => {
    const empIds = new Map(rows.map(e => [e.id, e]));
    return capi.map(k => {
      const map = new Map<string, { tot: number; byGroup: Map<string, number> }>();
      for (const t of taglie) {
        if (t.capo_id !== k.id) continue;
        const e = empIds.get(t.employee_id);
        if (!e) continue;
        const slot = map.get(t.taglia) ?? { tot: 0, byGroup: new Map() };
        slot.tot++;
        if (dividi) { const g = groupOf(e); slot.byGroup.set(g, (slot.byGroup.get(g) ?? 0) + 1); }
        map.set(t.taglia, slot);
      }
      const sizes = Array.from(map.entries()).sort((a, b) => compareSize(a[0], b[0]));
      return { ...k, sizes, totale: sizes.reduce((n, [, v]) => n + v.tot, 0) };
    });
  }, [capi, taglie, rows, dividi]);

  // taglia di ogni dipendente per capo: "employee_id:capo_id" → taglia
  const tagliaOf = useMemo(() => new Map(taglie.map(t => [`${t.employee_id}:${t.capo_id}`, t.taglia])), [taglie]);
  const nSenzaTaglie = useMemo(() => rows.filter(e => !capi.some(k => tagliaOf.has(`${e.id}:${k.id}`))).length, [rows, capi, tagliaOf]);

  const elenco = useMemo(
    () => [...rows].sort((a, b) => funzioneOf(a).localeCompare(funzioneOf(b)) || a.cognome.localeCompare(b.cognome) || a.nome.localeCompare(b.nome)),
    [rows],
  );

  // Consegna del vestiario: una data per dipendente
  const consegnaOf = useMemo(() => new Map(consegne.map(c => [c.employee_id, c])), [consegne]);
  const minG = minGiorni.trim() === '' ? null : Math.max(0, parseInt(minGiorni, 10) || 0);

  const righeConsegne = useMemo(() => {
    const list = rows.filter(e => {
      const c = consegnaOf.get(e.id);
      if (statoSel === 'consegnato' && !c) return false;
      if (statoSel === 'da_consegnare' && c) return false;
      if (minG != null && (!c || c.giorni < minG)) return false;
      return true;
    });
    const nome = (a: HrEmployee, b: HrEmployee) => a.cognome.localeCompare(b.cognome) || a.nome.localeCompare(b.nome);
    return list.sort((a, b) => {
      if (ordine === 'nome') return nome(a, b);
      const ga = consegnaOf.get(a.id)?.giorni, gb = consegnaOf.get(b.id)?.giorni;
      // chi non ha ancora ricevuto nulla va in fondo, in entrambi gli ordini
      if (ga == null || gb == null) return ga == null && gb == null ? nome(a, b) : ga == null ? 1 : -1;
      return (ordine === 'vecchie' ? gb - ga : ga - gb) || nome(a, b);
    });
  }, [rows, consegnaOf, statoSel, minG, ordine]);

  const nConsegnati = useMemo(() => rows.filter(e => consegnaOf.has(e.id)).length, [rows, consegnaOf]);
  const selVisibili = righeConsegne.filter(e => sel.has(e.id));
  const tuttiSel = righeConsegne.length > 0 && selVisibili.length === righeConsegne.length;

  function toggleSel(id: number) {
    setSel(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function toggleTutti() {
    setSel(tuttiSel ? new Set() : new Set(righeConsegne.map(e => e.id)));
  }

  async function azioneConsegna(annulla: boolean) {
    const ids = selVisibili.map(e => e.id);
    if (!ids.length) return;
    setSaving(true); setErrore('');
    try {
      if (annulla) await api.post('/api/hr/vestiario/consegne/annulla', { employee_ids: ids });
      else await api.put('/api/hr/vestiario/consegne', { employee_ids: ids, data: dataSel });
      setSel(new Set());
      await loadCapi();
    } catch (e) {
      setErrore(e instanceof Error ? e.message : 'Operazione non riuscita');
    } finally { setSaving(false); }
  }

  function exportExcel() {
    const wb = XLSX.utils.book_new();
    // Foglio 1: da ordinare (capo + colore × taglia, con reparti)
    const ordine: Record<string, string | number>[] = [];
    for (const k of riepilogoCapi) {
      for (const [taglia, v] of k.sizes) {
        const r: Record<string, string | number> = { Capo: k.nome, Colore: k.colore, Taglia: taglia, Totale: v.tot };
        for (const g of groupCols) r[g] = v.byGroup.get(g) ?? 0;
        ordine.push(r);
      }
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ordine), 'Da ordinare');
    // Foglio 2: elenco persone, una colonna per capo
    const persone = elenco.map(e => {
      const r: Record<string, string> = { Cognome: e.cognome, Nome: e.nome, Matricola: e.matricola ?? '', Funzione: e.funzione_aziendale ?? '', Responsabile: respOf(e) === SENZA_RESP ? '' : respOf(e) };
      for (const k of capi) r[k.colore ? `${k.nome} (${k.colore})` : k.nome] = tagliaOf.get(`${e.id}:${k.id}`) ?? '';
      return r;
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(persone), 'Elenco');
    XLSX.writeFile(wb, `vestiario-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  if (!allowed) {
    return (
      <div>
        <PageHeader title="Vestiario" back={{ label: 'Risorse Umane', href: '/hr' }} />
        <div className="card"><EmptyState title="Accesso non consentito" hint="Questa sezione è riservata a HR." /></div>
      </div>
    );
  }

  const cell = (n: number) => (n > 0 ? n : <span className="text-stone-300">·</span>);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Vestiario"
        back={{ label: 'Risorse Umane', href: '/hr' }}
        actions={<>
          <button onClick={() => setModal('gestisci')} className="btn-secondary text-sm">Capi e colori</button>
          <button onClick={exportExcel} disabled={!rows.length} className="btn-secondary text-sm">Esporta Excel</button>
          <button onClick={() => setModal('import')} className="btn-primary text-sm">Importa Excel</button>
        </>}
      />

      <div className="card space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-56">
            <label className="label">Funzione</label>
            <MultiSelectDropdown options={funzioneOptions} selected={funzioneSel} onChange={setFunzioneSel} allLabel="Tutte le funzioni" />
          </div>
          <div className="w-56">
            <label className="label">Responsabile</label>
            <MultiSelectDropdown options={respOptions} selected={respSel} onChange={setRespSel} allLabel="Tutti i responsabili" />
          </div>
          {tab === 'consegne' && (<>
            <div className="w-48">
              <label className="label">Stato</label>
              <select className="input" value={statoSel} onChange={e => setStatoSel(e.target.value as StatoConsegna)}>
                <option value="">Tutti</option>
                <option value="consegnato">Consegnato</option>
                <option value="da_consegnare">Da consegnare</option>
              </select>
            </div>
            <div className="w-44">
              <label className="label">Consegnato da almeno (giorni)</label>
              <input type="number" min={0} className="input" value={minGiorni} onChange={e => setMinGiorni(e.target.value)} placeholder="es. 180" />
            </div>
            <div className="w-52">
              <label className="label">Ordina per</label>
              <select className="input" value={ordine} onChange={e => setOrdine(e.target.value as OrdineConsegne)}>
                <option value="vecchie">Consegna più vecchia</option>
                <option value="recenti">Consegna più recente</option>
                <option value="nome">Cognome</option>
              </select>
            </div>
          </>)}
          {tab === 'capi' && (
            <div className="w-48">
              <label className="label">Dividi per</label>
              <select className="input" value={dividi} onChange={e => setDividi(e.target.value as Dividi)}>
                <option value="">Nessuno (solo totali)</option>
                <option value="funzione">Funzione</option>
                <option value="responsabile">Responsabile</option>
              </select>
            </div>
          )}
        </div>
        <p className="text-sm text-muted">
          {rows.length} {rows.length === 1 ? 'persona' : 'persone'}
          {tab === 'consegne' && <> · {nConsegnati} con vestiario consegnato · {rows.length - nConsegnati} da consegnare</>}
          {capi.length > 0 && nSenzaTaglie > 0 && <> · <span className="text-warning">{nSenzaTaglie} senza nessuna taglia</span></>}
        </p>
      </div>

      <Tabs tabs={TABS} value={tab} onChange={setTab} labels={{ capi: 'Da ordinare', elenco: 'Elenco persone', consegne: 'Vestiario consegnato' }} />

      {loading ? (
        <SkeletonTable rows={6} cols={5} />
      ) : rows.length === 0 ? (
        <div className="card"><EmptyState title="Nessun dipendente" hint="Cambia i filtri per vedere altri risultati." /></div>
      ) : tab === 'capi' ? (
        capi.length === 0 ? (
          <div className="card"><EmptyState title="Nessun capo" hint="Importa un Excel con le taglie per creare capi e colori." /></div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-4">
            {riepilogoCapi.map(k => (
              <div key={k.id} className="card overflow-x-auto !p-0">
                <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-3">
                  <h2 className="font-semibold text-ink-900">{k.nome}{k.colore && <span className="ml-2 font-normal text-muted">{k.colore}</span>}</h2>
                  <span className="whitespace-nowrap text-sm text-muted">{k.totale} da ordinare</span>
                </div>
                {k.sizes.length === 0 ? (
                  <EmptyState title="Nessuna taglia" />
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
                        <th className="px-4 py-2 font-medium">Taglia</th>
                        {groupCols.map(g => <th key={g} className="px-3 py-2 text-right font-medium">{g}</th>)}
                        <th className="px-4 py-2 text-right font-medium">Totale</th>
                      </tr>
                    </thead>
                    <tbody>
                      {k.sizes.map(([taglia, v]) => (
                        <tr key={taglia} className="border-b border-line last:border-0">
                          <td className="px-4 py-2 font-medium text-ink-900">{taglia}</td>
                          {groupCols.map(g => <td key={g} className="px-3 py-2 text-right tabular-nums">{cell(v.byGroup.get(g) ?? 0)}</td>)}
                          <td className="px-4 py-2 text-right font-semibold tabular-nums text-ink-900">{v.tot}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        )
      ) : tab === 'consegne' ? (
        <div className="card overflow-x-auto !p-0">
          {manage && (
            <div className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3">
              <div className="w-44">
                <label className="label">Data di consegna</label>
                <input type="date" className="input" value={dataSel} max={oggi()} onChange={e => setDataSel(e.target.value)} />
              </div>
              <button onClick={() => void azioneConsegna(false)} disabled={saving || !selVisibili.length || !dataSel} className="btn-primary text-sm">
                Segna come consegnato{selVisibili.length > 0 && ` (${selVisibili.length})`}
              </button>
              <button onClick={() => void azioneConsegna(true)} disabled={saving || !selVisibili.length} className="btn-secondary text-sm">
                Annulla consegna
              </button>
              {errore && <span className="text-sm text-danger">{errore}</span>}
            </div>
          )}
          {righeConsegne.length === 0 ? (
            <EmptyState title="Nessun risultato" hint="Cambia i filtri per vedere altre persone." />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
                  {manage && (
                    <th className="w-10 px-4 py-2">
                      <input type="checkbox" checked={tuttiSel} onChange={toggleTutti} aria-label="Seleziona tutti" />
                    </th>
                  )}
                  <th className="px-4 py-2 font-medium">Dipendente</th>
                  <th className="px-3 py-2 font-medium">Funzione</th>
                  <th className="px-3 py-2 font-medium">Responsabile</th>
                  <th className="px-3 py-2 font-medium">Consegnato il</th>
                  <th className="px-3 py-2 text-right font-medium">Giorni</th>
                </tr>
              </thead>
              <tbody>
                {righeConsegne.map(e => {
                  const c = consegnaOf.get(e.id);
                  return (
                    <tr key={e.id} className="border-b border-line last:border-0 hover:bg-stone-50">
                      {manage && (
                        <td className="px-4 py-2">
                          <input type="checkbox" checked={sel.has(e.id)} onChange={() => toggleSel(e.id)} aria-label={`Seleziona ${e.cognome} ${e.nome}`} />
                        </td>
                      )}
                      <td className="px-4 py-2">
                        <Link href={`/hr/dipendenti/${e.id}`} className="font-medium text-ink-900 hover:text-accent-ink">{e.cognome} {e.nome}</Link>
                      </td>
                      <td className="px-3 py-2">{e.funzione_aziendale ?? '—'}</td>
                      <td className="px-3 py-2">{respOf(e) === SENZA_RESP ? '—' : respOf(e)}</td>
                      <td className="px-3 py-2">{c ? fmtData(c.consegnato_il) : <span className="text-warning">Da consegnare</span>}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink-900">{c ? c.giorni : <span className="text-stone-300">·</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="px-4 py-2 font-medium">Dipendente</th>
                <th className="px-3 py-2 font-medium">Funzione</th>
                <th className="px-3 py-2 font-medium">Responsabile</th>
                {capi.map(k => <th key={k.id} className="px-3 py-2 font-medium">{k.nome}{k.colore && <span className="block text-[10px] normal-case tracking-normal">{k.colore}</span>}</th>)}
              </tr>
            </thead>
            <tbody>
              {elenco.map(e => (
                <tr key={e.id} className="border-b border-line last:border-0 hover:bg-stone-50">
                  <td className="px-4 py-2">
                    <Link href={`/hr/dipendenti/${e.id}`} className="font-medium text-ink-900 hover:text-accent-ink">{e.cognome} {e.nome}</Link>
                  </td>
                  <td className="px-3 py-2">{e.funzione_aziendale ?? '—'}</td>
                  <td className="px-3 py-2">{respOf(e) === SENZA_RESP ? '—' : respOf(e)}</td>
                  {capi.map(k => (
                    <td key={k.id} className="px-3 py-2">{tagliaOf.get(`${e.id}:${k.id}`) ?? <span className="text-stone-300">·</span>}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modal === 'import' && <ImportCapiModal onClose={() => setModal(null)} onDone={() => { setModal(null); void loadCapi(); }} />}
      {modal === 'gestisci' && <GestisciCapiModal capi={capi} onClose={() => setModal(null)} onChanged={() => void loadCapi()} />}
    </div>
  );
}
