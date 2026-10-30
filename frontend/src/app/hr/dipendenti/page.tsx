'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { useAuth } from '@/lib/auth';
import type { HrEmployee, HrDepartment, HrPlant, HrContractCompany, HrEmployeeTag } from '@/types';
import { ImportExcelButton, type ImportExcelHandle, type ImportResult, type ImportIssue } from '@/components/ui/ImportExcelButton';
import { runOstiImport } from './ostiImport';
import { NewEmployeeModal } from './NewEmployeeModal';
import { TagsSettingsModal } from './TagsSettingsModal';
import { usePromptDialog, useChoiceDialog, useConfirmDialog, SKIP_ALL } from '@/components/ui/PromptDialog';
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

// Colonna ⚠ (avvisi dell'import) in testa, solo se almeno una riga in elenco ne ha uno
const gridCols = (warn: boolean) => (warn ? '24px ' : '') + GRID_COLS;
// Larghezza minima della tabella: somma delle colonne, così righe e intestazione hanno lo stesso sfondo
const TABLE_MIN_WIDTH = 3280;
const GRID_COLS = '28px minmax(130px,1fr) minmax(110px,1fr) 90px 56px minmax(100px,1fr) minmax(120px,1fr) '
  + 'minmax(100px,1fr) 92px minmax(170px,1.2fr) minmax(170px,1.2fr) minmax(110px,1fr) 60px 64px '
  + 'minmax(120px,1fr) minmax(110px,1fr) minmax(110px,1fr) minmax(120px,1fr) 80px '
  + 'minmax(120px,1fr) minmax(110px,1fr) minmax(120px,1fr) minmax(150px,1.2fr) 100px 100px 68px 118px';

// Intestazioni esattamente come nell'Excel STR — il parser CSV le trasforma in
// minuscolo con underscore al posto degli spazi (mantiene apostrofi).
const IMPORT_COLUMNS = [
  'COGNOME E NOME', 'MATRICOLA', 'CODICE FISCALE', 'SESSO', 'CATEGORIA', "SOCIETA' CONTRATTO", "NAZIONALITA'",
  'MANSIONE (MICRO)', 'LIVELLO', 'REPARTO', 'PLANT', 'RESPONSABILE', 'MANAGER', 'FUNZIONE AZIENDALE',
  'DATA ASSUNZIONE', 'DATA CESSAZIONE', 'TIPOLOGIA CONTRATTO', "MATERNITA'", 'IN PROVA',
  // facoltative: se mancano o sono vuote non cancellano quanto già inserito nella scheda
  'DATA NASCITA', 'EMAIL', 'INDIRIZZO', 'CITTA', 'PROVINCIA', 'CAP', 'GRUPPO ORARIO',
];

// Valori riconosciuti come "sì" nella colonna IN PROVA (case-insensitive)
const IN_PROVA_TRUE = new Set(['si', 'sì', 'x', '1', 'true', 'yes']);

// Fasce di matricola per plant, nell'ordine in cui vanno mostrate
const MATRICOLA_BANDS = [
  { label: 'STR1', from: 1,    to: 999 },
  { label: 'STR2', from: 1000, to: 1999 },
  { label: 'STR3', from: 3000, to: 3999 },
  { label: 'STR5', from: 2000, to: 2999 },
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
  const router = useRouter();
  const { canManage } = useAuth();
  const manage = canManage('hr');

  const [employees,   setEmployees]   = useState<HrEmployee[]>([]);
  const [departments, setDepartments] = useState<HrDepartment[]>([]);
  const [plants,       setPlants]       = useState<HrPlant[]>([]);
  const [companies,    setCompanies]    = useState<HrContractCompany[]>([]);
  const [tags,         setTags]         = useState<HrEmployeeTag[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [fNominativo, setFNominativo] = useState('');
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
  const [avvisoFilter, setAvvisoFilter] = useState<'' | 'si' | 'no'>('');
  // Filtri delle altre colonne: testo (contiene), elenco (valore esatto) e intervalli di date (dal / al)
  const [showExtraFilters, setShowExtraFilters] = useState(false);
  const [fMese, setFMese] = useState('');
  const [fGiorno, setFGiorno] = useState('');
  const [fEmail, setFEmail] = useState('');
  const [fIndirizzo, setFIndirizzo] = useState('');
  const [fCitta, setFCitta] = useState('');
  const [fCap, setFCap] = useState('');
  const [fNomeOsti, setFNomeOsti] = useState('');
  const [fProv, setFProv] = useState('');
  const [fGruppo, setFGruppo] = useState('');
  const [fNascitaDa, setFNascitaDa] = useState('');
  const [fNascitaA, setFNascitaA] = useState('');
  const [fAssunzioneDa, setFAssunzioneDa] = useState('');
  const [fAssunzioneA, setFAssunzioneA] = useState('');
  const [fCessazioneDa, setFCessazioneDa] = useState('');
  const [fCessazioneA, setFCessazioneA] = useState('');
  const [statoFilter,   setStatoFilter]   = useState<string>('attivo');
  const [showFilters,   setShowFilters]   = useState(true);
  const [showNew,       setShowNew]       = useState(false);
  const [showTags,      setShowTags]      = useState(false);
  const [tagMenuFor,    setTagMenuFor]    = useState<number | null>(null);
  const [showMore,      setShowMore]      = useState(false);
  const importRef = useRef<ImportExcelHandle>(null);
  const [tagMenuPos,    setTagMenuPos]    = useState<{ top: number; left: number } | null>(null);
  const [showMatricole, setShowMatricole] = useState(false);
  const [matricoleBands, setMatricoleBands] = useState<{ label: string; from: number; to: number; last: number | null; next: number | null; count: number }[] | null>(null);

  // Prossima matricola per ogni fascia di plant (MATRICOLA_BANDS): ultima usata + 1.
  // Considera tutti i dipendenti, anche cessati, perché una matricola non va riassegnata.
  async function openMatricole() {
    setShowMatricole(true);
    setMatricoleBands(null);
    const res = await fetch(`${BACKEND}/api/hr/employees`, { credentials: 'include' });
    const all: HrEmployee[] = res.ok ? await res.json() : [];
    const bands = MATRICOLA_BANDS.map(b => {
      let last: number | null = null;
      let count = 0;
      for (const e of all) {
        const m = e.matricola?.trim();
        if (!m || !/^\d+$/.test(m)) continue;
        const n = parseInt(m, 10);
        if (n < b.from || n > b.to) continue;
        count++;
        if (last === null || n > last) last = n;
      }
      const candidate = last === null ? b.from : last + 1;
      return { ...b, last, next: candidate <= b.to ? candidate : null, count };
    });
    setMatricoleBands(bands);
  }

  const { ask, dialog: promptDialog } = usePromptDialog();
  const { choose, dialog: choiceDialog } = useChoiceDialog();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

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
  }, [showFilters]);
  function syncHeaderScroll() {
    if (headerScrollRef.current && bodyScrollRef.current) {
      headerScrollRef.current.scrollLeft = bodyScrollRef.current.scrollLeft;
    }
    if (tagMenuFor !== null) setTagMenuFor(null);
  }

  // Ricarica leggera: solo l'elenco dipendenti, senza far sparire la tabella dietro
  // "Caricamento…" — usata dopo azioni rapide (etichetta, avviso) che non toccano i cataloghi.
  const refreshEmployees = useCallback(async () => {
    const res = await fetch(`${BACKEND}/api/hr/employees`, { credentials: 'include' });
    if (res.ok) setEmployees(await res.json());
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [empRes, depRes, plantRes, coRes, tagRes] = await Promise.all([
      fetch(`${BACKEND}/api/hr/employees`, { credentials: 'include' }),
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
  }, []);

  useEffect(() => { load(); }, [load]);

  // filtri aggiuntivi attivi: si vedono sul pulsante anche quando il pannello è chiuso
  const extraCount = [fEmail, fIndirizzo, fCitta, fCap, fNomeOsti, fProv, fGruppo, fMese, fGiorno,
    fNascitaDa || fNascitaA, fAssunzioneDa || fAssunzioneA, fCessazioneDa || fCessazioneA].filter(Boolean).length;
  const hasFilters = !!(fNominativo || fMatricola || fMansione || fResp || fSesso || fCategoria
    || fNazionalita || fLivello || fTipoContratto || funzioneFilter || repartoFilter || plantFilter
    || societaFilter || tagFilter || inProvaFilter || avvisoFilter || statoFilter !== 'attivo'
    || extraCount > 0);
  function resetFilters() {
    setFNominativo(''); setFMatricola(''); setFMansione(''); setFResp('');
    setFSesso(''); setFCategoria(''); setFNazionalita(''); setFLivello(''); setFTipoContratto('');
    setFunzioneFilter(''); setRepartoFilter(''); setPlantFilter(''); setSocietaFilter('');
    setTagFilter(''); setInProvaFilter(''); setAvvisoFilter(''); setStatoFilter('attivo');
    setFMese(''); setFGiorno(''); setFEmail(''); setFIndirizzo(''); setFCitta(''); setFCap(''); setFNomeOsti(''); setFProv(''); setFGruppo('');
    setFNascitaDa(''); setFNascitaA(''); setFAssunzioneDa(''); setFAssunzioneA(''); setFCessazioneDa(''); setFCessazioneA('');
  }
  // `skip` esclude un filtro dal confronto: serve a calcolare le opzioni di quel menu
  // in base a tutti gli ALTRI filtri attivi.
  type FilterKey = 'sesso' | 'categoria' | 'societa' | 'nazionalita' | 'funzione' | 'reparto' | 'plant'
    | 'mansione' | 'livello' | 'resp' | 'tipoContratto' | 'tag' | 'inProva' | 'avviso' | 'stato' | 'prov' | 'gruppo';
  const matches = (e: HrEmployee, skip?: FilterKey) => {
    const has = (v: string | null | undefined, q: string) => !q.trim() || (v ?? '').toLowerCase().includes(q.trim().toLowerCase());
    const inRange = (v: string | null | undefined, da: string, a: string) =>
      (!da && !a) || (!!v && (!da || v.slice(0, 10) >= da) && (!a || v.slice(0, 10) <= a));
    // Nome e cognome in un solo filtro: ogni parola digitata deve comparire, in qualunque ordine
    const fullName = `${e.cognome} ${e.nome}`.toLowerCase();
    return fNominativo.trim().toLowerCase().split(/\s+/).filter(Boolean).every(w => fullName.includes(w))
      && has(e.matricola, fMatricola)
      && has(e.email, fEmail) && has(e.indirizzo, fIndirizzo) && has(e.citta, fCitta) && has(e.cap, fCap) && has(e.nome_osti, fNomeOsti)
      && (skip === 'prov' || !fProv || (e.provincia ?? '') === fProv)
      && (skip === 'gruppo' || !fGruppo || (e.gruppo_orario ?? '') === fGruppo)
      && inRange(e.data_nascita, fNascitaDa, fNascitaA)
      && ((!fMese && !fGiorno) || (!!e.data_nascita
        && (!fMese || Number(e.data_nascita.slice(5, 7)) === Number(fMese))
        && (!fGiorno || Number(e.data_nascita.slice(8, 10)) === Number(fGiorno))))
      && inRange(e.data_assunzione, fAssunzioneDa, fAssunzioneA)
      && inRange(e.data_cessazione, fCessazioneDa, fCessazioneA)
      && (skip === 'mansione' || !fMansione || e.mansione === fMansione)
      && (skip === 'resp' || !fResp || e.capo_nome === fResp)
      && (skip === 'nazionalita' || !fNazionalita || e.nazionalita === fNazionalita)
      && (skip === 'livello' || !fLivello || e.livello === fLivello)
      && (skip === 'sesso' || !fSesso || e.sesso === fSesso)
      && (skip === 'categoria' || !fCategoria || e.categoria === fCategoria)
      && (skip === 'tipoContratto' || !fTipoContratto || e.tipo_contratto === fTipoContratto)
      && (skip === 'plant' || !plantFilter || (e.plant_ids ?? []).includes(Number(plantFilter)))
      && (skip === 'societa' || !societaFilter || e.contract_company_id === Number(societaFilter))
      && (skip === 'tag' || !tagFilter || e.tag_id === Number(tagFilter))
      && (skip === 'inProva' || !inProvaFilter || (inProvaFilter === 'si' ? e.in_prova : !e.in_prova))
      && (skip === 'avviso' || !avvisoFilter || (avvisoFilter === 'si' ? !!e.import_warning : !e.import_warning))
      && (skip === 'funzione' || !funzioneFilter || (e.funzione_aziendale ?? '') === funzioneFilter)
      && (skip === 'reparto' || !repartoFilter || e.reparto_id === Number(repartoFilter))
      && (skip === 'stato' || !statoFilter || e.stato === statoFilter);
  };
  const visible = employees.filter(e => matches(e));
  const showWarnCol = visible.some(e => e.import_warning);
  // Opzioni di ogni menu: solo quelle con almeno un dipendente tra gli altri filtri attivi
  // (il valore già selezionato resta sempre, così si può togliere).
  const pool = (skip: FilterKey) => employees.filter(e => matches(e, skip));
  const distinctOf = (list: HrEmployee[], pick: (e: HrEmployee) => string | null | undefined, selected: string) =>
    Array.from(new Set([...list.map(pick).filter((v): v is string => !!v), ...(selected ? [selected] : [])])).sort((a, b) => a.localeCompare(b));
  const categorie = distinctOf(pool('categoria'), e => e.categoria, fCategoria);
  const province = distinctOf(pool('prov'), e => e.provincia, fProv);
  const gruppiOrari = distinctOf(pool('gruppo'), e => e.gruppo_orario, fGruppo);
  const nazionalita = distinctOf(pool('nazionalita'), e => e.nazionalita, fNazionalita);
  const funzioni = distinctOf(pool('funzione'), e => e.funzione_aziendale, funzioneFilter);
  const mansioni = distinctOf(pool('mansione'), e => e.mansione, fMansione);
  const livelli = distinctOf(pool('livello'), e => e.livello, fLivello);
  const responsabili = distinctOf(pool('resp'), e => e.capo_nome, fResp);
  const tipiContratto = distinctOf(pool('tipoContratto'), e => e.tipo_contratto, fTipoContratto);
  const sessoDisponibili = new Set(pool('sesso').map(e => e.sesso));
  const societaDisponibili = new Set(pool('societa').map(e => e.contract_company_id));
  const companiesShown = companies.filter(c => societaDisponibili.has(c.id) || c.id === Number(societaFilter));
  const repartiDisponibili = new Set(pool('reparto').map(e => e.reparto_id));
  const departmentsShown = departments.filter(d => repartiDisponibili.has(d.id) || d.id === Number(repartoFilter));
  const plantDisponibili = new Set(pool('plant').flatMap(e => e.plant_ids ?? []));
  const plantsShown = plants.filter(p => plantDisponibili.has(p.id) || p.id === Number(plantFilter));
  const tagDisponibili = new Set(pool('tag').map(e => e.tag_id));
  const tagsShown = tags.filter(t => tagDisponibili.has(t.id) || t.id === Number(tagFilter));
  const provaPool = pool('inProva');
  const provaSi = provaPool.some(e => e.in_prova), provaNo = provaPool.some(e => !e.in_prova);
  const avvisoPool = pool('avviso');
  const avvisoSi = avvisoPool.some(e => e.import_warning), avvisoNo = avvisoPool.some(e => !e.import_warning);
  const statiDisponibili = new Set(pool('stato').map(e => e.stato));
  const statiShown = STATO_FILTER_OPTIONS.filter(o => statiDisponibili.has(o.value as HrEmployee['stato']) || o.value === statoFilter);

  function exportExcel() {
    const rows = visible.map(e => ({
      Cognome: e.cognome, Nome: e.nome, Matricola: e.matricola ?? '', Sesso: e.sesso ?? '',
      Categoria: e.categoria ?? '', Società: e.contract_company_name ?? '', Nazionalità: e.nazionalita ?? '',
      'Data nascita': e.data_nascita?.slice(0, 10) ?? '', Email: e.email ?? '', Indirizzo: e.indirizzo ?? '',
      Città: e.citta ?? '', Provincia: e.provincia ?? '', CAP: e.cap ?? '',
      Funzione: e.funzione_aziendale ?? '', Reparto: e.reparto_name ?? '', Plant: e.plant_name ?? '',
      Mansione: e.mansione ?? '', Livello: e.livello ?? '', Responsabile: e.capo_nome ?? '',
      'Tipo contratto': e.tipo_contratto ?? '', 'Gruppo orario': e.gruppo_orario ?? '', 'Nome Osti': e.nome_osti ?? '',
      'Taglia pantaloni': e.taglia_pantaloni ?? '', 'Taglia maglia': e.taglia_maglia ?? '', 'Taglia scarpe': e.taglia_scarpe ?? '', Assunzione: e.data_assunzione?.slice(0, 10) ?? '',
      Cessazione: e.data_cessazione?.slice(0, 10) ?? '', 'In prova': e.in_prova ? 'Sì' : '',
      Stato: STATO_LABEL[e.stato] ?? e.stato,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Dipendenti');
    XLSX.writeFile(wb, `dipendenti-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

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

  async function importRows(rows: Record<string, string>[], variant?: string): Promise<ImportResult> {
    if (variant === 'osti') {
      const [empRes, depRes] = await Promise.all([
        fetch(`${BACKEND}/api/hr/employees`, { credentials: 'include' }),
        fetch(`${BACKEND}/api/hr/departments`, { credentials: 'include' }),
      ]);
      if (!empRes.ok || !depRes.ok) return { inserted: 0, skipped: 0, errors: 1, detail: 'Impossibile leggere dipendenti e reparti.' };
      return runOstiImport(rows, { backend: BACKEND, employees: await empRes.json(), departments: await depRes.json(), confirm, onChanged: refreshEmployees });
    }
    // 'storico': i cambiamenti compaiono nella timeline con la data di oggi.
    // 'sostituisci': i dati si aggiornano senza lasciare eventi, come se fossero sempre stati così.
    const historyQuery = variant === 'sostituisci' ? '?storico=0' : '';
    let inserted = 0, updated = 0, skipped = 0, errors = 0, warnings = 0;
    const issues: ImportIssue[] = [];   // tabella "Vedi dettaglio" del risultato
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
    const empByCF = new Map<string, number>();
    const empByFullName  = new Map<string, number>();
    const empByNomeCognome = new Map<string, number>();
    for (const e of all) {
      addCognome(e.cognome, e.id, e.nome);
      if (e.matricola) empByMatricola.set(e.matricola.toLowerCase(), e.id);
      if (e.codice_fiscale) empByCF.set(e.codice_fiscale.replace(/\s+/g, '').toUpperCase(), e.id);
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
      return fetch(`${BACKEND}/api/hr/employees/${id}${historyQuery}`, {
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
        issues.push({ type: 'Saltato', name: '(riga vuota)', note: 'nessun nome' });
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

      // Codice fiscale: solo se presente nella riga, così un Excel senza la colonna (o con la cella
      // vuota) non cancella un valore già inserito a mano nella scheda.
      const cf = (row['codice_fiscale'] ?? '').replace(/\s+/g, '').toUpperCase();

      // Anagrafica facoltativa: solo se presente nella riga (stesso criterio del codice fiscale)
      const optional = (v: string | undefined) => (v ?? '').trim();
      const dataNascita = parseItalianDate(row['data_nascita']);
      const email = optional(row['email']);
      const extra: Record<string, string> = {};
      for (const [field, value] of [
        ['indirizzo', optional(row['indirizzo'])], ['citta', optional(row['citta'] ?? row["citta'"])],
        ['provincia', optional(row['provincia']).toUpperCase()], ['cap', optional(row['cap'])],
        ['gruppo_orario', optional(row['gruppo_orario'])],
        ...(dataNascita ? [['data_nascita', dataNascita]] : []),
        ...(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? [['email', email]] : []),
      ] as [string, string][]) if (value) extra[field] = value;

      const fields = {
        matricola, nome, cognome,
        ...(cf ? { codice_fiscale: cf } : {}),
        ...extra,
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
      if (rowWarnings.length) { warnings++; issues.push({ type: 'Dati incompleti', name: `${cognome} ${nome}`, note: rowWarnings.join(' | ') }); }

      const existingId = (matricola && empByMatricola.get(matricola.toLowerCase()))
        || (cf && empByCF.get(cf))
        || empByFullName.get(`${cognome} ${nome}`.toLowerCase());

      let id: number | null = null;
      if (existingId) {
        const res = await patch(existingId, { ...fields, stato: cessato ? 'cessato' : 'attivo' });
        if (res.ok) { updated++; id = existingId; } else { errors++; issues.push({ type: 'Errore', name: `${cognome} ${nome}`, note: 'aggiornamento rifiutato dal server' }); }
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
          if (cf) empByCF.set(cf, emp.id);

          const maternita = row["maternita'"]?.trim();
          if (maternita) {
            await fetch(`${BACKEND}/api/hr/employees/${emp.id}/events`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
              body: JSON.stringify({ event_type: 'maternita_paternita', event_date: parseItalianDate(maternita) ?? dataAssunzione, note: maternita }),
            });
          }
        } else { errors++; issues.push({ type: 'Errore', name: `${cognome} ${nome}`, note: 'creazione rifiutata dal server' }); }
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
    for (const [id, capo_id] of chiefOf) {
      if (wouldLoop(id, capo_id)) { issues.push({ type: 'Ciclo ignorato', name: labelOf.get(id) ?? String(id), note: `responsabile ${labelOf.get(capo_id) ?? capo_id}: sarebbe responsabile di chi lo guida` }); continue; }
      const res = await patch(id, { capo_id });
      if (res.ok) parent.set(id, capo_id);
    }

    for (const raw of ambiguous) issues.push({ type: 'Responsabile ambiguo', name: raw, note: 'più persone con questo cognome: nell\'Excel indica cognome e nome' });
    for (const raw of missing) issues.push({ type: 'Responsabile non creato', name: raw, note: 'non esiste tra i dipendenti e non è stato creato' });

    return {
      inserted, skipped, errors, warnings, issues,
      detail: `Nuovi: ${inserted} · già presenti e aggiornati: ${updated}${createdChiefs ? ` · responsabili creati: ${createdChiefs} (controlla la data di assunzione)` : ''}.`,
    };
  }

  return (
    <div className="space-y-4" onClick={() => { if (tagMenuFor !== null) setTagMenuFor(null); if (showMore) setShowMore(false); }}>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-medium text-gray-900">Dipendenti</h1>
          {!loading && (
            <span className="text-sm font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-3 py-1">
              {visible.length} {visible.length === 1 ? 'dipendente selezionato' : 'dipendenti selezionati'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
        {manage && (
          <>
            <button onClick={openMatricole} className="btn-secondary text-sm">Prossima matricola</button>
            <button onClick={() => setShowTags(true)} className="btn-secondary text-sm">Etichette</button>
            <button onClick={() => setShowNew(true)} className="btn-primary text-sm">+ Nuovo dipendente</button>
          </>
        )}
          <div className="relative">
            <button
              type="button" aria-haspopup="menu" aria-expanded={showMore} title="Altre azioni"
              onClick={ev => { ev.stopPropagation(); setShowMore(v => !v); }}
              className="btn-secondary text-sm flex items-center gap-1"
            >
              Altro
              <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" /></svg>
            </button>
            {showMore && (
              <div role="menu" className="absolute right-0 top-full mt-1 z-30 w-72 bg-white border border-gray-200 rounded-lg shadow-lg py-1 text-sm">
                <button type="button" role="menuitem" disabled={loading || visible.length === 0}
                  onClick={() => { setShowMore(false); exportExcel(); }}
                  className="w-full text-left px-3 py-1.5 hover:bg-gray-50 disabled:text-gray-300 disabled:hover:bg-transparent">Esporta Excel</button>
                {manage && (
                  <>
                    <button type="button" role="menuitem"
                      title={`Da Excel: File → Salva con nome → CSV UTF-8. Colonne attese: ${IMPORT_COLUMNS.join(', ')}`}
                      onClick={() => { setShowMore(false); importRef.current?.open('storico'); }}
                      className="w-full text-left px-3 py-1.5 hover:bg-gray-50">
                      Importa da Excel — registra i cambiamenti
                    </button>
                    <button type="button" role="menuitem"
                      title={`Da Excel: File → Salva con nome → CSV UTF-8. Colonne attese: ${IMPORT_COLUMNS.join(', ')}`}
                      onClick={() => { setShowMore(false); importRef.current?.open('sostituisci'); }}
                      className="w-full text-left px-3 py-1.5 hover:bg-gray-50">
                      Importa da Excel — sostituisci tutto
                    </button>
                    <button type="button" role="menuitem"
                      title="Elenco dipendenti di Osti (CSV): abbina per cognome e nome (o Nome Osti) e aggiorna le schede"
                      onClick={() => { setShowMore(false); importRef.current?.open('osti'); }}
                      className="w-full text-left px-3 py-1.5 hover:bg-gray-50">
                      Importa elenco Osti (CSV)
                    </button>
                    <button type="button" role="menuitem"
                      onClick={() => { setShowMore(false); router.push('/hr/dipendenti/foto-massiva'); }}
                      className="w-full text-left px-3 py-1.5 hover:bg-gray-50">Carica foto</button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {manage && <ImportExcelButton ref={importRef} hideButton columns={IMPORT_COLUMNS} processRows={importRows} onDone={load} />}

      <div className="card p-0 overflow-hidden">
        <div className={`flex items-center justify-between px-4 py-2.5 bg-gray-50 ${showFilters ? 'border-b border-gray-100' : ''}`}>
          <button type="button" onClick={() => setShowFilters(v => !v)} aria-expanded={showFilters}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-500 uppercase tracking-wide hover:text-gray-700">
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M3 4a1 1 0 011-1h12a1 1 0 01.8 1.6L12 11v5a1 1 0 01-1.45.9l-2-1A1 1 0 018 15v-4L3.2 4.6A1 1 0 013 4z" /></svg>
            Filtri
            {hasFilters && <span className="w-1.5 h-1.5 rounded-full bg-blue-500" title="Filtri attivi" />}
            <svg className={`w-3 h-3 transition-transform ${showFilters ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor"><path d="M5.3 7.3a1 1 0 011.4 0L10 10.6l3.3-3.3a1 1 0 111.4 1.4l-4 4a1 1 0 01-1.4 0l-4-4a1 1 0 010-1.4z" /></svg>
          </button>
          {hasFilters && (
            <button onClick={resetFilters} className="text-xs text-gray-400 hover:text-gray-600">Pulisci filtri</button>
          )}
        </div>
        {showFilters && (
        <>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 px-4 py-3">
          <input value={fNominativo} onChange={e => setFNominativo(e.target.value)} placeholder="Nome e cognome" className="input text-sm min-w-0" />
          <input value={fMatricola} onChange={e => setFMatricola(e.target.value)} placeholder="Matricola" className="input text-sm min-w-0" />
          <select value={fSesso} onChange={e => setFSesso(e.target.value)} className={`input text-sm min-w-0 ${fSesso ? '' : 'text-gray-400'}`}>
            <option value="">Sesso</option>
            {(sessoDisponibili.has('M') || fSesso === 'M') && <option value="M" className="text-gray-900">M</option>}
            {(sessoDisponibili.has('F') || fSesso === 'F') && <option value="F" className="text-gray-900">F</option>}
          </select>
          <select value={fCategoria} onChange={e => setFCategoria(e.target.value)} className={`input text-sm min-w-0 ${fCategoria ? '' : 'text-gray-400'}`}>
            <option value="">Categoria</option>
            {categorie.map(c => <option key={c} value={c} className="text-gray-900">{c}</option>)}
          </select>
          <select value={societaFilter} onChange={e => setSocietaFilter(e.target.value ? Number(e.target.value) : '')} className={`input text-sm min-w-0 ${societaFilter ? '' : 'text-gray-400'}`}>
            <option value="">Società contratto</option>
            {companiesShown.map(c => <option key={c.id} value={c.id} className="text-gray-900">{c.name}</option>)}
          </select>
          <select value={fNazionalita} onChange={e => setFNazionalita(e.target.value)} className={`input text-sm min-w-0 ${fNazionalita ? '' : 'text-gray-400'}`}>
            <option value="">Nazionalità</option>
            {nazionalita.map(v => <option key={v} value={v} className="text-gray-900">{v}</option>)}
          </select>
          <select value={funzioneFilter} onChange={e => setFunzioneFilter(e.target.value)} className={`input text-sm min-w-0 ${funzioneFilter ? '' : 'text-gray-400'}`}>
            <option value="">Funzione</option>
            {funzioni.map(f => <option key={f} value={f} className="text-gray-900">{f}</option>)}
          </select>
          <select value={repartoFilter} onChange={e => setRepartoFilter(e.target.value ? Number(e.target.value) : '')} className={`input text-sm min-w-0 ${repartoFilter ? '' : 'text-gray-400'}`}>
            <option value="">Reparto</option>
            {departmentsShown.map(d => <option key={d.id} value={d.id} className="text-gray-900">{d.name}</option>)}
          </select>
          <select value={plantFilter} onChange={e => setPlantFilter(e.target.value ? Number(e.target.value) : '')} className={`input text-sm min-w-0 ${plantFilter ? '' : 'text-gray-400'}`}>
            <option value="">Plant</option>
            {plantsShown.map(p => <option key={p.id} value={p.id} className="text-gray-900">{p.name}</option>)}
          </select>
          <select value={fMansione} onChange={e => setFMansione(e.target.value)} className={`input text-sm min-w-0 ${fMansione ? '' : 'text-gray-400'}`}>
            <option value="">Mansione</option>
            {mansioni.map(v => <option key={v} value={v} className="text-gray-900">{v}</option>)}
          </select>
          <select value={fLivello} onChange={e => setFLivello(e.target.value)} className={`input text-sm min-w-0 ${fLivello ? '' : 'text-gray-400'}`}>
            <option value="">Livello</option>
            {livelli.map(v => <option key={v} value={v} className="text-gray-900">{v}</option>)}
          </select>
          <select value={fResp} onChange={e => setFResp(e.target.value)} className={`input text-sm min-w-0 ${fResp ? '' : 'text-gray-400'}`}>
            <option value="">Responsabile</option>
            {responsabili.map(v => <option key={v} value={v} className="text-gray-900">{v}</option>)}
          </select>
          <select value={fTipoContratto} onChange={e => setFTipoContratto(e.target.value)} className={`input text-sm min-w-0 ${fTipoContratto ? '' : 'text-gray-400'}`}>
            <option value="">Tipo contratto</option>
            {tipiContratto.map(t => <option key={t} value={t} className="text-gray-900">{t}</option>)}
          </select>
          <select value={tagFilter} onChange={e => setTagFilter(e.target.value ? Number(e.target.value) : '')} className={`input text-sm min-w-0 ${tagFilter ? '' : 'text-gray-400'}`}>
            <option value="">Etichetta</option>
            {tagsShown.map(t => <option key={t.id} value={t.id} className="text-gray-900">{t.name}</option>)}
          </select>
          <select value={inProvaFilter} onChange={e => setInProvaFilter(e.target.value as '' | 'si' | 'no')} className={`input text-sm min-w-0 ${inProvaFilter ? '' : 'text-gray-400'}`}>
            <option value="">In prova</option>
            {(provaSi || inProvaFilter === 'si') && <option value="si" className="text-gray-900">Sì</option>}
            {(provaNo || inProvaFilter === 'no') && <option value="no" className="text-gray-900">No</option>}
          </select>
          <select value={avvisoFilter} onChange={e => setAvvisoFilter(e.target.value as '' | 'si' | 'no')} className={`input text-sm min-w-0 ${avvisoFilter ? '' : 'text-gray-400'}`}>
            <option value="">Errori import</option>
            {(avvisoSi || avvisoFilter === 'si') && <option value="si" className="text-gray-900">Con errori</option>}
            {(avvisoNo || avvisoFilter === 'no') && <option value="no" className="text-gray-900">Senza errori</option>}
          </select>
          <select value={statoFilter} onChange={e => setStatoFilter(e.target.value)} className={`input text-sm min-w-0 ${statoFilter ? '' : 'text-gray-400'}`}>
            <option value="">Stato</option>
            {statiShown.map(o => <option key={o.value} value={o.value} className="text-gray-900">{o.label}</option>)}
          </select>
          {showExtraFilters && (
            <>
              <input value={fEmail} onChange={e => setFEmail(e.target.value)} placeholder="Email" className="input text-sm min-w-0" />
              <input value={fIndirizzo} onChange={e => setFIndirizzo(e.target.value)} placeholder="Indirizzo" className="input text-sm min-w-0" />
              <input value={fCitta} onChange={e => setFCitta(e.target.value)} placeholder="Città" className="input text-sm min-w-0" />
              <select value={fProv} onChange={e => setFProv(e.target.value)} className={`input text-sm min-w-0 ${fProv ? '' : 'text-gray-400'}`}>
                <option value="">Provincia</option>
                {province.map(v => <option key={v} value={v} className="text-gray-900">{v}</option>)}
              </select>
              <input value={fCap} onChange={e => setFCap(e.target.value)} placeholder="CAP" className="input text-sm min-w-0" />
              <select value={fGruppo} onChange={e => setFGruppo(e.target.value)} className={`input text-sm min-w-0 ${fGruppo ? '' : 'text-gray-400'}`}>
                <option value="">Gruppo orario</option>
                {gruppiOrari.map(v => <option key={v} value={v} className="text-gray-900">{v}</option>)}
              </select>
              <input value={fNomeOsti} onChange={e => setFNomeOsti(e.target.value)} placeholder="Nome Osti" className="input text-sm min-w-0" />
              <div className="col-span-2 flex items-center gap-1 min-w-0">
                <span className="text-xs text-gray-400 shrink-0 w-16">Compleanno</span>
                <select value={fGiorno} onChange={e => setFGiorno(e.target.value)} title="Giorno" className={`input text-sm min-w-0 ${fGiorno ? '' : 'text-gray-400'}`}>
                  <option value="">Giorno</option>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map(d => <option key={d} value={d} className="text-gray-900">{d}</option>)}
                </select>
                <select value={fMese} onChange={e => setFMese(e.target.value)} title="Mese" className={`input text-sm min-w-0 ${fMese ? '' : 'text-gray-400'}`}>
                  <option value="">Mese</option>
                  {['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']
                    .map((m, i) => <option key={m} value={i + 1} className="text-gray-900">{m}</option>)}
                </select>
              </div>
              {([
                ['Data nascita', fNascitaDa, setFNascitaDa, fNascitaA, setFNascitaA],
                ['Assunzione', fAssunzioneDa, setFAssunzioneDa, fAssunzioneA, setFAssunzioneA],
                ['Cessazione', fCessazioneDa, setFCessazioneDa, fCessazioneA, setFCessazioneA],
              ] as [string, string, (v: string) => void, string, (v: string) => void][]).map(([label, da, setDa, a, setA]) => (
                <div key={label} className="col-span-2 flex items-center gap-1 min-w-0">
                  <span className="text-xs text-gray-400 shrink-0 w-16">{label}</span>
                  <input type="date" value={da} onChange={e => setDa(e.target.value)} title={`${label}: dal`} className="input text-sm min-w-0" />
                  <span className="text-xs text-gray-400">→</span>
                  <input type="date" value={a} onChange={e => setA(e.target.value)} title={`${label}: al`} className="input text-sm min-w-0" />
                </div>
              ))}
            </>
          )}
        </div>
        <div className="flex justify-end px-4 pb-2 -mt-1">
          <button type="button" onClick={() => setShowExtraFilters(v => !v)} aria-expanded={showExtraFilters}
            className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1">
            {showExtraFilters ? 'Mostra meno filtri' : `Mostra più filtri${extraCount ? ` (${extraCount} attivi)` : ''}`}
            <svg className={`w-3 h-3 transition-transform ${showExtraFilters ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor"><path d="M5.3 7.3a1 1 0 011.4 0L10 10.6l3.3-3.3a1 1 0 111.4 1.4l-4 4a1 1 0 01-1.4 0l-4-4a1 1 0 010-1.4z" /></svg>
          </button>
        </div>
        </>
        )}
      </div>

      <div ref={tableRef} className="card p-0 overflow-hidden">
        <div ref={headerScrollRef} className="overflow-x-hidden">
          <div className="grid gap-x-3 px-4 py-2.5 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-400 uppercase tracking-wide"
            style={{ gridTemplateColumns: gridCols(showWarnCol), minWidth: TABLE_MIN_WIDTH }}>
            {showWarnCol && <div />}
            <div />
            <div>Cognome</div><div>Nome</div><div>Matricola</div><div>Sesso</div><div>Categoria</div>
            <div>Società</div><div>Nazionalità</div>
            <div>Data nascita</div><div>Email</div><div>Indirizzo</div><div>Città</div><div>Prov.</div><div>CAP</div>
            <div>Funzione</div><div>Reparto</div><div>Plant</div>
            <div>Mansione</div><div>Livello</div><div>Responsabile</div><div>Tipo contratto</div><div>Gruppo orario</div><div>Nome Osti</div>
            <div>Assunzione</div><div>Cessazione</div><div className="text-center">Prova</div>
            <div className="text-center">Stato</div>
          </div>
        </div>
        <div ref={bodyScrollRef} onScroll={syncHeaderScroll} className="hr-table-scroll overflow-auto" style={{ maxHeight: bodyMaxHeight }}>
        <div style={{ minWidth: TABLE_MIN_WIDTH }}>
          {loading ? (
            <p className="text-sm text-gray-400 text-center py-12">Caricamento…</p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-12">Nessun dipendente trovato</p>
          ) : visible.map(e => (
            // Riga cliccabile ma NON un <a>: dentro un link il browser trascina invece di selezionare il testo,
            // e il copia/incolla dalla tabella non funziona. Se c'è testo selezionato, il click non apre la scheda.
            <div key={e.id} role="link" tabIndex={0}
              onClick={ev => {
                if (window.getSelection()?.toString()) return;
                const href = `/hr/dipendenti/${e.id}`;
                if (ev.ctrlKey || ev.metaKey) window.open(href, '_blank'); else router.push(href);
              }}
              onKeyDown={ev => { if (ev.key === 'Enter') router.push(`/hr/dipendenti/${e.id}`); }}
              className="relative z-0 grid gap-x-3 px-4 py-3 border-b border-gray-50 last:border-b-0 bg-white hover:bg-gray-50 transition-colors items-center cursor-pointer select-text"
              style={{ gridTemplateColumns: gridCols(showWarnCol) }}
            >
              {showWarnCol && (
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
              )}
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
              <div className="text-sm text-gray-600 truncate">{e.data_nascita?.slice(0, 10) ?? '—'}</div>
              <div className="text-sm text-gray-600 truncate" title={e.email ?? undefined}>{e.email ?? '—'}</div>
              <div className="text-sm text-gray-600 truncate" title={e.indirizzo ?? undefined}>{e.indirizzo ?? '—'}</div>
              <div className="text-sm text-gray-600 truncate">{e.citta ?? '—'}</div>
              <div className="text-sm text-gray-600 truncate">{e.provincia ?? '—'}</div>
              <div className="text-sm text-gray-600 truncate">{e.cap ?? '—'}</div>
              <div className="text-sm text-gray-600 truncate">{e.funzione_aziendale ?? '—'}</div>
              <div className="text-sm text-gray-600 truncate">{e.reparto_name ?? '—'}</div>
              <div className="text-sm text-gray-600 truncate">{e.plant_name ?? '—'}</div>
              <div className="text-sm text-gray-600 truncate">{e.mansione ?? '—'}</div>
              <div className="text-sm text-gray-600 truncate">{e.livello ?? '—'}</div>
              <div className="text-sm text-gray-600 truncate">{e.capo_nome ?? '—'}</div>
              <div className="text-sm text-gray-600 truncate">{e.tipo_contratto ?? '—'}</div>
              <div className="text-sm text-gray-600 truncate">{e.gruppo_orario ?? '—'}</div>
              <div className="text-sm text-gray-600 truncate" title={e.nome_osti ?? undefined}>{e.nome_osti ?? '—'}</div>
              <div className="text-sm text-gray-600 truncate">{e.data_assunzione?.slice(0, 10) ?? '—'}</div>
              <div className="text-sm text-gray-600 truncate">{e.data_cessazione?.slice(0, 10) ?? '—'}</div>
              <div className="text-center text-sm text-gray-600">{e.in_prova ? 'Sì' : '—'}</div>
              <div className="text-center">
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${STATO_COLOR[e.stato]}`}>{STATO_LABEL[e.stato]}</span>
              </div>
            </div>
          ))}
        </div>
        </div>
      </div>

      {promptDialog}
      {choiceDialog}
      {confirmDialog}

      {showMatricole && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setShowMatricole(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={ev => ev.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <h2 className="text-base font-medium text-gray-900">Prossima matricola</h2>
              <button onClick={() => setShowMatricole(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
            </div>
            <div className="overflow-auto px-5 py-3">
              {!matricoleBands ? (
                <p className="text-sm text-gray-400 py-6 text-center">Caricamento…</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 uppercase tracking-wide text-left">
                      <th className="py-1.5 font-medium">Fascia</th>
                      <th className="py-1.5 font-medium">Ultima usata</th>
                      <th className="py-1.5 font-medium">Prossima</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matricoleBands.map(b => (
                      <tr key={b.label} className="border-t border-gray-50">
                        <td className="py-2 text-gray-600"><span className="font-medium text-gray-800">{b.label}</span> <span className="text-gray-400">{b.from} – {b.to}</span></td>
                        <td className="py-2 text-gray-600">{b.last ?? '—'}</td>
                        <td className="py-2">
                          {b.next === null
                            ? <span className="text-xs text-red-600">fascia esaurita</span>
                            : <span className="font-semibold text-gray-900">{b.next}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="text-xs text-gray-400 mt-3">Calcolata sull&apos;ultima matricola numerica di ogni plant, includendo i dipendenti cessati.</p>
            </div>
          </div>
        </div>
      )}

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
