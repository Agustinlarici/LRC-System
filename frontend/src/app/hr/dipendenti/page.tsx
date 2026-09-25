'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import type { HrEmployee, HrDepartment, HrPlant, HrContractCompany } from '@/types';
import { ImportExcelButton, type ImportResult } from '@/components/ui/ImportExcelButton';
import { NewEmployeeModal } from './NewEmployeeModal';
import { usePromptDialog, useChoiceDialog, SKIP_ALL } from '@/components/ui/PromptDialog';

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
  const [fCognome, setFCognome] = useState('');
  const [fNome, setFNome] = useState('');
  const [fMatricola, setFMatricola] = useState('');
  const [fMansione, setFMansione] = useState('');
  const [fResp, setFResp] = useState('');
  const [repartoFilter, setRepartoFilter] = useState<number | ''>('');
  const [statoFilter,   setStatoFilter]   = useState<string>('attivo');
  const [showNew,       setShowNew]       = useState(false);
  const { ask, dialog: promptDialog } = usePromptDialog();
  const { choose, dialog: choiceDialog } = useChoiceDialog();

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
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
  }, [repartoFilter, statoFilter]);

  useEffect(() => { load(); }, [load]);

  const hasFilters = !!(fCognome || fNome || fMatricola || fMansione || fResp || repartoFilter || statoFilter !== 'attivo');
  function resetFilters() {
    setFCognome(''); setFNome(''); setFMatricola(''); setFMansione(''); setFResp('');
    setRepartoFilter(''); setStatoFilter('attivo');
  }
  const visible = employees.filter(e => {
    const has = (v: string | null | undefined, q: string) => !q.trim() || (v ?? '').toLowerCase().includes(q.trim().toLowerCase());
    return has(e.cognome, fCognome) && has(e.nome, fNome) && has(e.matricola, fMatricola)
      && has(e.mansione, fMansione) && has(e.capo_nome, fResp);
  });

  async function importRows(rows: Record<string, string>[]): Promise<ImportResult> {
    let inserted = 0, updated = 0, skipped = 0, errors = 0;
    const skippedRows: string[] = [];
    const today = new Date().toISOString().slice(0, 10);

    const deptByName    = new Map(departments.map(d => [d.name.toLowerCase(), d.id]));
    const plantByName   = new Map(plants.map(p => [p.name.toLowerCase(), p.id]));
    const coByName       = new Map(companies.map(c => [c.name.toLowerCase(), c.id]));

    // Tutti i dipendenti (anche cessati): serve per ritrovare chi è già stato importato
    // (aggiornandolo invece di duplicarlo) e per collegare responsabile e manager.
    const allRes = await fetch(`${BACKEND}/api/hr/employees`, { credentials: 'include' });
    const all: HrEmployee[] = allRes.ok ? await allRes.json() : [];
    const empByCognome  = new Map<string, number[]>();
    // Più persone possono avere lo stesso cognome (es. due Cecchini): si tengono tutte
    const labelOf = new Map<number, string>();
    const addCognome = (cognome: string, id: number, nome: string) => {
      labelOf.set(id, `${cognome} ${nome}`);
      const k = cognome.toLowerCase();
      empByCognome.set(k, [...(empByCognome.get(k) ?? []), id]);
    };
    const empByMatricola = new Map<string, number>();
    const empByFullName  = new Map<string, number>();
    const empByNomeCognome = new Map<string, number>();
    for (const e of all) {
      addCognome(e.cognome, e.id, e.nome);
      if (e.matricola) empByMatricola.set(e.matricola.toLowerCase(), e.id);
      empByFullName.set(`${e.cognome} ${e.nome}`.toLowerCase(), e.id);
      empByNomeCognome.set(`${e.nome} ${e.cognome}`.toLowerCase(), e.id);
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
    const links: { id: number; responsabile: string; manager: string; funzione: string }[] = [];

    for (const row of rows) {
      // "COGNOME E NOME" è un unico campo nell'Excel — l'ultima parola è il nome,
      // tutto il resto è il cognome (funziona per cognomi composti tipo "DE LUCA").
      const rawName = (row['cognome_e_nome'] ?? '').trim();
      // "L.68" (Legge 68) nel nome: si registra come campo a parte e si toglie dal nome
      const L68 = /\(?(?<![A-Za-z])L\.?\s*68(?:\/\d{2,4})?(?!\d)\.?\)?/i;
      const l68 = L68.test(rawName);
      const fullName = rawName.replace(L68, '').replace(/\s+/g, ' ').trim();
      const parts = fullName.split(/\s+/).filter(Boolean);
      const dataAssunzione = parseItalianDate(row['data_assunzione']);
      if (parts.length < 2 || !dataAssunzione) {
        skipped++;
        const motivo = parts.length < 2 ? 'nome e cognome incompleti' : `data assunzione mancante o non valida ("${row['data_assunzione'] ?? ''}")`;
        skippedRows.push(`${fullName || '(riga vuota)'}: ${motivo}`);
        continue;
      }
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
        l68,
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
          addCognome(cognome, emp.id, nome);
          empByFullName.set(`${cognome} ${nome}`.toLowerCase(), emp.id);
          empByNomeCognome.set(`${nome} ${cognome}`.toLowerCase(), emp.id);
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
      if (id) links.push({ id, responsabile: row['responsabile']?.trim() ?? '', manager: row['manager']?.trim() ?? '', funzione: row['funzione_aziendale']?.trim() ?? '' });
    }

    // Seconda passata: dipendente → responsabile, responsabile → manager (se non ne ha già uno).
    // Responsabili e manager possono essere indicati solo col cognome ("TERRENGHI") oppure con
    // cognome e nome ("STRAPAZZINI SARA"): si cerca prima il nome completo, poi il solo cognome.
    // Se qualcuno non esiste ancora lo si crea (data di assunzione non nota: si usa oggi, da
    // correggere poi dalla scheda). Se il nome è già nella cella non serve chiederlo.
    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
    // Persone che corrispondono a un nome indicato nell'Excel (una o più, se il cognome è condiviso)
    const candidates = (raw: string): number[] => {
      if (!raw) return [];
      const k = norm(raw);
      const exact = empByFullName.get(k) ?? empByNomeCognome.get(k);
      if (exact) return [exact];
      const byCognome = empByCognome.get(k);
      if (byCognome?.length) return [...new Set(byCognome)];
      // Cognome composto indicato solo in parte ("GRIGORE" per "Grigore Claudiu Mihai")
      const starts = new Set<number>();
      for (const [name, id] of empByFullName) if (name.startsWith(`${k} `)) starts.add(id);
      return [...starts];
    };
    // Nomi che corrispondono a più persone (es. due Cecchini): non si indovina, si chiede all'utente
    // (una volta sola per ogni nome). La risposta può anche essere "un'altra persona" da creare.
    const decided = new Map<string, number | null>();
    const ambiguous = new Set<string>();
    const pick = (raw: string): number | null => {
      if (!raw) return null;
      const k = norm(raw);
      if (decided.has(k)) return decided.get(k) ?? null;
      const c = candidates(raw);
      if (c.length === 1) return c[0];
      if (c.length > 1) ambiguous.add(raw);
      return null;
    };
    const needed = new Set<string>();
    for (const l of links) for (const n of [l.responsabile, l.manager]) {
      if (n && candidates(n).length === 0) needed.add(n);
    }
    const notCreated: string[] = [];
    // Un responsabile creato al volo eredita la funzione aziendale dei suoi riporti diretti solo se è la
    // stessa per tutti; se guida più funzioni (es. direzione) resta senza.
    const inferFunzione = (raw: string): string | null => {
      const funzioni = new Set(links.filter(l => norm(l.responsabile) === norm(raw)).map(l => l.funzione));
      const only = funzioni.size === 1 ? [...funzioni][0] : '';
      return only || null;
    };
    let createdChiefs = 0;
    let skipAll = false;
    for (const raw of needed) {
      const words = raw.trim().split(/\s+/);
      let cognome = raw.trim();
      let nome: string | null = null;
      if (words.length >= 2) {
        // "COGNOME NOME": come nella colonna COGNOME E NOME, l'ultima parola è il nome
        nome = words[words.length - 1];
        cognome = words.slice(0, -1).join(' ');
      } else {
        if (skipAll) { notCreated.push(raw); continue; }
        const answer = await ask({
          title: `Responsabile mancante: ${raw}`,
          message: 'Non esiste tra i dipendenti. Inserisci il nome per crearlo.',
          label: 'Nome', confirmLabel: 'Crea', cancelLabel: 'Salta', skipAllLabel: 'Salta tutti',
        });
        if (answer === SKIP_ALL) { skipAll = true; notCreated.push(raw); continue; }
        if (typeof answer !== 'string') { notCreated.push(raw); continue; }
        nome = answer;
      }
      const res = await fetch(`${BACKEND}/api/hr/employees`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ nome, cognome, data_assunzione: today, funzione_aziendale: inferFunzione(raw) }),
      });
      if (res.ok) {
        const emp = await res.json();
        addCognome(cognome, emp.id, nome ?? '');
        empByFullName.set(norm(`${cognome} ${nome}`), emp.id);
        empByNomeCognome.set(norm(`${nome} ${cognome}`), emp.id);
        createdChiefs++;
      } else notCreated.push(raw);
    }
    // Nomi ambigui (più persone con quel cognome): si chiede a chi si riferisce l'Excel
    const dubious = new Map<string, string>();
    for (const l of links) for (const n of [l.responsabile, l.manager]) {
      if (n && candidates(n).length > 1) dubious.set(norm(n), n);
    }
    for (const [k, raw] of dubious) {
      if (skipAll) { decided.set(k, null); ambiguous.add(raw); continue; }
      const choice = await choose({
        title: `Chi è «${raw}»?`,
        message: "Più persone hanno questo cognome. Scegli quella a cui si riferisce l'Excel, oppure creane un'altra.",
        options: [
          ...candidates(raw).map(id => ({ value: String(id), label: labelOf.get(id) ?? String(id) })),
          { value: '__new__', label: `Un'altra persona con cognome «${raw}» (da creare)` },
        ],
        cancelLabel: 'Salta', skipAllLabel: 'Salta tutti',
      });
      if (choice === SKIP_ALL) { skipAll = true; decided.set(k, null); ambiguous.add(raw); continue; }
      if (typeof choice !== 'string') { decided.set(k, null); ambiguous.add(raw); continue; }
      if (choice !== '__new__') { decided.set(k, Number(choice)); continue; }
      const nomeNew = await ask({
        title: `Nuovo responsabile: ${raw}`, message: 'Inserisci il nome per crearlo.', label: 'Nome', confirmLabel: 'Crea', cancelLabel: 'Salta',
      });
      if (typeof nomeNew !== 'string') { decided.set(k, null); ambiguous.add(raw); continue; }
      const res = await fetch(`${BACKEND}/api/hr/employees`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ nome: nomeNew, cognome: raw, data_assunzione: today, funzione_aziendale: inferFunzione(raw) }),
      });
      if (res.ok) {
        const emp = await res.json();
        addCognome(raw, emp.id, nomeNew);
        decided.set(k, emp.id);
        createdChiefs++;
      } else { decided.set(k, null); ambiguous.add(raw); }
    }
    const missing = new Set<string>(notCreated);
    const chiefOf = new Map<number, number>();
    for (const l of links) {
      const resp = pick(l.responsabile);
      const mgr = pick(l.manager);
      if (resp && resp !== l.id) chiefOf.set(l.id, resp);
      else if (!resp && mgr && mgr !== l.id) chiefOf.set(l.id, mgr);
      if (resp && mgr && resp !== mgr && !chiefOf.has(resp)) chiefOf.set(resp, mgr);
    }
    // Non creare cicli (A responsabile di B e B di A): si parte dai responsabili già presenti
    // e si salta ogni collegamento che chiuderebbe un anello.
    const parent = new Map<number, number>();
    for (const e of all) if (e.capo_id) parent.set(e.id, e.capo_id);
    const wouldLoop = (id: number, capo: number) => {
      for (let cur: number | undefined = capo, n = 0; cur && n < 1000; cur = parent.get(cur), n++) if (cur === id) return true;
      return false;
    };
    let loops = 0;
    for (const [id, capo_id] of chiefOf) {
      if (wouldLoop(id, capo_id)) { loops++; continue; }
      const res = await patch(id, { capo_id });
      if (res.ok) parent.set(id, capo_id);
    }

    return {
      inserted, skipped, errors,
      detail: `Nuovi: ${inserted} · già presenti e aggiornati: ${updated}${createdChiefs ? ` · responsabili creati: ${createdChiefs} (controlla la data di assunzione)` : ''}. Responsabile e manager si collegano per cognome (o cognome e nome)`
        + (loops ? ` Collegamenti ignorati perché creavano un ciclo (A responsabile di B e B di A): ${loops}.` : '')
        + (skippedRows.length ? ` Saltati (${skippedRows.length}): ${skippedRows.slice(0, 40).join(' | ')}${skippedRows.length > 40 ? ' …' : ''}.` : '')
        + (ambiguous.size ? ` Responsabili ambigui (più persone con lo stesso cognome), non collegati: ${[...ambiguous].join(', ')} — nell'Excel indica cognome e nome.` : '')
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

      <div className="card p-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gray-50">
          <span className="flex items-center gap-1.5 text-xs font-medium text-gray-500 uppercase tracking-wide">
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M3 4a1 1 0 011-1h12a1 1 0 01.8 1.6L12 11v5a1 1 0 01-1.45.9l-2-1A1 1 0 018 15v-4L3.2 4.6A1 1 0 013 4z" /></svg>
            Filtri
          </span>
          {hasFilters && (
            <button onClick={resetFilters} className="text-xs text-gray-400 hover:text-gray-600">Pulisci filtri</button>
          )}
        </div>
        <div className="grid grid-cols-[minmax(130px,1fr)_minmax(130px,1fr)_100px_minmax(110px,1fr)_minmax(120px,1fr)_minmax(120px,1fr)_100px] gap-x-3 px-4 py-3 items-center">
          <input value={fCognome} onChange={e => setFCognome(e.target.value)} placeholder="Cognome" className="input text-sm min-w-0" />
          <input value={fNome} onChange={e => setFNome(e.target.value)} placeholder="Nome" className="input text-sm min-w-0" />
          <input value={fMatricola} onChange={e => setFMatricola(e.target.value)} placeholder="Matricola" className="input text-sm min-w-0" />
          <select value={repartoFilter} onChange={e => setRepartoFilter(e.target.value ? Number(e.target.value) : '')} className="input text-sm min-w-0">
            <option value="">Reparto</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <input value={fMansione} onChange={e => setFMansione(e.target.value)} placeholder="Mansione" className="input text-sm min-w-0" />
          <input value={fResp} onChange={e => setFResp(e.target.value)} placeholder="Responsabile" className="input text-sm min-w-0" />
          <select value={statoFilter} onChange={e => setStatoFilter(e.target.value)} className="input text-sm min-w-0">
            <option value="">Stato</option>
            {Object.entries(STATO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="grid grid-cols-[minmax(130px,1fr)_minmax(130px,1fr)_100px_minmax(110px,1fr)_minmax(120px,1fr)_minmax(120px,1fr)_100px] gap-x-3 px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-xs font-medium text-gray-400 uppercase tracking-wide">
          <div>Cognome</div><div>Nome</div><div>Matricola</div><div>Reparto</div><div>Mansione</div><div>Responsabile</div><div className="text-center">Stato</div>
        </div>
        {loading ? (
          <p className="text-sm text-gray-400 text-center py-12">Caricamento…</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-12">Nessun dipendente trovato</p>
        ) : visible.map(e => (
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
      {choiceDialog}

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
