'use client';

import { useEffect, useMemo, useState } from 'react';
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

type Dim = 'societa' | 'nazionalita' | 'plant' | 'sesso' | 'categoria' | 'tipologia' | 'livello' | 'responsabile';

const DIM_LABEL: Record<Dim, string> = {
  societa: 'Società a contratto', nazionalita: 'Nazionalità', plant: 'Plant', sesso: 'Sesso',
  categoria: 'Categoria', tipologia: 'Tipologia', livello: 'Livello', responsabile: 'Responsabile',
};

type Filters = Partial<Record<Dim, string>>;

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
    // Una persona può lavorare su più sedi: conta in ognuna
    case 'plant':        return e.plant_ids?.length ? e.plant_ids.map(id => plantName.get(id) ?? NA) : [NA];
  }
}

function countBy(list: HrEmployee[], dim: Dim, plantName: Map<number, string>) {
  const m = new Map<string, number>();
  for (const e of list) for (const v of valuesOf(e, dim, plantName)) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

// Pivot per i grafici impilati: una riga per `rowDim`, una serie per `serDim`
function crossBy(list: HrEmployee[], rowDim: Dim, serDim: Dim, plantName: Map<number, string>, maxSeries = 9) {
  const totals = new Map<string, number>();
  for (const e of list) for (const s of valuesOf(e, serDim, plantName)) totals.set(s, (totals.get(s) ?? 0) + 1);
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  const keep = new Set(ranked.slice(0, maxSeries));
  const folded = ranked.length > maxSeries;
  const rows = new Map<string, Record<string, number | string>>();
  for (const e of list) {
    for (const r of valuesOf(e, rowDim, plantName)) {
      if (!rows.has(r)) rows.set(r, { name: r, _total: 0 });
      const row = rows.get(r)!;
      for (const s of valuesOf(e, serDim, plantName)) {
        const key = keep.has(s) ? s : 'Altri';
        row[key] = ((row[key] as number) ?? 0) + 1;
        row._total = (row._total as number) + 1;
      }
    }
  }
  const series = [...ranked.slice(0, maxSeries), ...(folded ? ['Altri'] : [])];
  const data = [...rows.values()].sort((a, b) => (b._total as number) - (a._total as number));
  return { data, series };
}

function colorOf(index: number, name: string) {
  return name === 'Altri' || name === NA ? OTHER_COLOR : PALETTE[index % PALETTE.length];
}

// ─── Blocchi UI ────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest pt-2">{title}</h2>
      {children}
    </div>
  );
}

function ChartCard({ title, hint, children, className = '' }: { title: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`card ${className}`}>
      <p className="text-base font-medium text-gray-700">{title}</p>
      {hint && <p className="text-xs text-gray-400 mb-2">{hint}</p>}
      <div className={hint ? '' : 'mt-2'}>{children}</div>
    </div>
  );
}

const Empty = () => <p className="text-sm text-gray-400 text-center py-10">Nessun dato</p>;

// Barre orizzontali: clic su una barra = filtra tutta la pagina su quel valore
function CountBars({ data, dim, filters, toggle }: {
  data: { name: string; value: number }[]; dim: Dim; filters: Filters; toggle: (d: Dim, v: string) => void;
}) {
  if (data.length === 0) return <Empty />;
  const selected = filters[dim];
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, data.length * 30 + 20)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 32, bottom: 0, left: 0 }}>
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 12, fill: '#374151' }} axisLine={false} tickLine={false} />
        <Tooltip cursor={{ fill: '#f3f4f6' }} />
        <Bar dataKey="value" name="Persone" radius={[0, 4, 4, 0]} barSize={16} cursor="pointer"
          label={{ position: 'right', fontSize: 12, fill: '#374151' }}
          onClick={(d: any) => toggle(dim, d.name)}>
          {data.map((d, i) => (
            <Cell key={d.name} fill={colorOf(0, d.name === NA ? NA : 'x')} fillOpacity={selected && selected !== d.name ? 0.3 : 1} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// Ciambella + legenda a bottoni cliccabili
function Donut({ data, dim, filters, toggle }: {
  data: { name: string; value: number }[]; dim: Dim; filters: Filters; toggle: (d: Dim, v: string) => void;
}) {
  if (data.length === 0) return <Empty />;
  const total = data.reduce((s, d) => s + d.value, 0);
  const selected = filters[dim];
  return (
    <div className="flex items-center gap-4 flex-wrap">
      <div className="relative w-40 h-40 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={2} stroke="none"
              cursor="pointer" onClick={(d: any) => toggle(dim, d.name)}>
              {data.map((d, i) => (
                <Cell key={d.name} fill={colorOf(i, d.name)} fillOpacity={selected && selected !== d.name ? 0.3 : 1} />
              ))}
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
        {data.map((d, i) => (
          <button key={d.name} type="button" onClick={() => toggle(dim, d.name)}
            className={`btn-secondary text-xs flex items-center gap-2 w-full text-left ${selected === d.name ? 'ring-2 ring-blue-300' : ''}`}>
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colorOf(i, d.name) }} />
            <span className="truncate flex-1">{d.name}</span>
            <span className="text-gray-500">{d.value} · {Math.round((d.value / total) * 100)}%</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Barre impilate: una riga per rowDim, segmenti per serDim
function StackedBars({ list, rowDim, serDim, plantName, filters, toggle, maxSeries }: {
  list: HrEmployee[]; rowDim: Dim; serDim: Dim; plantName: Map<number, string>;
  filters: Filters; toggle: (d: Dim, v: string) => void; maxSeries?: number;
}) {
  const { data, series } = useMemo(() => crossBy(list, rowDim, serDim, plantName, maxSeries), [list, rowDim, serDim, plantName, maxSeries]);
  if (data.length === 0) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 36 + 60)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 24, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: '#374151' }} />
        <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 12, fill: '#374151' }} axisLine={false} tickLine={false} />
        <Tooltip cursor={{ fill: '#f3f4f6' }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map((s, i) => (
          <Bar key={s} dataKey={s} stackId="a" fill={colorOf(i, s)} stroke="#fff" strokeWidth={1} cursor="pointer"
            onClick={(d: any) => {
              toggle(rowDim, d.name);
              if (s !== 'Altri') toggle(serDim, s);
            }} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Componente principale ─────────────────────────────────────────────────────

export function AnalisiOrganico() {
  const [all, setAll] = useState<HrEmployee[]>([]);
  const [plants, setPlants] = useState<HrPlant[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>({});

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

  function toggle(dim: Dim, value: string) {
    setFilters(f => {
      const next = { ...f };
      if (next[dim] === value) delete next[dim]; else next[dim] = value;
      return next;
    });
  }

  // Filtri incrociati: valgono per tutti i grafici
  const matches = useMemo(() => (e: HrEmployee) =>
    (Object.entries(filters) as [Dim, string][]).every(([dim, v]) => valuesOf(e, dim, plantName).includes(v)),
  [filters, plantName]);

  const active = useMemo(() => all.filter(e => e.stato !== 'cessato' && matches(e)), [all, matches]);

  // Cessazioni e scadenze per anno (usa anche i cessati, rispettando i filtri)
  const yearly = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const years = new Map<string, { anno: string; cessazioni: number; scaduti: number; inScadenza: number }>();
    const row = (y: string) => { if (!years.has(y)) years.set(y, { anno: y, cessazioni: 0, scaduti: 0, inScadenza: 0 }); return years.get(y)!; };
    for (const e of all) {
      if (!e.data_cessazione || !matches(e)) continue;
      const d = e.data_cessazione.slice(0, 10);
      const r = row(d.slice(0, 4));
      const determinato = /determinat/i.test(e.tipo_contratto ?? '') && !/indeterminat/i.test(e.tipo_contratto ?? '');
      if (d <= today) { r.cessazioni++; if (determinato) r.scaduti++; }
      else if (e.stato !== 'cessato') r.inScadenza++;
    }
    return [...years.values()].sort((a, b) => a.anno.localeCompare(b.anno));
  }, [all, matches]);

  if (loading) return <p className="text-sm text-gray-400 text-center py-10">Caricamento…</p>;

  const activeFilters = Object.entries(filters) as [Dim, string][];
  const bars = (dim: Dim) => <CountBars data={countBy(active, dim, plantName)} dim={dim} filters={filters} toggle={toggle} />;
  const donut = (dim: Dim) => <Donut data={countBy(active, dim, plantName)} dim={dim} filters={filters} toggle={toggle} />;
  const stacked = (rowDim: Dim, serDim: Dim, maxSeries?: number) => (
    <StackedBars list={active} rowDim={rowDim} serDim={serDim} plantName={plantName} filters={filters} toggle={toggle} maxSeries={maxSeries} />
  );

  return (
    <div className="space-y-4">
      {/* Filtri attivi */}
      <div className="card flex items-center gap-2 flex-wrap">
        <p className="text-sm text-gray-700">
          <span className="font-semibold text-lg text-gray-900">{active.length}</span> persone attive
          {activeFilters.length > 0 ? ' con i filtri:' : ' — clicca su una barra, una fetta o un segmento per filtrare tutti i grafici'}
        </p>
        {activeFilters.map(([dim, v]) => (
          <button key={dim} type="button" onClick={() => toggle(dim, v)} className="btn-secondary text-xs">
            {DIM_LABEL[dim]}: <b>{v}</b> ×
          </button>
        ))}
        {activeFilters.length > 0 && (
          <button type="button" onClick={() => setFilters({})} className="btn-primary text-xs ml-auto">Azzera filtri</button>
        )}
      </div>

      <Section title="Persone">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="Totale risorse per società a contratto">{donut('societa')}</ChartCard>
          <ChartCard title="Totale per sesso">{donut('sesso')}</ChartCard>
          <ChartCard title="Totale per nazionalità">{bars('nazionalita')}</ChartCard>
          <ChartCard title="Totale per plant" hint="Chi lavora su più sedi è contato in ognuna">{bars('plant')}</ChartCard>
        </div>
      </Section>

      <Section title="Contratti">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title="Totale per categoria" hint="es. APL Maranello, diretto…">{bars('categoria')}</ChartCard>
          <ChartCard title="Totale per tipologia">{donut('tipologia')}</ChartCard>
          <ChartCard title="Totale per livello">{bars('livello')}</ChartCard>
          <ChartCard title="Categoria per tipologia">{stacked('categoria', 'tipologia')}</ChartCard>
          <ChartCard title="Tipologia per sede" className="lg:col-span-2">{stacked('plant', 'tipologia')}</ChartCard>
        </div>
      </Section>

      <Section title="Stabilimenti e responsabili">
        <ChartCard title="Quantità persone per stabilimento e responsabile" hint="Primi 9 responsabili per stabilimento, gli altri sono raggruppati in «Altri»">
          {stacked('plant', 'responsabile', 9)}
        </ChartCard>
      </Section>

      <Section title="Cessazioni e scadenze">
        <ChartCard title="Cessazioni e contratti scaduti per anno"
          hint="Scaduti = cessazioni di contratti a tempo determinato. «In scadenza» = dipendenti ancora attivi con fine contratto in quell'anno.">
          {yearly.length === 0 ? <Empty /> : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={yearly} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="anno" tick={{ fontSize: 12, fill: '#374151' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#374151' }} />
                <Tooltip cursor={{ fill: '#f3f4f6' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="cessazioni" name="Cessazioni" fill={PALETTE[0]} radius={[4, 4, 0, 0]} label={{ position: 'top', fontSize: 11, fill: '#374151' }} />
                <Bar dataKey="scaduti" name="Contratti scaduti" fill={PALETTE[2]} radius={[4, 4, 0, 0]} label={{ position: 'top', fontSize: 11, fill: '#374151' }} />
                <Bar dataKey="inScadenza" name="In scadenza (attivi)" fill={PALETTE[3]} radius={[4, 4, 0, 0]} label={{ position: 'top', fontSize: 11, fill: '#374151' }} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </Section>
    </div>
  );
}
