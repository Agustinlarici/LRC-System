'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import type { HrEmployee, HrDepartment, HrPlant, HrContractCompany, HrEmployeeTag } from '@/types';
import { ImportExcelButton, type ImportResult } from '@/components/ui/ImportExcelButton';
import { NewEmployeeModal } from './NewEmployeeModal';
import { TagsSettingsModal } from './TagsSettingsModal';
import { usePromptDialog, useChoiceDialog, SKIP_ALL } from '@/components/ui/PromptDialog';
import { tagDotStyle } from '@/lib/tagColors';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

// Etichette complete (anche legacy) per il badge di stato — usate ovunque uno stato
// vada mostrato. Il set selezionabile per nuovi stati è più ristretto: vedi STATO_FILTER_OPTIONS.
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
// Stati selezionabili nel filtro: "aspettativa"/"malattia" restano nel database solo
// per chi li aveva già (nessuna migrazione automatica), non sono più impostabili.
const STATO_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: 'attivo', label: 'Attivo' },
  { value: 'maternita_paternita', label: 'Maternità/Paternità' },
  { value: 'cessato', label: 'Cessato' },
];

const GRID_COLS = '28px minmax(130px,1fr) minmax(110px,1fr) 90px 56px minmax(100px,1fr) minmax(120px,1fr) '
  + 'minmax(100px,1fr) minmax(120px,1fr) minmax(110px,1fr) minmax(110px,1fr) minmax(120px,1fr) 80px '
  + 'minmax(120px,1fr) minmax(110px,1fr) 100px 100px 68px 118px 32px';

// Intestazioni esattamente come nell'Excel STR — il parser CSV le trasforma in
// minuscolo con underscore al posto degli spazi (mantiene apostrofi).
const IMPORT_COLUMNS = [
  'COGNOME E NOME', 'MATRICOLA', 'SESSO', 'CATEGORIA', "SOCIETA' CONTRATTO", "NAZIONALITA'",
  'MANSIONE (MICRO)', 'LIVELLO', 'REPARTO', 'PLANT', 'RESPONSABILE', 'MANAGER', 'FUNZIONE AZIENDALE',
  'DATA ASSUNZIONE', 'DATA CESSAZIONE', 'TIPOLOGIA CONTRATTO', "MATERNITA'", 'IN PROVA',
];

// Valori riconosciuti come "sì" nella colonna IN PROVA (case-insensitive)
const IN_PROVA_TRUE = new Set(['si', 'sì', 'x', '1', 'true', 'yes']);

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
  const [tags,         setTags]         = useState<HrEmployeeTag[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [fCognome, setFCognome] = useState('');
  const [fNome, setFNome] = useState('');
  const [fMatricola, setFMatricola] = useState('');
  const [fMansione, setFMansione] = useState('');
  const [fResp, setFResp] = useState('');
  const [fSesso, setFSesso] = useState('');
  const [fCategoria, setFCategoria] = useState('');
  const [fNazionalita, setFNazionalita] = useState('');
  const [fLivello, setFLivello] = useState('');
  const [fTipoContratto, setFTipoContratto] = useState('');
  const [funzioneFilter, setFunzioneFilter] = useState('');
  const [repartoFilter, setRepartoFilter] = useState<number | ''>('');
  const [plantFilter, setPlantFilter] = useState<number | ''>('');
  const [societaFilter, setSocietaFilter] = useState<number | ''>('');
  const [tagFilter, setTagFilter] = useState<number | ''>('');
  const [inProvaFilter, setInProvaFilter] = useState<'' | 'si' | 'no'>('');
  const [statoFilter,   setStatoFilter]   = useState<string>('attivo');
  const [showNew,       setShowNew]       = useState(false);
  const [showTags,      setShowTags]      = useState(false);
  const [tagMenuFor,    setTagMenuFor]    = useState<number | null>(null);
  const [tagMenuPos,    setTagMenuPos]    = useState<{ top: number; left: number } | null>(null);
  const { ask, dialog: promptDialog } = usePromptDialog();
  const { choose, dialog: choiceDialog } = useChoiceDialog();

  // Intestazione "congelata" fuori dall'area che scorre in verticale (invece di
  // position:sticky, che su Chrome dentro un contenitore overflow con bordi arrotondati
  // ha un bug di rendering visibile: righe che sembrano passare sopra l'intestazione).
  // Lo scroll orizzontale dei due blocchi resta sincronizzato via JS.
  const tableRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const [bodyMaxHeight, setBodyMaxHeight] = useState(440);
  useEffect(() => {
    function recompute() {
      if (!tableRef.current || !headerScrollRef.current) return;
      const top = tableRef.current.getBoundingClientRect().top;
      const headerHeight = headerScrollRef.current.getBoundingClientRect().height;
      setBodyMaxHeight(Math.max(200, window.innerHeight - top - headerHeight - 40));
    }
    recompute();
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, []);
  function syncHeaderScroll() {
    if (headerScrollRef.current && bodyScrollRef.current) {
      headerScrollRef.current.scrollLeft = bodyScrollRef.current.scrollLeft;
    }
    if (tagMenuFor !== null) setTagMenuFor(null);
  }

  // Ricarica leggera: solo l'elenco dipendenti, senza far sparire la tabella dietro
  // "Caricamento…" — usata dopo azioni rapide (etichetta, avviso) che non toccano i cataloghi.
  const refreshEmployees = useCallback(async () => {
    const params = new URLSearchParams();
    if (repartoFilter) params.set('reparto_id', String(repartoFilter));
    if (statoFilter) params.set('stato', statoFilter);
    const res = await fetch(`${BACKEND}/api/hr/employees?${params}`, { credentials: 'include' });
    if (res.ok) setEmployees(await res.json());
  }, [repartoFilter, statoFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (repartoFilter) params.set('reparto_id', String(repartoFilter));
    if (statoFilter) params.set('stato', statoFilter);
    const [empRes, depRes, plantRes, coRes, tagRes] = await Promise.all([
      fetch(`${BACKEND}/api/hr/employees?${params}`, { credentials: 'include' }),
      fetch(`${BACKEND}/api/hr/departments`, { credentials: 'include' }),
      fetch(`${BACKEND}/api/hr/plants`, { credentials: 'include' }),
      fetch(`${BACKEND}/api/hr/contract-companies`, { credentials: 'include' }),
      fetch(`${BACKEND}/api/hr/tags`, { credentials: 'include' }),
    ]);
    if (empRes.ok) setEmployees(await empRes.json());
    if (depRes.ok) setDepartments(await depRes.json());
    if (plantRes.ok) setPlants(await plantRes.json());
    if (coRes.ok) setCompanies(await coRes.json());
    if (tagRes.ok) setTags(await tagRes.json());
    setLoading(false);
  }, [repartoFilter, statoFilter]);

  useEffect(() => { load(); }, [load]);

  const hasFilters = !!(fCognome || fNome || fMatricola || fMansione || fResp || fSesso || fCategoria
    || fNazionalita || fLivello || fTipoContratto || funzioneFilter || repartoFilter || plantFilter
    || societaFilter || tagFilter || inProvaFilter || statoFilter !== 'attivo');
  function resetFilters() {
    setFCognome(''); setFNome(''); setFMatricola(''); setFMansione(''); setFResp('');
    setFSesso(''); setFCategoria(''); setFNazionalita(''); setFLivello(''); setFTipoContratto('');
    setFunzioneFilter(''); setRepartoFilter(''); setPlantFilter(''); setSocietaFilter('');
    setTagFilter(''); setInProvaFilter(''); setStatoFilter('attivo');
  }
  const funzioni = Array.from(new Set(employees.map(e => e.funzione_aziendale).filter((f): f is string => !!f))).sort((a, b) => a.localeCompare(b));
  const categorie = Array.from(new Set(employees.map(e => e.categoria).filter((f): f is string => !!f))).sort((a, b) => a.localeCompare(b));
  const tipiContratto = Array.from(new Set(employees.map(e => e.tipo_contratto).filter((f): f is string => !!f))).sort((a, b) => a.localeCompare(b));
  const visible = employees.filter(e => {
    const has = (v: string | null | undefined, q: string) => !q.trim() || (v ?? '').toLowerCase().includes(q.trim().toLowerCase());
    return has(e.cognome, fCognome) && has(e.nome, fNome) && has(e.matricola, fMatricola)
      && has(e.mansione, fMansione) && has(e.capo_nome, fResp) && has(e.nazionalita, fNazionalita)
      && has(e.livello, fLivello)
      && (!fSesso || e.sesso === fSesso)
      && (!fCategoria || e.categoria === fCategoria)
      && (!fTipoContratto || e.tipo_contratto === fTipoContratto)
      && (!plantFilter || (e.plant_ids ?? []).includes(Number(plantFilter)))
      && (!societaFilter || e.contract_company_id === Number(societaFilter))
      && (!tagFilter || e.tag_id === Number(tagFilter))
      && (!inProvaFilter || (inProvaFilter === 'si' ? e.in_prova : !e.in_prova))
      && (!funzioneFilter || (e.funzione_aziendale ?? '') === funzioneFilter);
  });

  async function setEmployeeTag(employeeId: number, tagId: number | null) {
    setTagMenuFor(null);
    const res = await fetch(`${BACKEND}/api/hr/employees/${employeeId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ tag_id: tagId }),
    });
    if (res.ok) refreshEmployees();
  }

  async function clearImportWarning(employeeId: number) {
    const res = await fetch(`${BACKEND}/api/hr/employees/${employeeId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ import_warning: null }),
    });
    if (res.ok) refreshEmployees();
  }

  async function importRows(rows: Record<string, string>[]): Promise<ImportResult> {
    let inserted = 0, updated = 0, skipped = 0, errors = 0, warnings = 0;
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
      // Riga senza nessun nome: non c'è nulla da collegare a una persona, va saltata davvero.
      if (parts.length === 0) {
        skipped++;
        skippedRows.push('(riga vuota): nessun nome');
        continue;
      }
      // Dati incompleti/incerti (nome a una sola parola, data assunzione mancante o non
      // valida): si carica comunque il dipendente, ma resta un avviso finché non si corregge.
      const rowWarnings: string[] = [];
      let nome: string, cognome: string;
      if (parts.length < 2) {
        nome = parts[0]; cognome = parts[0];
        rowWarnings.push('nome e cognome incompleti nell\'Excel (una sola parola)');
      } else {
        nome = parts[parts.length - 1];
        cognome = parts.slice(0, -1).join(' ');
      }
      let dataAssunzione = parseItalianDate(row['data_assunzione']);
      if (!dataAssunzione) {
        rowWarnings.push(`data assunzione mancante o non valida ("${row['data_assunzione'] ?? ''}"), impostata a oggi`);
        dataAssunzione = today;
      }

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
        in_prova: IN_PROVA_TRUE.has((row['in_prova'] ?? '').trim().toLowerCase()),
        // Rieseguendo l'import con l'Excel corretto l'avviso si aggiorna (o si pulisce da solo).
        import_warning: rowWarnings.length ? rowWarnings.join(' | ') : null,
      };
      if (rowWarnings.length) warnings++;

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
      inserted, skipped, errors, warnings,
      detail: `Nuovi: ${inserted} · già presenti e aggiornati: ${updated}${createdChiefs ? ` · responsabili creati: ${createdChiefs} (controlla la data di assunzione)` : ''}. Responsabile e manager si collegano per cognome (o cognome e nome)`
        + (warnings ? ` Con dati incompleti ma caricati comunque (vedi colonna avvisi nella tabella): ${warnings}.` : '')
        + (loops ? ` Collegamenti ignorati perché creavano un ciclo (A responsabile di B e B di A): ${loops}.` : '')
        + (skippedRows.length ? ` Saltati (${skippedRows.length}): ${skippedRows.slice(0, 40).join(' | ')}${skippedRows.length > 40 ? ' …' : ''}.` : '')
        + (ambiguous.size ? ` Responsabili ambigui (più persone con lo stesso cognome), non collegati: ${[...ambiguous].join(', ')} — nell'Excel indica cognome e nome.` : '')
        + (missing.size ? `; non collegati perché non creati: ${[...missing].join(', ')}.` : '.'),
    };
  }

  return (
    <div className="space-y-4" onClick={() => { if (tagMenuFor !== null) setTagMenuFor(null); }}>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-medium text-gray-900">Dipendenti</h1>
        </div>
        {manage && (
          <div className="flex items-center gap-2">
            <ImportExcelButton columns={IMPORT_COLUMNS} processRows={importRows} onDone={load} label="Importa da Excel" />
            <button onClick={() => setShowTags(true)} className="btn-secondary text-sm">Etichette</button>
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
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 px-4 py-3">
          <input value={fCognome} onChange={e => setFCognome(e.target.value)} placeholder="Cognome" className="input text-sm min-w-0" />
          <input value={fNome} onChange={e => setFNome(e.target.value)} placeholder="Nome" className="input text-sm min-w-0" />
          <input value={fMatricola} onChange={e => setFMatricola(e.target.value)} placeholder="Matricola" className="input text-sm min-w-0" />
          <select value={fSesso} onChange={e => setFSesso(e.target.value)} className={`input text-sm min-w-0 ${fSesso ? '' : 'text-gray-400'}`}>
            <option value="">Sesso</option>
            <option value="M" className="text-gray-900">M</option>
            <option value="F" className="text-gray-900">F</option>
          </select>
          <select value={fCategoria} onChange={e => setFCategoria(e.target.value)} className={`input text-sm min-w-0 ${fCategoria ? '' : 'text-gray-400'}`}>
            <option value="">Categoria</option>
            {categorie.map(c => <option key={c} value={c} className="text-gray-900">{c}</option>)}
          </select>
          <select value={societaFilter} onChange={e => setSocietaFilter(e.target.value ? Number(e.target.value) : '')} className={`input text-sm min-w-0 ${societaFilter ? '' : 'text-gray-400'}`}>
            <option value="">Società contratto</option>
            {companies.map(c => <option key={c.id} value={c.id} className="text-gray-900">{c.name}</option>)}
          </select>
          <input value={fNazionalita} onChange={e => setFNazionalita(e.target.value)} placeholder="Nazionalità" className="input text-sm min-w-0" />
          <select value={funzioneFilter} onChange={e => setFunzioneFilter(e.target.value)} className={`input text-sm min-w-0 ${funzioneFilter ? '' : 'text-gray-400'}`}>
            <option value="">Funzione</option>
            {funzioni.map(f => <option key={f} value={f} className="text-gray-900">{f}</option>)}
          </select>
          <select value={repartoFilter} onChange={e => setRepartoFilter(e.target.value ? Number(e.target.value) : '')} className={`input text-sm min-w-0 ${repartoFilter ? '' : 'text-gray-400'}`}>
            <option value="">Reparto</option>
            {departments.map(d => <option key={d.id} value={d.id} className="text-gray-900">{d.name}</option>)}
          </select>
          <select value={plantFilter} onChange={e => setPlantFilter(e.target.value ? Number(e.target.value) : '')} className={`input text-sm min-w-0 ${plantFilter ? '' : 'text-gray-400'}`}>
            <option value="">Plant</option>
            {plants.map(p => <option key={p.id} value={p.id} className="text-gray-900">{p.name}</option>)}
          </select>
          <input value={fMansione} onChange={e => setFMansione(e.target.value)} placeholder="Mansione" className="input text-sm min-w-0" />
          <input value={fLivello} onChange={e => setFLivello(e.target.value)} placeholder="Livello" className="input text-sm min-w-0" />
          <input value={fResp} onChange={e => setFResp(e.target.value)} placeholder="Responsabile" className="input text-sm min-w-0" />
          <select value={fTipoContratto} onChange={e => setFTipoContratto(e.target.value)} className={`input text-sm min-w-0 ${fTipoContratto ? '' : 'text-gray-400'}`}>
            <option value="">Tipo contratto</option>
            {tipiContratto.map(t => <option key={t} value={t} className="text-gray-900">{t}</option>)}
          </select>
          <select value={tagFilter} onChange={e => setTagFilter(e.target.value ? Number(e.target.value) : '')} className={`input text-sm min-w-0 ${tagFilter ? '' : 'text-gray-400'}`}>
            <option value="">Etichetta</option>
            {tags.map(t => <option key={t.id} value={t.id} className="text-gray-900">{t.name}</option>)}
          </select>
          <select value={inProvaFilter} onChange={e => setInProvaFilter(e.target.value as '' | 'si' | 'no')} className={`input text-sm min-w-0 ${inProvaFilter ? '' : 'text-gray-400'}`}>
            <option value="">In prova</option>
            <option value="si" className="text-gray-900">Sì</option>
            <option value="no" className="text-gray-900">No</option>
          </select>
          <select value={statoFilter} onChange={e => setStatoFilter(e.target.value)} className={`input text-sm min-w-0 ${statoFilter ? '' : 'text-gray-400'}`}>
            <option value="">Stato</option>
            {STATO_FILTER_OPTIONS.map(o => <option key={o.value} value={o.value} className="text-gray-900">{o.label}</option>)}
          </select>
        </div>
      </div>

      <div ref={tableRef} className="card p-0 overflow-hidden">
        <div ref={headerScrollRef} className="overflow-x-hidden">
          <div className="grid gap-x-3 px-4 py-2.5 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-400 uppercase tracking-wide"
            style={{ gridTemplateColumns: GRID_COLS, minWidth: 1700 }}>
            <div />
            <div>Cognome</div><div>Nome</div><div>Matricola</div><div>Sesso</div><div>Categoria</div>
            <div>Società</div><div>Nazionalità</div><div>Funzione</div><div>Reparto</div><div>Plant</div>
            <div>Mansione</div><div>Livello</div><div>Responsabile</div><div>Tipo contratto</div>
            <div>Assunzione</div><div>Cessazione</div><div className="text-center">Prova</div>
            <div className="text-center">Stato</div><div />
          </div>
        </div>
        <div ref={bodyScrollRef} onScroll={syncHeaderScroll} className="hr-table-scroll overflow-auto" style={{ maxHeight: bodyMaxHeight }}>
        <div style={{ minWidth: 1700 }}>
          {loading ? (
            <p className="text-sm text-gray-400 text-center py-12">Caricamento…</p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-12">Nessun dipendente trovato</p>
          ) : visible.map(e => (
            <Link key={e.id} href={`/hr/dipendenti/${e.id}`}
              className="relative z-0 grid gap-x-3 px-4 py-3 border-b border-gray-50 last:border-b-0 bg-white hover:bg-gray-50 transition-colors items-center"
              style={{ gridTemplateColumns: GRID_COLS }}
            >
              <div className="relative">
                <button
                  type="button"
                  title={e.tag_name ? `${e.tag_name}${manage ? ' — clicca per cambiare' : ''}` : (manage ? 'Assegna etichetta' : 'Nessuna etichetta')}
                  onClick={ev => {
                    if (!manage) return;
                    ev.preventDefault(); ev.stopPropagation();
                    if (tagMenuFor === e.id) { setTagMenuFor(null); return; }
                    const rect = ev.currentTarget.getBoundingClientRect();
                    setTagMenuPos({ top: rect.bottom + 4, left: rect.left });
                    setTagMenuFor(e.id);
                  }}
                  className={`w-3 h-3 rounded-full ${tagDotStyle(e.tag_color).className} ${manage ? 'cursor-pointer' : ''}`}
                  style={tagDotStyle(e.tag_color).style}
                />
                {tagMenuFor === e.id && tagMenuPos && createPortal(
                  <div
                    onClick={ev => { ev.preventDefault(); ev.stopPropagation(); }}
                    style={{ top: tagMenuPos.top, left: tagMenuPos.left }}
                    className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 w-44 text-sm"
                  >
                    <button type="button" onClick={() => setEmployeeTag(e.id, null)} className="w-full text-left px-3 py-1.5 hover:bg-gray-50 text-gray-500">Nessuna</button>
                    {tags.filter(t => t.is_active).map(t => (
                      <button key={t.id} type="button" onClick={() => setEmployeeTag(e.id, t.id)} className="w-full flex items-center gap-2 text-left px-3 py-1.5 hover:bg-gray-50">
                        <span className={`w-2.5 h-2.5 rounded-full ${tagDotStyle(t.color).className}`} style={tagDotStyle(t.color).style} />{t.name}
                      </button>
                    ))}
                  </div>,
                  document.body
                )}
              </div>
              <div className="text-sm font-medium text-gray-800 truncate">{e.cognome}</div>
              <div className="text-sm text-gray-800 truncate">{e.nome}</div>
              <div className="text-sm text-gray-600 truncate">{e.matricola ?? '—'}</div>
              <div className="text-sm text-gray-600 truncate">{e.sesso ?? '—'}</div>
              <div className="text-sm text-gray-600 truncate">{e.categoria ?? '—'}</div>
              <div className="text-sm text-gray-600 truncate">{e.contract_company_name ?? '—'}</div>
              <div className="text-sm text-gray-600 truncate">{e.nazionalita ?? '—'}</div>
              <div className="text-sm text-gray-600 truncate">{e.funzione_aziendale ?? '—'}</div>
              <div className="text-sm text-gray-600 truncate">{e.reparto_name ?? '—'}</div>
              <div className="text-sm text-gray-600 truncate">{e.plant_name ?? '—'}</div>
              <div className="text-sm text-gray-600 truncate">{e.mansione ?? '—'}</div>
              <div className="text-sm text-gray-600 truncate">{e.livello ?? '—'}</div>
              <div className="text-sm text-gray-600 truncate">{e.capo_nome ?? '—'}</div>
              <div className="text-sm text-gray-600 truncate">{e.tipo_contratto ?? '—'}</div>
              <div className="text-sm text-gray-600 truncate">{e.data_assunzione?.slice(0, 10) ?? '—'}</div>
              <div className="text-sm text-gray-600 truncate">{e.data_cessazione?.slice(0, 10) ?? '—'}</div>
              <div className="text-center text-sm text-gray-600">{e.in_prova ? 'Sì' : '—'}</div>
              <div className="text-center">
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${STATO_COLOR[e.stato]}`}>{STATO_LABEL[e.stato]}</span>
              </div>
              <div className="text-center">
                {e.import_warning && (
                  <button
                    type="button" title={`${e.import_warning}${manage ? ' — clicca per segnare come risolto' : ''}`}
                    onClick={ev => { if (!manage) return; ev.preventDefault(); ev.stopPropagation(); clearImportWarning(e.id); }}
                    className="text-amber-500"
                  >
                    ⚠
                  </button>
                )}
              </div>
            </Link>
          ))}
        </div>
        </div>
      </div>

      {promptDialog}
      {choiceDialog}

      {showNew && (
        <NewEmployeeModal
          departments={departments}
          plants={plants}
          companies={companies}
          tags={tags}
          funzioni={funzioni}
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); load(); }}
        />
      )}

      {showTags && (
        <TagsSettingsModal
          tags={tags}
          onClose={() => setShowTags(false)}
          onChanged={load}
        />
      )}
    </div>
  );
}
