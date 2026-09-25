'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell, PieChart, Pie,
} from 'recharts';
import type { HrEmployee, HrPlant } from '@/types';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

// Stessa palette categorica usata nel resto del modulo HR
const PALETTE = ['#2563eb', '#8b5cf6', '#f59e0b', '#10b981', '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#84cc16', '#ef4444'];
const OTHER_COLOR = '#94a3b8';
const NA = 'N/D';
const TICK = { fontSize: 12, fill: '#374151' };

// ─── Dimensioni di analisi ─────────────────────────────────────────────────────

type Dim = 'plant' | 'societa' | 'categoria' | 'tipologia' | 'livello' | 'responsabile' | 'reparto' | 'nazionalita' | 'sesso';

const DIM_LABEL: Record<Dim, string> = {
  plant: 'Plant', societa: 'Società', categoria: 'Categoria', tipologia: 'Tipologia', livello: 'Livello',
  responsabile: 'Responsabile', reparto: 'Reparto', nazionalita: 'Nazionalità', sesso: 'Sesso',
};
const FILTER_ORDER: Dim[] = ['plant', 'societa', 'categoria', 'tipologia', 'livello', 'responsabile', 'reparto', 'nazionalita', 'sesso'];

type Filters = Partial<Record<Dim, string[]>>;

function valuesOf(e: HrEmployee, dim: Dim, plantName: Map<number, string>): string[] {
  const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : NA);
  switch (dim) {
    case 'societa':      return [clean(e.contract_company_name)];
    case 'nazionalita':  return [clean(e.nazionalita)];
    case 'sesso':        return [clean(e.sesso)];
    case 'categoria':    return [clean(e.categoria)];
    case 'tipologia':    return [clean(e.tipo_contratto)];
    case 'livello':      return [clean(e.livello)];
    case 'responsabile': return [clean(e.capo_nome)];
    case 'reparto':      return [clean(e.reparto_name)];
    // Una persona può lavorare su più sedi: conta in ognuna
    case 'plant':        return e.plant_ids?.length ? e.plant_ids.map(id => plantName.get(id) ?? NA) : [NA];
  }
}

type Count = { name: string; value: number };

function countBy(list: HrEmployee[], dim: Dim, plantName: Map<number, string>, sort: 'value' | 'name' = 'value'): Count[] {
  const m = new Map<string, number>();
  for (const e of list) for (const v of valuesOf(e, dim, plantName)) m.set(v, (m.get(v) ?? 0) + 1);
  const rows = [...m.entries()].map(([name, value]) => ({ name, value }));
  return sort === 'name'
    ? rows.sort((a, b) => a.name.localeCompare(b.name, 'it', { numeric: true }))
    : rows.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

function topN(data: Count[], n: number): Count[] {
  if (data.length <= n) return data;
  const rest = data.slice(n).reduce((s, d) => s + d.value, 0);
  return [...data.slice(0, n), { name: 'Altre', value: rest }];
}

// Pivot: una riga per rowDim, una colonna per serDim
function crossBy(list: HrEmployee[], rowDim: Dim, serDim: Dim, plantName: Map<number, string>) {
  const seriesTotals = new Map<string, number>();
  const rows = new Map<string, Record<string, number | string>>();
  for (const e of list) {
    for (const r of valuesOf(e, rowDim, plantName)) {
      if (!rows.has(r)) rows.set(r, { name: r, _total: 0 });
      const row = rows.get(r)!;
      for (const s of valuesOf(e, serDim, plantName)) {
        row[s] = ((row[s] as number) ?? 0) + 1;
        row._total = (row._total as number) + 1;
        seriesTotals.set(s, (seriesTotals.get(s) ?? 0) + 1);
      }
    }
  }
  const series = [...seriesTotals.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  const data = [...rows.values()].sort((a, b) => (b._total as number) - (a._total as number) || String(a.name).localeCompare(String(b.name)));
  return { data, series };
}

const isDeterminato = (t: string | null | undefined) => /determinat/i.test(t ?? '') && !/indeterminat/i.test(t ?? '');
const iso = (d: string | null | undefined) => (d ? d.slice(0, 10) : '');
const fmtDate = (d: string) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');
const pct = (n: number, tot: number) => (tot ? `${Math.round((n / tot) * 100)}%` : '—');

// ─── Contesto vista (grafici / tabelle) ────────────────────────────────────────

type Mode = 'chart' | 'table';
const ModeCtx = createContext<Mode>('chart');

// ─── Blocchi UI ────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest pt-2">{title}</h2>
      {children}
    </div>
  );
}

function DataTable({ head, rows, foot }: { head: string[]; rows: (string | number)[][]; foot?: (string | number)[] }) {
  if (rows.length === 0) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-xs text-gray-400 uppercase tracking-wide">
            {head.map((h, i) => <th key={i} className={`py-2 px-2 font-medium ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-b border-gray-50">
              {r.map((c, ci) => <td key={ci} className={`py-1.5 px-2 ${ci === 0 ? 'text-left text-gray-800' : 'text-right text-gray-600 tabular-nums'}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
        {foot && (
          <tfoot>
            <tr className="border-t border-gray-300 font-semibold text-gray-800">
              {foot.map((c, ci) => <td key={ci} className={`py-2 px-2 ${ci === 0 ? 'text-left' : 'text-right tabular-nums'}`}>{c}</td>)}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

const Empty = () => <p className="text-sm text-gray-400 text-center py-10">Nessun dato</p>;

// Card con grafico o tabella (a seconda della vista globale), stampabile singolarmente
function Card({ title, hint, chart, table, className = '', canPct = false }: {
  title: string; hint?: string; chart: (pct: boolean) => React.ReactNode; table: React.ReactNode; className?: string; canPct?: boolean;
}) {
  const mode = useContext(ModeCtx);
  const ref = useRef<HTMLDivElement>(null);
  const [asPct, setAsPct] = useState(false);

  function printOne() {
    const el = ref.current;
    if (!el) return;
    el.setAttribute('data-print-target', '1');
    document.body.setAttribute('data-print-only', '1');
    const cleanup = () => {
      el.removeAttribute('data-print-target');
      document.body.removeAttribute('data-print-only');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
  }

  return (
    <div ref={ref} className={`card print-card ${className}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-base font-medium text-gray-700">{title}</p>
          {hint && <p className="text-xs text-gray-400 mb-2">{hint}</p>}
        </div>
        <div className="flex gap-1.5 d-print-none shrink-0">
          {canPct && mode === 'chart' && (
            <button type="button" onClick={() => setAsPct(v => !v)} className="btn-secondary text-xs px-2.5 py-1">{asPct ? 'Valori' : '% sul totale'}</button>
          )}
          <button type="button" onClick={printOne} title="Stampa solo questo riquadro" className="btn-secondary text-xs px-2.5 py-1">Stampa</button>
        </div>
      </div>
      <div className={hint ? '' : 'mt-2'}>{mode === 'chart' ? chart(asPct) : table}</div>
    </div>
  );
}

// ─── Grafici ───────────────────────────────────────────────────────────────────

function Bars({ data, color = PALETTE[0] }: { data: Count[]; color?: string }) {
  if (data.length === 0) return <Empty />;
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, data.length * 30 + 20)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 48, bottom: 0, left: 0 }}>
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis type="category" dataKey="name" width={140} tick={TICK} axisLine={false} tickLine={false} />
        <Tooltip cursor={{ fill: '#f3f4f6' }} formatter={(v: any) => [`${v} (${pct(Number(v), total)})`, 'Persone']} />
        <Bar dataKey="value" name="Persone" radius={[0, 4, 4, 0]} barSize={16}
          label={{ position: 'right', fontSize: 12, fill: '#374151' }}>
          {data.map(d => <Cell key={d.name} fill={d.name === NA || d.name === 'Altre' ? OTHER_COLOR : color} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function Donut({ data, colorFor }: { data: Count[]; colorFor: (name: string) => string }) {
  if (data.length === 0) return <Empty />;
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex items-center gap-4 flex-wrap">
      <div className="relative w-40 h-40 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={2} stroke="none">
              {data.map(d => <Cell key={d.name} fill={colorFor(d.name)} />)}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-2xl font-semibold text-gray-800 leading-none">{total}</span>
          <span className="text-[10px] text-gray-400 mt-1">persone</span>
        </div>
      </div>
      <div className="flex-1 min-w-[140px] flex flex-col gap-1.5">
        {data.map(d => (
          <div key={d.name} className="flex items-center gap-2 text-sm">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colorFor(d.name) }} />
            <span className="truncate flex-1 text-gray-700">{d.name}</span>
            <span className="text-gray-500 tabular-nums">{d.value} · {pct(d.value, total)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stacked({ data, series, colorFor, asPct, labelWidth = 140 }: {
  data: Record<string, number | string>[]; series: string[]; colorFor: (s: string) => string; asPct: boolean; labelWidth?: number;
}) {
  if (data.length === 0) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 34 + 70)}>
      <BarChart data={data} layout="vertical" stackOffset={asPct ? 'expand' : 'none'} margin={{ top: 0, right: 24, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
        <XAxis type="number" allowDecimals={false} tick={TICK} tickFormatter={asPct ? (v: number) => `${Math.round(v * 100)}%` : undefined} />
        <YAxis type="category" dataKey="name" width={labelWidth} tick={TICK} axisLine={false} tickLine={false} />
        <Tooltip cursor={{ fill: '#f3f4f6' }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map(s => <Bar key={s} dataKey={s} stackId="a" fill={colorFor(s)} stroke="#fff" strokeWidth={1} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

function crossTable(cross: { data: Record<string, number | string>[]; series: string[] }, rowLabel: string) {
  const totals = cross.series.map(s => cross.data.reduce((sum, r) => sum + ((r[s] as number) ?? 0), 0));
  return (
    <DataTable
      head={[rowLabel, ...cross.series, 'Totale']}
      rows={cross.data.map(r => [r.name as string, ...cross.series.map(s => (r[s] as number) ?? '—'), r._total as number])}
      foot={['Totale', ...totals, totals.reduce((a, b) => a + b, 0)]}
    />
  );
}

// ─── Filtro a tendina con selezione multipla ───────────────────────────────────

function MultiFilter({ label, options, value, onChange }: {
  label: string; options: Count[]; value: string[]; onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v]);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        className={`text-sm px-3 py-1.5 rounded-lg border flex items-center gap-1.5 ${value.length ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-300 text-gray-600'} hover:border-blue-400`}>
        {label}{value.length > 0 && <span className="bg-blue-600 text-white text-[10px] rounded-full px-1.5">{value.length}</span>}
        <span className="text-[10px]">▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 w-64 max-h-72 overflow-auto bg-white border border-gray-200 rounded-lg shadow-lg p-1.5">
            {options.length === 0 && <p className="text-xs text-gray-400 p-2">Nessun valore</p>}
            {options.map(o => (
              <label key={o.name} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer text-sm text-gray-700">
                <input type="checkbox" checked={value.includes(o.name)} onChange={() => toggle(o.name)} />
                <span className="flex-1 truncate">{o.name}</span>
                <span className="text-xs text-gray-400">{o.value}</span>
              </label>
            ))}
            {value.length > 0 && (
              <button type="button" onClick={() => onChange([])} className="btn-secondary text-xs w-full mt-1">Deseleziona {label}</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: 'warn' }) {
  return (
    <div className="card print-card p-4">
      <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">{label}</p>
      <p className={`text-3xl font-semibold leading-none mt-2 ${tone === 'warn' ? 'text-amber-600' : 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-2">{sub}</p>}
    </div>
  );
}

// ─── Componente principale ─────────────────────────────────────────────────────

type Tab = 'riepilogo' | 'persone' | 'contratti' | 'stabilimenti' | 'scadenze' | 'eta' | 'tutto';
const TABS: { key: Tab; label: string }[] = [
  { key: 'riepilogo', label: 'Riepilogo' }, { key: 'persone', label: 'Persone' }, { key: 'contratti', label: 'Contratti' },
  { key: 'stabilimenti', label: 'Stabilimenti e responsabili' }, { key: 'scadenze', label: 'Scadenze e cessazioni' },
  { key: 'eta', label: 'Età e reparti' }, { key: 'tutto', label: 'Tutto' },
];

export function AnalisiOrganico({ extra }: { extra: React.ReactNode }) {
  const [all, setAll] = useState<HrEmployee[]>([]);
  const [plants, setPlants] = useState<HrPlant[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>({});
  const [tab, setTab] = useState<Tab>('riepilogo');
  const [mode, setMode] = useState<Mode>('chart');

  useEffect(() => {
    (async () => {
      const [eRes, pRes] = await Promise.all([
        fetch(`${BACKEND}/api/hr/employees`, { credentials: 'include' }),
        fetch(`${BACKEND}/api/hr/plants`, { credentials: 'include' }),
      ]);
      if (eRes.ok) setAll(await eRes.json());
      if (pRes.ok) setPlants(await pRes.json());
      setLoading(false);
    })();
  }, []);

  const plantName = useMemo(() => new Map(plants.map(p => [p.id, p.name])), [plants]);
  const allActive = useMemo(() => all.filter(e => e.stato !== 'cessato'), [all]);

  // Colori stabili: un valore ha sempre lo stesso colore, qualunque filtro sia attivo
  const colorMaps = useMemo(() => {
    const maps = {} as Record<Dim, Map<string, string>>;
    for (const dim of FILTER_ORDER) {
      const m = new Map<string, string>();
      countBy(allActive, dim, plantName).forEach((c, i) => m.set(c.name, c.name === NA || i >= PALETTE.length ? OTHER_COLOR : PALETTE[i]));
      maps[dim] = m;
    }
    return maps;
  }, [allActive, plantName]);
  const colorFor = (dim: Dim) => (name: string) => colorMaps[dim]?.get(name) ?? OTHER_COLOR;

  const matches = useMemo(() => (e: HrEmployee) =>
    (Object.entries(filters) as [Dim, string[]][]).every(([dim, sel]) =>
      !sel.length || valuesOf(e, dim, plantName).some(v => sel.includes(v))),
  [filters, plantName]);

  const active = useMemo(() => allActive.filter(matches), [allActive, matches]);
  const filteredAll = useMemo(() => all.filter(matches), [all, matches]);

  const today = new Date().toISOString().slice(0, 10);
  const plus = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };

  // Contratti in scadenza (attivi con fine contratto futura)
  const expiring = useMemo(() =>
    active.filter(e => iso(e.data_cessazione) > today).sort((a, b) => iso(a.data_cessazione).localeCompare(iso(b.data_cessazione))),
  [active, today]);
  const expiring90 = expiring.filter(e => iso(e.data_cessazione) <= plus(90));

  const yearly = useMemo(() => {
    const years = new Map<string, { anno: string; cessazioni: number; scaduti: number; inScadenza: number }>();
    const row = (y: string) => { if (!years.has(y)) years.set(y, { anno: y, cessazioni: 0, scaduti: 0, inScadenza: 0 }); return years.get(y)!; };
    for (const e of filteredAll) {
      const d = iso(e.data_cessazione);
      if (!d) continue;
      const r = row(d.slice(0, 4));
      if (d <= today) { r.cessazioni++; if (isDeterminato(e.tipo_contratto)) r.scaduti++; }
      else if (e.stato !== 'cessato') r.inScadenza++;
    }
    return [...years.values()].sort((a, b) => a.anno.localeCompare(b.anno));
  }, [filteredAll, today]);

  const monthly = useMemo(() => {
    const months: { mese: string; key: string; count: number }[] = [];
    const base = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(base.getFullYear(), base.getMonth() + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months.push({ key, mese: `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`, count: 0 });
    }
    for (const e of expiring) { const m = months.find(x => x.key === iso(e.data_cessazione).slice(0, 7)); if (m) m.count++; }
    return months;
  }, [expiring]);

  if (loading) return <p className="text-sm text-gray-400 text-center py-10">Caricamento…</p>;

  const show = (t: Tab) => tab === t || tab === 'tutto';
  const cur = new Date().getFullYear();
  const totActive = active.length;
  const determinati = active.filter(e => isDeterminato(e.tipo_contratto)).length;
  const senzaResp = active.filter(e => !e.capo_id).length;
  const cessCurYear = yearly.find(y => y.anno === String(cur))?.cessazioni ?? 0;
  const activeFilters = FILTER_ORDER.filter(d => filters[d]?.length);

  // Tabelle e grafici riutilizzati
  const countCard = (title: string, dim: Dim, opts: { hint?: string; sort?: 'value' | 'name'; top?: number; donut?: boolean; className?: string } = {}) => {
    const raw = countBy(active, dim, plantName, opts.sort);
    const data = opts.top ? topN(raw, opts.top) : raw;
    const total = data.reduce((s, d) => s + d.value, 0);
    return (
      <Card title={title} hint={opts.hint} className={opts.className}
        chart={() => opts.donut ? <Donut data={data} colorFor={colorFor(dim)} /> : <Bars data={data} />}
        table={<DataTable head={[DIM_LABEL[dim], 'Persone', '%']} rows={data.map(d => [d.name, d.value, pct(d.value, total)])} foot={['Totale', total, '100%']} />} />
    );
  };

  const crossCard = (title: string, rowDim: Dim, serDim: Dim, opts: { hint?: string; maxRows?: number; className?: string } = {}) => {
    const cross = crossBy(active, rowDim, serDim, plantName);
    const shown = opts.maxRows ? cross.data.slice(0, opts.maxRows) : cross.data;
    return (
      <Card title={title} canPct hint={opts.hint} className={opts.className}
        chart={asPct => <Stacked data={shown} series={cross.series} colorFor={colorFor(serDim)} asPct={asPct} />}
        table={crossTable(cross, DIM_LABEL[rowDim])} />
    );
  };

  const expiringTable = (rows: HrEmployee[]) => (
    <DataTable
      head={['Cognome e nome', 'Plant', 'Responsabile', 'Tipologia', 'Scadenza', 'Giorni']}
      rows={rows.map(e => {
        const d = iso(e.data_cessazione);
        const days = Math.round((new Date(d).getTime() - new Date(today).getTime()) / 86400000);
        return [`${e.cognome} ${e.nome}`, valuesOf(e, 'plant', plantName).join(', '), e.capo_nome ?? '—', e.tipo_contratto ?? '—', fmtDate(d), days];
      })}
    />
  );

  const cessazioniCard = (
    <Card title="Cessazioni e contratti scaduti per anno"
      hint="Scaduti = cessazioni di contratti a tempo determinato. In scadenza = attivi con fine contratto in quell'anno."
      chart={() => yearly.length === 0 ? <Empty /> : (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={yearly} margin={{ top: 16, right: 16, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
            <XAxis dataKey="anno" tick={TICK} />
            <YAxis allowDecimals={false} tick={TICK} />
            <Tooltip cursor={{ fill: '#f3f4f6' }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="cessazioni" name="Cessazioni" fill={PALETTE[0]} radius={[4, 4, 0, 0]} label={{ position: 'top', fontSize: 11, fill: '#374151' }} />
            <Bar dataKey="scaduti" name="Contratti scaduti" fill={PALETTE[2]} radius={[4, 4, 0, 0]} label={{ position: 'top', fontSize: 11, fill: '#374151' }} />
            <Bar dataKey="inScadenza" name="In scadenza (attivi)" fill={PALETTE[3]} radius={[4, 4, 0, 0]} label={{ position: 'top', fontSize: 11, fill: '#374151' }} />
          </BarChart>
        </ResponsiveContainer>
      )}
      table={<DataTable head={['Anno', 'Cessazioni', 'Contratti scaduti', 'In scadenza (attivi)']} rows={yearly.map(y => [y.anno, y.cessazioni, y.scaduti, y.inScadenza])} />} />
  );

  const monthlyCard = (
    <Card title="Scadenze dei prossimi 12 mesi" hint="Contratti attivi che terminano, per mese: serve a pianificare rinnovi e sostituzioni"
      chart={() => (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={monthly} margin={{ top: 16, right: 16, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
            <XAxis dataKey="mese" tick={TICK} />
            <YAxis allowDecimals={false} tick={TICK} />
            <Tooltip cursor={{ fill: '#f3f4f6' }} />
            <Bar dataKey="count" name="Contratti in scadenza" fill={PALETTE[2]} radius={[4, 4, 0, 0]} label={{ position: 'top', fontSize: 11, fill: '#374151' }} />
          </BarChart>
        </ResponsiveContainer>
      )}
      table={<DataTable head={['Mese', 'Contratti in scadenza']} rows={monthly.map(m => [m.mese, m.count])} foot={['Totale', monthly.reduce((s, m) => s + m.count, 0)]} />} />
  );

  const expiringCard = (
    <Card title="Contratti in scadenza nei prossimi 90 giorni" className="lg:col-span-2"
      hint={`${expiring90.length} ${expiring90.length === 1 ? 'persona' : 'persone'} — ordinate per data di scadenza`}
      chart={() => expiring90.length === 0 ? <Empty /> : expiringTable(expiring90)}
      table={expiringTable(expiring90)} />
  );

  return (
    <ModeCtx.Provider value={mode}>
      <div className="space-y-4">
        {/* Intestazione visibile solo in stampa: titolo, data e filtri applicati */}
        <div className="only-print">
          <p className="text-lg font-semibold text-gray-900">Analisi HR — {TABS.find(t => t.key === tab)?.label}</p>
          <p className="text-xs text-gray-500">
            Stampato il {fmtDate(today)} · {totActive} persone attive
            {activeFilters.length ? ` · Filtri: ${activeFilters.map(d => `${DIM_LABEL[d]} = ${filters[d]!.join(', ')}`).join(' · ')}` : ' · Nessun filtro'}
          </p>
        </div>

        {/* Barra unica: filtri a sinistra, vista e stampa a destra */}
        <div className="flex items-center gap-2 flex-wrap d-print-none">
          {FILTER_ORDER.map(dim => (
            <MultiFilter key={dim} label={DIM_LABEL[dim]} value={filters[dim] ?? []}
              options={countBy(allActive, dim, plantName, 'name')}
              onChange={v => setFilters(f => ({ ...f, [dim]: v }))} />
          ))}
          {activeFilters.length > 0 && <button type="button" onClick={() => setFilters({})} className="text-sm px-3 py-1.5 rounded-lg text-gray-500 hover:bg-gray-100">Azzera</button>}
          <div className="ml-auto flex items-center gap-2">
            <div className="flex rounded-lg overflow-hidden border border-gray-300">
              {(['chart', 'table'] as Mode[]).map(m => (
                <button key={m} type="button" onClick={() => setMode(m)}
                  className={`text-sm px-3 py-1.5 ${mode === m ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                  {m === 'chart' ? 'Grafici' : 'Tabelle'}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => window.print()} className="btn-primary text-sm py-1.5">Stampa</button>
          </div>
        </div>

        {/* Schede */}
        <div className="flex gap-6 border-b border-gray-200 overflow-x-auto d-print-none">
          {TABS.map(t => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className={`text-sm pb-2.5 -mb-px whitespace-nowrap border-b-2 transition-colors ${tab === t.key ? 'border-blue-600 text-blue-600 font-medium' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {show('riepilogo') && (
          <Section title="Riepilogo">
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <Kpi label="Organico attivo" value={totActive} />
              <Kpi label="Tempo determinato" value={pct(determinati, totActive)} sub={`${determinati} persone`} />
              <Kpi label="Scadenze entro 90 gg" value={expiring90.length} tone={expiring90.length ? 'warn' : undefined} sub="contratti da rinnovare" />
              <Kpi label={`Cessazioni ${cur}`} value={cessCurYear} sub="da inizio anno" />
              <Kpi label="Senza responsabile" value={senzaResp} tone={senzaResp ? 'warn' : undefined} sub="da assegnare" />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {countCard('Persone per plant', 'plant', { hint: 'Chi lavora su più sedi è contato in ognuna' })}
              {countCard('Persone per società a contratto', 'societa')}
              {countCard('Tipologia di contratto', 'tipologia', { donut: true })}
              {expiringCard}
            </div>
          </Section>
        )}

        {show('persone') && (
          <Section title="Persone">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {countCard('Totale risorse per società a contratto', 'societa')}
              {countCard('Totale per sesso', 'sesso', { donut: true })}
              {countCard('Totale per nazionalità', 'nazionalita', { top: 12, hint: 'Prime 12, le altre sono raggruppate in «Altre»' })}
              {countCard('Totale per plant', 'plant', { hint: 'Chi lavora su più sedi è contato in ognuna' })}
            </div>
          </Section>
        )}

        {show('contratti') && (
          <Section title="Contratti">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {countCard('Totale contratti per categoria', 'categoria', { hint: 'es. APL Maranello, diretto…' })}
              {countCard('Totale per tipologia', 'tipologia', { donut: true })}
              {countCard('Totale per livello', 'livello', { sort: 'name', hint: 'In ordine di livello' })}
              {crossCard('Categoria per tipologia', 'categoria', 'tipologia', { hint: 'Usa «% sul totale» per vedere la quota di determinato in ogni categoria' })}
              {crossCard('Tipologia per sede', 'plant', 'tipologia', { className: 'lg:col-span-2' })}
            </div>
          </Section>
        )}

        {show('stabilimenti') && (
          <Section title="Stabilimenti e responsabili">
            {crossCard('Quantità persone per stabilimento e responsabile', 'responsabile', 'plant', {
              maxRows: 15,
              hint: 'Grafico: primi 15 responsabili per numero di persone, con la ripartizione per stabilimento. La tabella mostra tutti.',
            })}
          </Section>
        )}

        {show('scadenze') && (
          <Section title="Scadenze e cessazioni">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {cessazioniCard}
              {monthlyCard}
              {expiringCard}
            </div>
          </Section>
        )}

        {show('eta') && (
          <Section title="Età e reparti">
            <div className="space-y-4">{extra}</div>
          </Section>
        )}
      </div>
    </ModeCtx.Provider>
  );
}
