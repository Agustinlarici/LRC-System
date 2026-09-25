'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import type { HrEmployee, HrDepartment, HrPlant, HrContractCompany } from '@/types';
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

// Intestazioni esattamente come nell'Excel STR — il parser CSV le trasforma in
// minuscolo con underscore al posto degli spazi (mantiene apostrofi).
const IMPORT_COLUMNS = [
  'COGNOME E NOME', 'MATRICOLA', 'SESSO', 'CATEGORIA', "SOCIETA' CONTRATTO", "NAZIONALITA'",
  'MANSIONE (MICRO)', 'LIVELLO', 'REPARTO', 'PLANT', 'RESPONSABILE', 'MANAGER', 'FUNZIONE AZIENDALE',
  'DATA ASSUNZIONE', 'DATA CESSAZIONE', 'TIPOLOGIA CONTRATTO', "MATERNITA'",
];

// gg/mm/aa o gg/mm/aaaa → YYYY-MM-DD (formato date usato nell'Excel STR)
function parseItalianDate(s: string | undefined): string | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const [, d, mo, yRaw] = m;
  const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

export default function DipendentiPage() {
  const { canManage } = useAuth();
  const manage = canManage('hr');

  const [employees,   setEmployees]   = useState<HrEmployee[]>([]);
  const [departments, setDepartments] = useState<HrDepartment[]>([]);
  const [plants,       setPlants]       = useState<HrPlant[]>([]);
  const [companies,    setCompanies]    = useState<HrContractCompany[]>([]);
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
    const [empRes, depRes, plantRes, coRes] = await Promise.all([
      fetch(`${BACKEND}/api/hr/employees?${params}`, { credentials: 'include' }),
      fetch(`${BACKEND}/api/hr/departments`, { credentials: 'include' }),
      fetch(`${BACKEND}/api/hr/plants`, { credentials: 'include' }),
      fetch(`${BACKEND}/api/hr/contract-companies`, { credentials: 'include' }),
    ]);
    if (empRes.ok) setEmployees(await empRes.json());
    if (depRes.ok) setDepartments(await depRes.json());
    if (plantRes.ok) setPlants(await plantRes.json());
    if (coRes.ok) setCompanies(await coRes.json());
    setLoading(false);
  }, [search, repartoFilter, statoFilter]);

  useEffect(() => { load(); }, [load]);

  async function importRows(rows: Record<string, string>[]): Promise<ImportResult> {
    let inserted = 0, skipped = 0, errors = 0;

    const deptByName    = new Map(departments.map(d => [d.name.toLowerCase(), d.id]));
    const plantByName   = new Map(plants.map(p => [p.name.toLowerCase(), p.id]));
    const coByName       = new Map(companies.map(c => [c.name.toLowerCase(), c.id]));
    const empByCognome  = new Map(employees.map(e => [e.cognome.toLowerCase(), e.id]));

    async function ensureCatalog(map: Map<string, number>, endpoint: string, name: string | undefined): Promise<number | null> {
      const trimmed = name?.trim();
      if (!trimmed) return null;
      const key = trimmed.toLowerCase();
      if (map.has(key)) return map.get(key)!;
      const res = await fetch(`${BACKEND}/api/hr/${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ name: trimmed }),
      });
      if (res.ok) { const d = await res.json(); map.set(key, d.id); return d.id; }
      return null;
    }

    for (const row of rows) {
      // "COGNOME E NOME" è un unico campo nell'Excel — l'ultima parola è il nome,
      // tutto il resto è il cognome (funziona per cognomi composti tipo "DE LUCA").
      const fullName = (row['cognome_e_nome'] ?? '').trim();
      const parts = fullName.split(/\s+/).filter(Boolean);
      const dataAssunzione = parseItalianDate(row['data_assunzione']);
      if (parts.length < 2 || !dataAssunzione) { skipped++; continue; }
      const nome = parts[parts.length - 1];
      const cognome = parts.slice(0, -1).join(' ');

      const reparto_id           = await ensureCatalog(deptByName, 'departments', row['reparto']);
      const plant_id             = await ensureCatalog(plantByName, 'plants', row['plant']);
      const contract_company_id  = await ensureCatalog(coByName, 'contract-companies', row["societa'_contratto"]);
      const capoName = (row['responsabile']?.trim() || row['manager']?.trim())?.toLowerCase();
      const capo_id = capoName ? empByCognome.get(capoName) ?? null : null;

      // La matricola è solo del personale diretto STR — vuota o "-" per i contrattisti.
      const matricolaRaw = row['matricola']?.trim();
      const matricola = matricolaRaw && matricolaRaw !== '-' ? matricolaRaw : null;

      const dataCessazione = parseItalianDate(row['data_cessazione']);

      const res = await fetch(`${BACKEND}/api/hr/employees`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({
          matricola, nome, cognome,
          sesso: row['sesso'] || null,
          categoria: row['categoria'] || null,
          nazionalita: row["nazionalita'"] || null,
          mansione: row['mansione_(micro)'] || null,
          livello: row['livello'] || null,
          funzione_aziendale: row['funzione_aziendale'] || null,
          tipo_contratto: row['tipologia_contratto'] || null,
          reparto_id, plant_id, contract_company_id, capo_id,
          data_assunzione: dataAssunzione,
          data_cessazione: dataCessazione,
          stato: dataCessazione ? 'cessato' : undefined,
        }),
      });

      if (res.ok) {
        inserted++;
        const emp = await res.json();
        empByCognome.set(cognome.toLowerCase(), emp.id);

        const maternita = row["maternita'"]?.trim();
        if (maternita) {
          await fetch(`${BACKEND}/api/hr/employees/${emp.id}/events`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify({ event_type: 'maternita_paternita', event_date: parseItalianDate(maternita) ?? dataAssunzione, note: maternita }),
          });
        }
      } else errors++;
    }
    return {
      inserted, skipped, errors,
      detail: 'Il campo RESPONSABILE si collega solo se il cognome corrisponde esattamente a un dipendente già presente (in questo import o già esistente) — controlla i capi assegnati dopo l\'import.',
    };
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
          <div>Nome</div><div>Reparto</div><div>Mansione</div><div>Capo</div><div className="text-right">Anzianità</div><div className="text-center">Stato</div>
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
            <div className="text-sm text-gray-600 truncate">{e.mansione ?? '—'}</div>
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
          plants={plants}
          companies={companies}
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); load(); }}
        />
      )}
    </div>
  );
}
