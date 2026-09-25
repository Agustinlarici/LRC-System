'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import type { HrEmployee, HrDepartment, HrPlant, HrContractCompany } from '@/types';
import { ImportExcelButton, type ImportResult } from '@/components/ui/ImportExcelButton';
import { NewEmployeeModal } from './NewEmployeeModal';
import { usePromptDialog, SKIP_ALL } from '@/components/ui/PromptDialog';

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
  const { ask, dialog: promptDialog } = usePromptDialog();

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
    let inserted = 0, updated = 0, skipped = 0, errors = 0;
    const today = new Date().toISOString().slice(0, 10);

    const deptByName    = new Map(departments.map(d => [d.name.toLowerCase(), d.id]));
    const plantByName   = new Map(plants.map(p => [p.name.toLowerCase(), p.id]));
    const coByName       = new Map(companies.map(c => [c.name.toLowerCase(), c.id]));

    // Tutti i dipendenti (anche cessati): serve per ritrovare chi è già stato importato
    // (aggiornandolo invece di duplicarlo) e per collegare responsabile e manager.
    const allRes = await fetch(`${BACKEND}/api/hr/employees`, { credentials: 'include' });
    const all: HrEmployee[] = allRes.ok ? await allRes.json() : [];
    const empByCognome  = new Map<string, number>();
    const empByMatricola = new Map<string, number>();
    const empByFullName  = new Map<string, number>();
    for (const e of all) {
      empByCognome.set(e.cognome.toLowerCase(), e.id);
      if (e.matricola) empByMatricola.set(e.matricola.toLowerCase(), e.id);
      empByFullName.set(`${e.cognome} ${e.nome}`.toLowerCase(), e.id);
    }

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

    async function patch(id: number, body: Record<string, unknown>) {
      return fetch(`${BACKEND}/api/hr/employees/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify(body),
      });
    }

    // Prima passata: crea (o aggiorna) tutti i dipendenti. I collegamenti gerarchici
    // vengono fatti nella seconda passata, quando tutti i responsabili esistono già.
    const links: { id: number; responsabile: string; manager: string; reparto_id: number | null }[] = [];

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
      // PLANT può contenere più sedi separate da / + & o virgola (es. "STR3/STR5")
      const plant_ids: number[] = [];
      for (const name of (row['plant'] ?? '').split(/[\/+&,]/)) {
        const pid = await ensureCatalog(plantByName, 'plants', name);
        if (pid && !plant_ids.includes(pid)) plant_ids.push(pid);
      }
      const contract_company_id  = await ensureCatalog(coByName, 'contract-companies', row["societa'_contratto"]);

      // La matricola è solo del personale diretto STR — vuota, "-" o "(INTERINALE)" per i contrattisti.
      const matricolaRaw = row['matricola']?.trim();
      const matricola = matricolaRaw && matricolaRaw !== '-' && !matricolaRaw.startsWith('(') ? matricolaRaw : null;

      // Data cessazione futura = fine contratto a termine: il dipendente è ancora attivo
      const dataCessazione = parseItalianDate(row['data_cessazione']);
      const cessato = !!dataCessazione && dataCessazione <= today;

      const fields = {
        matricola, nome, cognome,
        sesso: row['sesso'] || null,
        categoria: row['categoria'] || null,
        nazionalita: row["nazionalita'"] || null,
        mansione: row['mansione_(micro)'] || null,
        livello: row['livello'] || null,
        funzione_aziendale: row['funzione_aziendale'] || null,
        tipo_contratto: row['tipologia_contratto'] || null,
        reparto_id, plant_ids, contract_company_id,
        data_assunzione: dataAssunzione,
        data_cessazione: dataCessazione,
      };

      const existingId = (matricola && empByMatricola.get(matricola.toLowerCase()))
        || empByFullName.get(`${cognome} ${nome}`.toLowerCase());

      let id: number | null = null;
      if (existingId) {
        const res = await patch(existingId, { ...fields, stato: cessato ? 'cessato' : 'attivo' });
        if (res.ok) { updated++; id = existingId; } else errors++;
      } else {
        const res = await fetch(`${BACKEND}/api/hr/employees`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ ...fields, stato: cessato ? 'cessato' : undefined }),
        });
        if (res.ok) {
          inserted++;
          const emp = await res.json();
          id = emp.id;
          empByCognome.set(cognome.toLowerCase(), emp.id);
          empByFullName.set(`${cognome} ${nome}`.toLowerCase(), emp.id);
          if (matricola) empByMatricola.set(matricola.toLowerCase(), emp.id);

          const maternita = row["maternita'"]?.trim();
          if (maternita) {
            await fetch(`${BACKEND}/api/hr/employees/${emp.id}/events`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
              body: JSON.stringify({ event_type: 'maternita_paternita', event_date: parseItalianDate(maternita) ?? dataAssunzione, note: maternita }),
            });
          }
        } else errors++;
      }
      if (id) links.push({ id, responsabile: row['responsabile']?.trim() ?? '', manager: row['manager']?.trim() ?? '', reparto_id });
    }

    // Seconda passata: dipendente → responsabile, responsabile → manager (se non ne ha già uno).
    // Responsabili e manager sono indicati solo per cognome nell'Excel.
    // Se qualcuno non esiste ancora, si propone di crearlo (serve il nome; la data di
    // assunzione non è nota, quindi si usa oggi e si può correggere dopo dalla scheda).
    const needed = new Set<string>();
    for (const l of links) for (const n of [l.responsabile, l.manager]) {
      if (n && !empByCognome.has(n.toLowerCase())) needed.add(n);
    }
    const notCreated: string[] = [];
    // Un responsabile creato al volo eredita il reparto dei suoi riporti diretti solo se è lo stesso
    // per tutti; se guida più reparti (es. direzione) resta senza reparto.
    const inferReparto = (cognome: string): number | null => {
      const reparti = new Set(links.filter(l => l.responsabile.toLowerCase() === cognome.toLowerCase()).map(l => l.reparto_id));
      return reparti.size === 1 ? [...reparti][0] : null;
    };
    let createdChiefs = 0;
    let skipAll = false;
    for (const cognomeRaw of needed) {
      if (skipAll) { notCreated.push(cognomeRaw); continue; }
      const nomeRaw = await ask({
        title: `Responsabile mancante: ${cognomeRaw}`,
        message: 'Non esiste tra i dipendenti. Inserisci il nome per crearlo.',
        label: 'Nome', confirmLabel: 'Crea', cancelLabel: 'Salta', skipAllLabel: 'Salta tutti',
      });
      if (nomeRaw === SKIP_ALL) { skipAll = true; notCreated.push(cognomeRaw); continue; }
      if (typeof nomeRaw !== 'string') { notCreated.push(cognomeRaw); continue; }
      const res = await fetch(`${BACKEND}/api/hr/employees`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ nome: nomeRaw, cognome: cognomeRaw, data_assunzione: today, reparto_id: inferReparto(cognomeRaw) }),
      });
      if (res.ok) { const emp = await res.json(); empByCognome.set(cognomeRaw.toLowerCase(), emp.id); createdChiefs++; }
      else notCreated.push(cognomeRaw);
    }
    const missing = new Set<string>(notCreated);
    const resolve = (name: string) => (name ? empByCognome.get(name.toLowerCase()) ?? null : null);
    const chiefOf = new Map<number, number>();
    for (const l of links) {
      const resp = resolve(l.responsabile);
      const mgr = resolve(l.manager);
      if (resp && resp !== l.id) chiefOf.set(l.id, resp);
      else if (!resp && mgr && mgr !== l.id) chiefOf.set(l.id, mgr);
      if (resp && mgr && resp !== mgr && !chiefOf.has(resp)) chiefOf.set(resp, mgr);
    }
    for (const [id, capo_id] of chiefOf) await patch(id, { capo_id });

    return {
      inserted, skipped, errors,
      detail: `Nuovi: ${inserted} · già presenti e aggiornati: ${updated}${createdChiefs ? ` · responsabili creati: ${createdChiefs} (controlla la data di assunzione)` : ''}. Responsabile e manager si collegano per cognome esatto`
        + (missing.size ? `; non collegati perché non creati: ${[...missing].join(', ')}.` : '.'),
    };
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-medium text-gray-900">Dipendenti</h1>
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
        <select value={repartoFilter} onChange={e => setRepartoFilter(e.target.value ? Number(e.target.value) : '')} className="input text-sm w-auto">
          <option value="">Tutti i reparti</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={statoFilter} onChange={e => setStatoFilter(e.target.value)} className="input text-sm w-auto">
          <option value="">Tutti gli stati</option>
          {Object.entries(STATO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="grid grid-cols-[minmax(130px,1fr)_minmax(130px,1fr)_100px_minmax(110px,1fr)_minmax(120px,1fr)_minmax(120px,1fr)_100px] gap-x-3 px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-xs font-medium text-gray-400 uppercase tracking-wide">
          <div>Cognome</div><div>Nome</div><div>Matricola</div><div>Reparto</div><div>Mansione</div><div>Responsabile</div><div className="text-center">Stato</div>
        </div>
        {loading ? (
          <p className="text-sm text-gray-400 text-center py-12">Caricamento…</p>
        ) : employees.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-12">Nessun dipendente trovato</p>
        ) : employees.map(e => (
          <Link key={e.id} href={`/hr/dipendenti/${e.id}`}
            className="grid grid-cols-[minmax(130px,1fr)_minmax(130px,1fr)_100px_minmax(110px,1fr)_minmax(120px,1fr)_minmax(120px,1fr)_100px] gap-x-3 px-4 py-3 border-b border-gray-50 last:border-b-0 hover:bg-gray-50 transition-colors items-center"
          >
            <div className="text-sm font-medium text-gray-800 truncate">{e.cognome}</div>
            <div className="text-sm text-gray-800 truncate">{e.nome}</div>
            <div className="text-sm text-gray-600 truncate">{e.matricola ?? '—'}</div>
            <div className="text-sm text-gray-600 truncate">{e.reparto_name ?? '—'}</div>
            <div className="text-sm text-gray-600 truncate">{e.mansione ?? '—'}</div>
            <div className="text-sm text-gray-600 truncate">{e.capo_nome ?? '—'}</div>
            <div className="text-center">
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${STATO_COLOR[e.stato]}`}>{STATO_LABEL[e.stato]}</span>
            </div>
          </Link>
        ))}
      </div>

      {promptDialog}

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
