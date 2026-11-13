'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import { useAuth } from '@/lib/auth';
import type { HrEmployee, HrDepartment, HrPlant } from '@/types';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tabs } from '@/components/ui/Tabs';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

type Cat = 'pantaloni' | 'maglia' | 'scarpe';
const CATS: { key: Cat; label: string; field: 'taglia_pantaloni' | 'taglia_maglia' | 'taglia_scarpe' }[] = [
  { key: 'pantaloni', label: 'Pantaloni', field: 'taglia_pantaloni' },
  { key: 'maglia',    label: 'Maglia',    field: 'taglia_maglia' },
  { key: 'scarpe',    label: 'Scarpe',    field: 'taglia_scarpe' },
];

const TABS = ['riepilogo', 'elenco'] as const;
type Tab = typeof TABS[number];

const SENZA_REPARTO = 'Senza reparto';
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
  const [departments, setDepartments] = useState<HrDepartment[]>([]);
  const [plants, setPlants] = useState<HrPlant[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('riepilogo');
  const [repartoSel, setRepartoSel] = useState<string[]>([]);
  const [plantSel, setPlantSel] = useState<string[]>([]);
  const [soloAttivi, setSoloAttivi] = useState(true);
  const [soloMancanti, setSoloMancanti] = useState(false);
  const [perReparto, setPerReparto] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!allowed) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      const [e, d, p] = await Promise.all([
        fetch(`${BACKEND}/api/hr/employees`, { credentials: 'include' }),
        fetch(`${BACKEND}/api/hr/departments`, { credentials: 'include' }),
        fetch(`${BACKEND}/api/hr/plants`, { credentials: 'include' }),
      ]);
      if (cancelled) return;
      if (e.ok) setEmployees(await e.json());
      if (d.ok) setDepartments(await d.json());
      if (p.ok) setPlants(await p.json());
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [allowed]);

  const manca = (e: HrEmployee) => CATS.some(c => !norm(e[c.field]));

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter(e => {
      if (soloAttivi && e.stato === 'cessato') return false;
      if (repartoSel.length && !repartoSel.includes(String(e.reparto_id ?? 0))) return false;
      if (plantSel.length && !(e.plant_ids ?? []).some(id => plantSel.includes(String(id)))) return false;
      if (soloMancanti && !manca(e)) return false;
      if (q && !`${e.cognome} ${e.nome} ${e.matricola ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [employees, soloAttivi, repartoSel, plantSel, soloMancanti, search]);

  const repartoName = (e: HrEmployee) => e.reparto_name ?? SENZA_REPARTO;

  // Reparti presenti nel filtro (colonne della vista "per reparto")
  const repartiCols = useMemo(
    () => Array.from(new Set(rows.map(repartoName))).sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  // Per ogni categoria: taglia → { totale, per reparto }
  const riepilogo = useMemo(() => CATS.map(c => {
    const map = new Map<string, { tot: number; byRep: Map<string, number> }>();
    let mancanti = 0;
    for (const e of rows) {
      const s = norm(e[c.field]);
      if (!s) { mancanti++; continue; }
      const slot = map.get(s) ?? { tot: 0, byRep: new Map() };
      slot.tot++;
      const r = repartoName(e);
      slot.byRep.set(r, (slot.byRep.get(r) ?? 0) + 1);
      map.set(s, slot);
    }
    const sizes = Array.from(map.entries()).sort((a, b) => compareSize(a[0], b[0]));
    return { ...c, sizes, mancanti, totale: sizes.reduce((n, [, v]) => n + v.tot, 0) };
  }), [rows]);

  const nMancanti = useMemo(() => rows.filter(manca).length, [rows]);

  const elenco = useMemo(
    () => [...rows].sort((a, b) => repartoName(a).localeCompare(repartoName(b)) || a.cognome.localeCompare(b.cognome) || a.nome.localeCompare(b.nome)),
    [rows],
  );

  function exportExcel() {
    const wb = XLSX.utils.book_new();
    // Foglio 1: da ordinare (taglia × quantità, con reparti)
    const ordine: Record<string, string | number>[] = [];
    for (const c of riepilogo) {
      for (const [taglia, v] of c.sizes) {
        const r: Record<string, string | number> = { Capo: c.label, Taglia: taglia, Totale: v.tot };
        for (const rep of repartiCols) r[rep] = v.byRep.get(rep) ?? 0;
        ordine.push(r);
      }
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ordine), 'Da ordinare');
    // Foglio 2: elenco persone
    const persone = elenco.map(e => ({
      Cognome: e.cognome, Nome: e.nome, Matricola: e.matricola ?? '', Reparto: e.reparto_name ?? '', Plant: e.plant_name ?? '',
      Pantaloni: e.taglia_pantaloni ?? '', Maglia: e.taglia_maglia ?? '', Scarpe: e.taglia_scarpe ?? '',
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

  const repOptions = [
    ...departments.filter(d => d.is_active).map(d => ({ value: String(d.id), label: d.name })),
    { value: '0', label: SENZA_REPARTO },
  ];
  const plantOptions = plants.filter(p => p.is_active).map(p => ({ value: String(p.id), label: p.name }));

  const cell = (n: number) => (n > 0 ? n : <span className="text-stone-300">·</span>);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Vestiario"
        back={{ label: 'Risorse Umane', href: '/hr' }}
        description="Taglie di pantaloni, maglia e scarpe: quante ne servono per reparto, per ordinare"
        actions={<button onClick={exportExcel} disabled={!rows.length} className="btn-secondary text-sm">Esporta Excel</button>}
      />

      <div className="card space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-56">
            <label className="label">Reparto</label>
            <MultiSelectDropdown options={repOptions} selected={repartoSel} onChange={setRepartoSel} allLabel="Tutti i reparti" />
          </div>
          <div className="w-44">
            <label className="label">Plant</label>
            <MultiSelectDropdown options={plantOptions} selected={plantSel} onChange={setPlantSel} allLabel="Tutti i plant" />
          </div>
          <div className="w-56">
            <label className="label">Cerca</label>
            <input className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Cognome, nome, matricola" />
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm text-ink-900">
            <input type="checkbox" checked={soloAttivi} onChange={e => setSoloAttivi(e.target.checked)} /> Escludi cessati
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm text-ink-900">
            <input type="checkbox" checked={soloMancanti} onChange={e => setSoloMancanti(e.target.checked)} /> Solo con taglie mancanti
          </label>
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
        <>
          <label className="flex items-center gap-2 text-sm text-ink-900">
            <input type="checkbox" checked={perReparto} onChange={e => setPerReparto(e.target.checked)} /> Dividi per reparto
          </label>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
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
                        {perReparto && repartiCols.map(r => <th key={r} className="px-3 py-2 text-right font-medium">{r}</th>)}
                        <th className="px-4 py-2 text-right font-medium">Totale</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.sizes.map(([taglia, v]) => (
                        <tr key={taglia} className="border-b border-line last:border-0">
                          <td className="px-4 py-2 font-medium text-ink-900">{taglia}</td>
                          {perReparto && repartiCols.map(r => <td key={r} className="px-3 py-2 text-right tabular-nums">{cell(v.byRep.get(r) ?? 0)}</td>)}
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
        </>
      ) : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="px-4 py-2 font-medium">Dipendente</th>
                <th className="px-3 py-2 font-medium">Matricola</th>
                <th className="px-3 py-2 font-medium">Reparto</th>
                <th className="px-3 py-2 font-medium">Plant</th>
                {CATS.map(c => <th key={c.key} className="px-3 py-2 font-medium">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {elenco.map(e => (
                <tr key={e.id} className="border-b border-line last:border-0 hover:bg-stone-50">
                  <td className="px-4 py-2">
                    <Link href={`/hr/dipendenti/${e.id}`} className="font-medium text-ink-900 hover:text-accent-ink">{e.cognome} {e.nome}</Link>
                  </td>
                  <td className="px-3 py-2 text-muted">{e.matricola ?? '—'}</td>
                  <td className="px-3 py-2">{e.reparto_name ?? '—'}</td>
                  <td className="px-3 py-2">{e.plant_name ?? '—'}</td>
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
