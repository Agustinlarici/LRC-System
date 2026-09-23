'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import type { HrEmployee, HrDepartment } from '@/types';
import { ImportExcelButton, type ImportResult } from '@/components/ui/ImportExcelButton';
import { NewEmployeeModal } from './NewEmployeeModal';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

const STATO_LABEL: Record<string, string> = {
  attivo: 'Attivo', aspettativa: 'Aspettativa', malattia: 'Malattia',
  maternita_paternita: 'Maternità/Paternità', cessato: 'Cessato',
};
const STATO_COLOR: Record<string, string> = {
  attivo: 'bg-green-50 text-green-700 border-green-200',
  aspettativa: 'bg-amber-50 text-amber-700 border-amber-200',
  malattia: 'bg-red-50 text-red-700 border-red-200',
  maternita_paternita: 'bg-purple-50 text-purple-700 border-purple-200',
  cessato: 'bg-gray-100 text-gray-500 border-gray-200',
};

const IMPORT_COLUMNS = [
  'matricola', 'nome', 'cognome', 'data_nascita', 'codice_fiscale', 'email', 'telefono',
  'ruolo', 'mansione', 'livello', 'tipo_contratto', 'reparto', 'data_assunzione',
];

export default function DipendentiPage() {
  const { canManage } = useAuth();
  const manage = canManage('hr');

  const [employees,   setEmployees]   = useState<HrEmployee[]>([]);
  const [departments, setDepartments] = useState<HrDepartment[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [search,       setSearch]       = useState('');
  const [repartoFilter, setRepartoFilter] = useState<number | ''>('');
  const [statoFilter,   setStatoFilter]   = useState<string>('attivo');
  const [showNew,       setShowNew]       = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (repartoFilter) params.set('reparto_id', String(repartoFilter));
    if (statoFilter) params.set('stato', statoFilter);
    const [empRes, depRes] = await Promise.all([
      fetch(`${BACKEND}/api/hr/employees?${params}`, { credentials: 'include' }),
      fetch(`${BACKEND}/api/hr/departments`, { credentials: 'include' }),
    ]);
    if (empRes.ok) setEmployees(await empRes.json());
    if (depRes.ok) setDepartments(await depRes.json());
    setLoading(false);
  }, [search, repartoFilter, statoFilter]);

  useEffect(() => { load(); }, [load]);

  const deptByName = useMemo(() => new Map(departments.map(d => [d.name.toLowerCase(), d.id])), [departments]);

  async function importRows(rows: Record<string, string>[]): Promise<ImportResult> {
    let inserted = 0, skipped = 0, errors = 0;
    for (const row of rows) {
      if (!row.nome || !row.cognome || !row.data_assunzione) { skipped++; continue; }
      let reparto_id: number | null = null;
      if (row.reparto) {
        reparto_id = deptByName.get(row.reparto.toLowerCase()) ?? null;
        if (!reparto_id) {
          const res = await fetch(`${BACKEND}/api/hr/departments`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify({ name: row.reparto }),
          });
          if (res.ok) { const d = await res.json(); reparto_id = d.id; deptByName.set(row.reparto.toLowerCase(), d.id); }
        }
      }
      const res = await fetch(`${BACKEND}/api/hr/employees`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({
          matricola: row.matricola || null,
          nome: row.nome, cognome: row.cognome,
          data_nascita: row.data_nascita || null,
          codice_fiscale: row.codice_fiscale || null,
          email: row.email || null,
          telefono: row.telefono || null,
          ruolo: row.ruolo || null,
          mansione: row.mansione || null,
          livello: row.livello || null,
          tipo_contratto: row.tipo_contratto || null,
          reparto_id,
          data_assunzione: row.data_assunzione,
        }),
      });
      if (res.ok) inserted++; else errors++;
    }
    return { inserted, skipped, errors };
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-medium text-gray-900">Dipendenti</h1>
          <p className="text-xs text-gray-400 mt-0.5">{employees.length} {employees.length === 1 ? 'persona' : 'persone'} {statoFilter ? `— ${STATO_LABEL[statoFilter]?.toLowerCase()}` : ''}</p>
        </div>
        {manage && (
          <div className="flex items-center gap-2">
            <ImportExcelButton columns={IMPORT_COLUMNS} processRows={importRows} onDone={load} label="Importa da Excel" />
            <button onClick={() => setShowNew(true)} className="btn-primary text-sm">+ Nuovo dipendente</button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="text" placeholder="Cerca per nome, cognome o matricola…"
          value={search} onChange={e => setSearch(e.target.value)}
          className="input text-sm w-64"
        />
        <select value={repartoFilter} onChange={e => setRepartoFilter(e.target.value ? Number(e.target.value) : '')} className="input text-sm">
          <option value="">Tutti i reparti</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={statoFilter} onChange={e => setStatoFilter(e.target.value)} className="input text-sm">
          <option value="">Tutti gli stati</option>
          {Object.entries(STATO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="grid grid-cols-[minmax(160px,1.5fr)_minmax(120px,1fr)_minmax(120px,1fr)_minmax(120px,1fr)_100px_100px] gap-x-3 px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-xs font-medium text-gray-400 uppercase tracking-wide">
          <div>Nome</div><div>Reparto</div><div>Ruolo</div><div>Capo</div><div className="text-right">Anzianità</div><div className="text-center">Stato</div>
        </div>
        {loading ? (
          <p className="text-sm text-gray-400 text-center py-12">Caricamento…</p>
        ) : employees.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-12">Nessun dipendente trovato</p>
        ) : employees.map(e => (
          <Link key={e.id} href={`/hr/dipendenti/${e.id}`}
            className="grid grid-cols-[minmax(160px,1.5fr)_minmax(120px,1fr)_minmax(120px,1fr)_minmax(120px,1fr)_100px_100px] gap-x-3 px-4 py-3 border-b border-gray-50 last:border-b-0 hover:bg-gray-50 transition-colors items-center"
          >
            <div>
              <p className="text-sm font-medium text-gray-800">{e.cognome} {e.nome}</p>
              {e.matricola && <p className="text-[10px] text-gray-400">Matricola {e.matricola}</p>}
            </div>
            <div className="text-sm text-gray-600 truncate">{e.reparto_name ?? '—'}</div>
            <div className="text-sm text-gray-600 truncate">{e.ruolo ?? '—'}</div>
            <div className="text-sm text-gray-600 truncate">{e.capo_nome ?? '—'}</div>
            <div className="text-sm text-gray-600 text-right">{e.anzianita_anni} {e.anzianita_anni === 1 ? 'anno' : 'anni'}</div>
            <div className="text-center">
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${STATO_COLOR[e.stato]}`}>{STATO_LABEL[e.stato]}</span>
            </div>
          </Link>
        ))}
      </div>

      {showNew && (
        <NewEmployeeModal
          departments={departments}
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); load(); }}
        />
      )}
    </div>
  );
}
