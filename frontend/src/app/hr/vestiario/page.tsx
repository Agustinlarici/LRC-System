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

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

type Cat = 'pantaloni' | 'maglia' | 'scarpe' | 'giubbotto';
const CATS: { key: Cat; label: string; field: 'taglia_pantaloni' | 'taglia_maglia' | 'taglia_scarpe' | 'taglia_campera' }[] = [
  { key: 'pantaloni', label: 'Pantaloni', field: 'taglia_pantaloni' },
  { key: 'maglia',    label: 'Maglia',    field: 'taglia_maglia' },
  { key: 'scarpe',    label: 'Scarpe',    field: 'taglia_scarpe' },
  { key: 'giubbotto',   label: 'Giubbotto',   field: 'taglia_campera' },
];

const TABS = ['riepilogo', 'elenco'] as const;
type Tab = typeof TABS[number];

type Dividi = '' | 'funzione' | 'responsabile';
const SENZA_FUNZIONE = 'Senza funzione';
const SENZA_RESP = 'Senza responsabile';
const LETTER_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', 'XXXL', '3XL', '4XL', '5XL', '6XL'];

// Normalizza la taglia scritta a mano: spazi, maiuscole, virgola decimale (42,5 → 42.5)
const norm = (v: string | null | undefined) => (v ?? '').trim().toUpperCase().replace(',', '.');

// Ordine naturale: prima le taglie a lettere (XS…6XL), poi le numeriche, poi il resto
function sizeRank(s: string): [number, number, string] {
  const li = LETTER_ORDER.indexOf(s);
  if (li >= 0) return [0, li, s];
  const n = parseFloat(s);
  if (!isNaN(n)) return [1, n, s];
  return [2, 0, s];
}
function compareSize(a: string, b: string) {
  const ra = sizeRank(a), rb = sizeRank(b);
  return ra[0] - rb[0] || ra[1] - rb[1] || ra[2].localeCompare(rb[2]);
}

export default function VestiarioPage() {
  const { canView } = useAuth();
  const allowed = canView('hr');

  const [employees, setEmployees] = useState<HrEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('riepilogo');
  const [funzioneSel, setFunzioneSel] = useState<string[]>([]);
  const [respSel, setRespSel] = useState<string[]>([]);
  const [dividi, setDividi] = useState<Dividi>('');

  useEffect(() => {
    if (!allowed) { setLoading(false); return; }
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

  const manca = (e: HrEmployee) => CATS.some(c => !norm(e[c.field]));

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

  // Per ogni capo: taglia → { totale, per gruppo }
  const riepilogo = useMemo(() => CATS.map(c => {
    const map = new Map<string, { tot: number; byGroup: Map<string, number> }>();
    let mancanti = 0;
    for (const e of rows) {
      const s = norm(e[c.field]);
      if (!s) { mancanti++; continue; }
      const slot = map.get(s) ?? { tot: 0, byGroup: new Map() };
      slot.tot++;
      if (dividi) { const g = groupOf(e); slot.byGroup.set(g, (slot.byGroup.get(g) ?? 0) + 1); }
      map.set(s, slot);
    }
    const sizes = Array.from(map.entries()).sort((a, b) => compareSize(a[0], b[0]));
    return { ...c, sizes, mancanti, totale: sizes.reduce((n, [, v]) => n + v.tot, 0) };
  }), [rows, dividi]);

  const nMancanti = useMemo(() => rows.filter(manca).length, [rows]);

  const elenco = useMemo(
    () => [...rows].sort((a, b) => funzioneOf(a).localeCompare(funzioneOf(b)) || a.cognome.localeCompare(b.cognome) || a.nome.localeCompare(b.nome)),
    [rows],
  );

  function exportExcel() {
    const wb = XLSX.utils.book_new();
    // Foglio 1: da ordinare (taglia × quantità, con reparti)
    const ordine: Record<string, string | number>[] = [];
    for (const c of riepilogo) {
      for (const [taglia, v] of c.sizes) {
        const r: Record<string, string | number> = { Capo: c.label, Taglia: taglia, Totale: v.tot };
        for (const g of groupCols) r[g] = v.byGroup.get(g) ?? 0;
        ordine.push(r);
      }
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ordine), 'Da ordinare');
    // Foglio 2: elenco persone
    const persone = elenco.map(e => ({
      Cognome: e.cognome, Nome: e.nome, Matricola: e.matricola ?? '', Funzione: e.funzione_aziendale ?? '', Responsabile: respOf(e) === SENZA_RESP ? '' : respOf(e),
      Pantaloni: e.taglia_pantaloni ?? '', Maglia: e.taglia_maglia ?? '', Scarpe: e.taglia_scarpe ?? '', Giubbotto: e.taglia_campera ?? '',
    }));
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
        actions={<button onClick={exportExcel} disabled={!rows.length} className="btn-secondary text-sm">Esporta Excel</button>}
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
          {tab === 'riepilogo' && (
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
          {nMancanti > 0 && <> · <span className="text-warning">{nMancanti} con almeno una taglia mancante</span></>}
        </p>
      </div>

      <Tabs tabs={TABS} value={tab} onChange={setTab} labels={{ riepilogo: 'Da ordinare', elenco: 'Elenco persone' }} />

      {loading ? (
        <SkeletonTable rows={6} cols={5} />
      ) : rows.length === 0 ? (
        <div className="card"><EmptyState title="Nessun dipendente" hint="Cambia i filtri per vedere altri risultati." /></div>
      ) : tab === 'riepilogo' ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-4">
          {riepilogo.map(c => (
            <div key={c.key} className="card overflow-x-auto !p-0">
              <div className="flex items-baseline justify-between border-b border-line px-4 py-3">
                <h2 className="font-semibold text-ink-900">{c.label}</h2>
                <span className="text-sm text-muted">{c.totale} da ordinare</span>
              </div>
              {c.sizes.length === 0 ? (
                <EmptyState title="Nessuna taglia inserita" />
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
                    {c.sizes.map(([taglia, v]) => (
                      <tr key={taglia} className="border-b border-line last:border-0">
                        <td className="px-4 py-2 font-medium text-ink-900">{taglia}</td>
                        {groupCols.map(g => <td key={g} className="px-3 py-2 text-right tabular-nums">{cell(v.byGroup.get(g) ?? 0)}</td>)}
                        <td className="px-4 py-2 text-right font-semibold tabular-nums text-ink-900">{v.tot}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {c.mancanti > 0 && (
                <p className="border-t border-line px-4 py-2 text-xs text-warning">{c.mancanti} senza taglia</p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="px-4 py-2 font-medium">Dipendente</th>
                <th className="px-3 py-2 font-medium">Funzione</th>
                <th className="px-3 py-2 font-medium">Responsabile</th>
                {CATS.map(c => <th key={c.key} className="px-3 py-2 font-medium">{c.label}</th>)}
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
                  {CATS.map(c => (
                    <td key={c.key} className="px-3 py-2">
                      {norm(e[c.field]) ? e[c.field] : <span className="text-warning">mancante</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
