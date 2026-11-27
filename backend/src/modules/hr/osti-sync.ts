import { db } from '../../db/client.js';
import { auditLog } from '../../lib/audit.js';
import { logger } from '../../lib/logger.js';
import { readOstiEmployees, type OstiRow } from './osti.js';
import { applyEmployeeUpdate, type UpdateActor } from './employee-update.js';
import { registraContratto } from './contracts.js';

// Sincronizzazione automatica dell'elenco dipendenti da Osti (ogni ora, vedi scheduler.ts).
// Stessa logica del pulsante «Sincronizza con Osti» della pagina Dipendenti (frontend/…/ostiImport.ts),
// ma senza domande all'utente: si aggiornano solo le persone abbinate in modo sicuro (nome, «Nome Osti»
// o matricola). Chi non si abbina, i nomi ambigui e i reparti/plant/società che da noi non esistono
// NON si creano: si contano nell'esito e restano da gestire a mano dal pulsante.
// Osti non è mai la fonte per svuotare un campo: un valore vuoto in Osti non cancella nulla.

const ACTOR: UpdateActor = { id: null, display_name: 'Sync automatica Osti' };

type Row = OstiRow;

const FIELD_LABEL: Record<string, string> = {
  nome_osti: 'Nome Osti', matricola: 'Matricola', data_assunzione: 'Data assunzione', data_cessazione: 'Data cessazione',
  mansione: 'Mansione', livello: 'Livello', stato: 'Stato', nazionalita: 'Nazionalità', tipo_nazionalita: 'Extra UE / Italia', indirizzo: 'Indirizzo', citta: 'Città',
  provincia: 'Provincia', cap: 'CAP', data_nascita: 'Data di nascita', sesso: 'Sesso', codice_fiscale: 'Codice fiscale',
  telefono: 'Telefono', note: 'Note', email: 'Email', reparto_id: 'Reparto', plant_ids: 'Plant', contract_company_id: 'Società contratto', tipo_contratto: 'Tipo contratto', gruppo_orario: 'Gruppo orario',
  badge: 'Badge', transponder: 'Transponder', terminale: 'Terminale', qualifica: 'Qualifica',
  indeterminato: 'Tempo indeterminato', indeterminato_data: 'Data indeterminato', part_time: 'Part-time',
  luogo_nascita: 'Luogo di nascita', domicilio_indirizzo: 'Domicilio', domicilio_citta: 'Città domicilio',
  domicilio_provincia: 'Provincia domicilio', domicilio_cap: 'CAP domicilio', stato_civile: 'Stato civile', note_hr: 'Note HR',
};

// Chiave di confronto: senza maiuscole, accenti, apostrofi tipografici e spazi doppi
const norm = (s: string | null | undefined) => (s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[’`´]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();

// gg/mm/aaaa → YYYY-MM-DD; "0000-00-00" (data assente in Osti) e valori non validi → null
function ostiDate(s: string | undefined): string | null {
  const m = (s ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m || m[3] === '0000') return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// Le matricole di Osti hanno gli zeri davanti (000123): da noi si scrivono senza (123)
const noLeadingZeros = (s: string | undefined | null) => (s ?? '').trim().replace(/^0+/, '');
const matKey = (s: string | null | undefined) => noLeadingZeros(norm(s));

// "Extra UE / Italia" dal paese della nazionalità di Osti. Doppia nazionalità: vale quella italiana/UE.
const UE_RE = /^(rum$|rom$|romen|rumen|romania|rumania|polac|polon|bulgar|spagnol|spagna|frances|francia|tedesc|german|croat|portoghes|portogallo|grec|ungher|cec[ao]$|repubblica ceca|slovacc|sloven|litu|letton|eston|finland|svedes|svezia|danes|danimarca|olandes|paesi bassi|belg|austria|irlandes|irlanda|maltes|malta|cipri|lussemburg)/;
const TIPI_NAZIONALITA = new Set(['ITALIANO', 'UE', 'EXTRA UE']);
function tipoNazionalita(s: string | undefined): string | null {
  const v = norm(s);
  if (!v || v === '-') return null;
  const parts = v.split(/\s*[/,;]\s*|\s+e\s+/);
  if (parts.some(p => /^ital/.test(p))) return 'ITALIANO';
  return parts.some(p => UE_RE.test(p)) ? 'UE' : 'EXTRA UE';
}

const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

// Codici numerici di Osti (badge, terminale…): vuoto, 0 e "-" significano "nessuno"
const positive = (s: string | undefined) => { const v = clean(s); return v && v !== '0' && v !== '-' ? v : null; };

// Una persona può avere più righe in Osti con nomi diversi: "Nome Osti" ricorda tutti i nomi collegati, separati da " | "
const NOMI_SEP = ' | ';
const ostiNames = (s: string | null | undefined) => (s ?? '').split(NOMI_SEP).filter(x => x.trim());
function mergeOstiName(current: string | null | undefined, name: string): string {
  const names = ostiNames(current);
  if (!name.trim()) return names.join(NOMI_SEP);
  if (names.some(n => norm(n) === norm(name))) return names.map(n => norm(n) === norm(name) ? name : n).join(NOMI_SEP);
  const merged = [...names, name].join(NOMI_SEP);
  return merged.length <= 200 ? merged : name;
}

// Plant: dalla filiale di Osti si usa solo la sigla iniziale (STR1…STR5, anche "STR 1")
const plantOf = (r: Row) => { const m = clean(r.filiale).toUpperCase().match(/^STR\s*([1-5])(?!\d)/); return m ? `STR${m[1]}` : ''; };
// "REPARTO VERNICIATURA" in Osti = "VERNICIATURA" da noi
const repartoOf = (r: Row) => clean(r.reparto).replace(/^reparto\s+/i, '');

// Tipo contratto dalla ditta di Osti: STR → INDETERMINATO/DETERMINATO, GMG → ESTERNO, altre ditte → INTERINALE
function tipoContratto(r: Row): string | null {
  const ditta = norm(clean(r.ditta));
  if (!ditta) return null;
  if (ditta.startsWith('str')) return r.dip_indeterminato === '1' ? 'INDETERMINATO' : r.dip_indeterminato === '0' ? 'DETERMINATO' : null;
  return ditta.startsWith('gmg') ? 'ESTERNO' : 'INTERINALE';
}

// Scheda dipendente com'è nel database (date come testo aaaa-mm-gg)
interface Emp {
  id: number; nome: string; cognome: string; stato: string;
  matricola: string | null; nome_osti: string | null;
  reparto_id: number | null; contract_company_id: number | null; plant_ids: number[] | null;
  [k: string]: unknown;
}

interface Ctx {
  today: string;
  deptByName: Map<string, number>; deptName: Map<number, string>;
  plantByName: Map<string, number>; plantName: Map<number, string>;
  companyByName: Map<string, number>; companyName: Map<number, string>;
  matricolaOwner: Map<string, number[]>;   // matricola (senza zeri) → schede che la hanno
  matricolaOf: Map<number, string>;        // scheda → matricola com'è salvata
  claimed: Set<string>;                    // matricole già assegnate in questo giro
}

interface Plan {
  emp: Emp;
  fill: Record<string, unknown>;                              // campi vuoti nella scheda: scrittura silenziosa
  change: Record<string, unknown>;                            // campi con valore diverso: cambio registrato
  changes: { field: string; from: string; to: string }[];
  cessa: boolean;
  riassunta: string | null;
  takeFrom: number[];                                         // schede a cui si toglie la matricola (stesso numero)
}

// Tra più righe Osti per la stessa persona vale quella in corso; a parità, l'assunzione più recente.
function pickBest(rows: Row[], today: string): Row {
  const inCorso = (r: Row) => { const d = ostiDate(r.dip_licenziato); return !d || d > today; };
  return [...rows].sort((a, b) =>
    Number(inCorso(b)) - Number(inCorso(a)) || (ostiDate(b.dip_assunto) ?? '').localeCompare(ostiDate(a.dip_assunto) ?? ''))[0];
}

interface ContrattoOsti { matricola: string | null; qualifica: string | null; tipo: 'STR' | 'INTERINALE' | 'ESTERNO' | null; inizio: string; fine: string | null }
export function contrattiOf(list: Row[]): ContrattoOsti[] {
  const seen = new Set<string>();
  const out: ContrattoOsti[] = [];
  for (const r of list) {
    const inizio = ostiDate(r.dip_assunto);
    if (!inizio) continue;
    let fine = ostiDate(r.dip_licenziato);
    if (fine && fine < inizio) fine = null;
    const k = `${inizio}|${fine ?? ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const ditta = norm(clean(r.ditta));
    const tipo = !ditta ? null : ditta.startsWith('str') ? 'STR' : ditta.startsWith('gmg') ? 'ESTERNO' : 'INTERINALE';
    out.push({ matricola: clean(r.dip_matricola) || null, qualifica: clean(r.dip_qualifica) || null, tipo, inizio, fine });
  }
  return out.sort((a, b) => a.inizio.localeCompare(b.inizio));
}

// Valori che Osti propone per una persona, già puliti. Valore assente = null (non tocca nulla).
function wantOf(r: Row, ctx: Ctx): Record<string, string | number | boolean | number[] | null> {
  const email = clean(r.dip_email);
  const sesso = clean(r.dip_sesso).toUpperCase();
  const matricola = noLeadingZeros(r.dip_matricola);
  const livello = clean(r.dip_livello);
  const plantId = ctx.plantByName.get(norm(plantOf(r)));
  return {
    nome_osti: r.dip_nome ?? '',
    matricola: matricola && matricola !== '0' ? matricola : null,
    data_assunzione: ostiDate(r.dip_assunto),
    data_cessazione: ostiDate(r.dip_licenziato),
    mansione: clean(r.dip_mansione) || null,
    livello: livello && livello !== '-' && livello !== '0' ? livello : null,
    nazionalita: clean(r.dip_nazione) || null,
    tipo_nazionalita: tipoNazionalita(r.dip_nazione),
    indirizzo: clean(r.dip_indirizzo) || null,
    citta: clean(r.dip_citta) || null,
    provincia: clean(r.dip_prov).toUpperCase() || null,
    cap: clean(r.dip_cap) || null,
    data_nascita: ostiDate(r.dip_nato_data),
    sesso: sesso === 'M' || sesso === 'F' ? sesso : null,
    codice_fiscale: clean(r.dip_cf).replace(/\s+/g, '').toUpperCase() || null,
    telefono: clean(r.dip_cellulare) || null,
    note: (r.dip_note ?? '').trim() || null,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
    reparto_id: ctx.deptByName.get(norm(repartoOf(r))) ?? null,
    plant_ids: plantId != null ? [plantId] : null,
    contract_company_id: ctx.companyByName.get(norm(clean(r.ditta))) ?? null,
    tipo_contratto: tipoContratto(r),
    gruppo_orario: clean(r.gruppo_orario) || null,
    badge: positive(r.dip_badge),
    transponder: positive(r.dip_transponder),
    terminale: positive(r.dip_terminale),
    qualifica: clean(r.dip_qualifica) || null,
    indeterminato: r.dip_indeterminato === '1' ? true : r.dip_indeterminato === '0' ? false : null,
    indeterminato_data: ostiDate(r.dip_indeterminato_data),
    part_time: r.dip_partime === '1' ? 'Sì' : null,
    luogo_nascita: clean(r.dip_nato_luogo) || null,
    domicilio_indirizzo: clean(r.dip_domicilio_indirizzo) || null,
    domicilio_citta: clean(r.dip_domicilio_citta) || null,
    domicilio_provincia: clean(r.dip_domicilio_prov).toUpperCase() || null,
    domicilio_cap: clean(r.dip_domicilio_cap) || null,
    stato_civile: clean(r.dip_statocivile) === '-' ? null : clean(r.dip_statocivile) || null,
    note_hr: (r.dip_note_hr ?? '').trim() || null,
  };
}

// Confronta la scheda con quanto propone Osti e dice cosa scrivere
export function buildPlan(emp: Emp, r: Row, ctx: Ctx): { plan: Plan | null; conflict: boolean } {
  const want = wantOf(r, ctx);
  want.nome_osti = mergeOstiName(emp.nome_osti, r.dip_nome ?? '');
  const licenziato = ostiDate(r.dip_licenziato);
  const have = (f: string): string => {
    const v = emp[f];
    if (v == null || v === '') return '';
    if (f === 'nazionalita' && TIPI_NAZIONALITA.has(String(v).trim().toUpperCase())) return '';   // vecchia categoria
    if (f === 'reparto_id') return ctx.deptName.get(v as number) ?? '';
    if (f === 'contract_company_id') return ctx.companyName.get(v as number) ?? '';
    if (f === 'plant_ids') return (v as number[]).map(id => ctx.plantName.get(id) ?? '').filter(Boolean).join(', ');
    if (f.startsWith('data_')) return String(v).slice(0, 10);
    return String(v);
  };
  const show = (f: string, v: string | number | boolean | number[]) =>
    f === 'reparto_id' ? ctx.deptName.get(v as number) ?? ''
    : f === 'contract_company_id' ? ctx.companyName.get(v as number) ?? ''
    : f === 'plant_ids' ? (v as number[]).map(id => ctx.plantName.get(id) ?? '').join(', ')
    : String(v);

  const plan: Plan = { emp, fill: {}, change: {}, changes: [], cessa: false, riassunta: null, takeFrom: [] };
  let conflict = false;
  for (const [f, v] of Object.entries(want)) {
    if (v == null) continue;
    const cur = have(f);
    if (f === 'nome_osti' ? cur === v : cur !== '' && norm(cur) === norm(show(f, v))) continue;
    if (f === 'matricola') {
      // La matricola di Osti vince: se un'altra scheda ha lo stesso numero la perde (resta traccia nella sua timeline)
      const key = matKey(String(v));
      if (ctx.claimed.has(key)) { conflict = true; continue; }
      ctx.claimed.add(key);
      plan.takeFrom = (ctx.matricolaOwner.get(key) ?? []).filter(id => id !== emp.id);
      if (cur === '' || noLeadingZeros(cur) === String(v)) plan.fill.matricola = v;   // solo gli zeri davanti: in silenzio
      else { plan.change.matricola = v; plan.changes.push({ field: f, from: cur, to: String(v) }); }
      continue;
    }
    if (f === 'nome_osti') { plan.fill[f] = v; continue; }
    if (cur === '') plan.fill[f] = v;
    else { plan.change[f] = v; plan.changes.push({ field: f, from: cur, to: show(f, v) }); }
  }
  // Cessazione già trascorsa: la persona risulta cessata. Una data futura è solo la fine del contratto.
  if (licenziato && licenziato <= ctx.today && emp.stato !== 'cessato') {
    plan.cessa = true;
    plan.change.stato = 'cessato';
    plan.change.data_cessazione = licenziato;
    delete plan.fill.data_cessazione;
  }
  // Riga in corso in Osti: chi da noi risultava cessato è stato riassunto, torna attivo (evento «assunzione»)
  if ((!licenziato || licenziato > ctx.today) && emp.stato === 'cessato') {
    plan.change.stato = 'attivo';
    if (licenziato) plan.change.data_cessazione = licenziato;
    plan.changes.push({ field: 'stato', from: 'cessato', to: 'attivo' });
    plan.riassunta = ostiDate(r.dip_assunto) ?? ctx.today;
    delete plan.fill.data_cessazione;
  }
  // Riga in corso in Osti ma da noi una data di cessazione già trascorsa (contratto rinnovato, data vecchia rimasta):
  // senza toglierla, il job di cessazione automatica rimetterebbe la persona a «cessato».
  const vecchia = have('data_cessazione');
  if (!licenziato && vecchia && vecchia <= ctx.today && emp.stato !== 'cessato') {
    plan.change.data_cessazione = null;
    plan.changes.push({ field: 'data_cessazione', from: vecchia, to: '—' });
  }
  const empty = !Object.keys(plan.fill).length && !Object.keys(plan.change).length;
  if (empty) plan.takeFrom = [];
  return { plan: empty ? null : plan, conflict };
}

// Date ISO (aaaa-mm-gg) → gg/mm/aaaa nelle note della timeline
const dataIt = (v: string) => v.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2/$1');

// reparto, mansione e livello hanno già il loro evento automatico (employee-update.ts)
const AUTO_EVENT = new Set(['livello', 'mansione', 'reparto_id']);

async function addEvent(employeeId: number, ev: { event_type: string; event_date: string; note: string }): Promise<void> {
  await db`
    INSERT INTO hr_employee_event ${db({ employee_id: employeeId, ...ev, created_by_user_id: ACTOR.id, created_by_name: ACTOR.display_name })}`;
}

async function applyPlan(p: Plan, ctx: Ctx): Promise<void> {
  const setMatricola = async (id: number, value: string | null) => {
    const [existing] = await db`SELECT id, matricola FROM hr_employee WHERE id = ${id}`;
    if (existing) await applyEmployeeUpdate(id, existing, { matricola: value }, { silent: true, actor: ACTOR });
  };
  const load = async () => (await db`SELECT id, reparto_id, mansione, livello, capo_id, stato, data_cessazione FROM hr_employee WHERE id = ${p.emp.id}`)[0];
  const taken: { id: number; old: string }[] = [];
  try {
    for (const id of p.takeFrom) {
      const old = ctx.matricolaOf.get(id);
      if (old == null) continue;
      await setMatricola(id, null);
      taken.push({ id, old });
    }
    if (Object.keys(p.fill).length) await applyEmployeeUpdate(p.emp.id, await load(), { ...p.fill }, { silent: true, actor: ACTOR });
    if (Object.keys(p.change).length) {
      await applyEmployeeUpdate(p.emp.id, await load(), { ...p.change }, { silent: false, actor: ACTOR });
      const manual = p.changes.filter(c => !AUTO_EVENT.has(c.field) && !(p.cessa && c.field === 'data_cessazione'));
      if (manual.length) {
        await addEvent(p.emp.id, {
          event_type: 'altro', event_date: ctx.today,
          note: 'Sync Osti — ' + manual.map(c => `${FIELD_LABEL[c.field] ?? c.field}: «${dataIt(c.from)}» → «${dataIt(c.to)}»`).join('; '),
        });
      }
    }
    if (p.riassunta) await addEvent(p.emp.id, { event_type: 'assunzione', event_date: p.riassunta, note: 'Riassunzione — sync Osti' });
  } catch (err) {
    for (const t of taken) await setMatricola(t.id, t.old).catch(() => { /* il log dell'errore sta sotto */ });   // le altre schede riprendono la loro matricola
    throw err;
  }
  for (const t of taken) {
    await addEvent(t.id, { event_type: 'altro', event_date: ctx.today, note: `Sync Osti — Matricola «${t.old}» tolta: in Osti è di ${p.emp.cognome} ${p.emp.nome}` });
    ctx.matricolaOf.delete(t.id);
  }
}

export interface OstiSyncResult {
  updated: number; unmatched: number; ambiguous: number; errors: number;
  contracts: number; missing: number; total: number;
  detail: string;
}

let running = false;
export const isOstiSyncRunning = () => running;

export async function runOstiSync(): Promise<OstiSyncResult> {
  if (running) throw new Error('Sync Osti già in corso');
  running = true;
  try {
    const rows = await readOstiEmployees();
    if (!rows.some(r => 'dip_nome' in r)) throw new Error('Risposta di Osti non riconosciuta: manca dip_nome');
    return await applyRows(rows);
  } finally {
    running = false;
  }
}

/** Parte testabile: applica a DB le righe di Osti già lette. */
export async function applyRows(rows: Row[]): Promise<OstiSyncResult> {
  const today = new Date().toISOString().slice(0, 10);
  const employees = await db<Emp[]>`
    SELECT id, nome, cognome, stato, matricola, nome_osti, reparto_id, contract_company_id, plant_ids,
           mansione, livello, nazionalita, tipo_nazionalita, indirizzo, citta, provincia, cap, sesso, codice_fiscale,
           telefono, note, email, gruppo_orario, badge, transponder, terminale, qualifica, indeterminato, part_time,
           luogo_nascita, domicilio_indirizzo, domicilio_citta, domicilio_provincia, domicilio_cap, stato_civile,
           note_hr, tipo_contratto,
           data_assunzione::text AS data_assunzione, data_cessazione::text AS data_cessazione,
           data_nascita::text AS data_nascita, indeterminato_data::text AS indeterminato_data
    FROM hr_employee`;
  const [departments, plants, companies] = await Promise.all([
    db<{ id: number; name: string }[]>`SELECT id, name FROM hr_department`,
    db<{ id: number; name: string }[]>`SELECT id, name FROM hr_plant`,
    db<{ id: number; name: string }[]>`SELECT id, name FROM hr_contract_company`,
  ]);
  const ctx: Ctx = {
    today,
    deptByName: new Map(departments.map(d => [norm(d.name), d.id])),
    deptName: new Map(departments.map(d => [d.id, d.name])),
    plantByName: new Map(plants.map(x => [norm(x.name), x.id])),
    plantName: new Map(plants.map(x => [x.id, x.name])),
    companyByName: new Map(companies.map(x => [norm(x.name), x.id])),
    companyName: new Map(companies.map(x => [x.id, x.name])),
    matricolaOwner: employees.reduce((m, e) => { if (e.matricola) m.set(matKey(e.matricola), [...(m.get(matKey(e.matricola)) ?? []), e.id]); return m; }, new Map<string, number[]>()),
    matricolaOf: new Map(employees.filter(e => e.matricola).map(e => [e.id, e.matricola as string])),
    claimed: new Set<string>(),
  };

  // ── Abbinamento: nome, poi «Nome Osti», poi matricola (solo se è di una persona sola) ──
  const byName = new Map<string, Emp[]>();
  const byOsti = new Map<string, Emp[]>();
  const byMatricola = new Map<string, Emp[]>();
  const push = (m: Map<string, Emp[]>, k: string, e: Emp) => m.set(k, [...(m.get(k) ?? []), e]);
  for (const e of employees) {
    push(byName, norm(`${e.cognome} ${e.nome}`), e);
    for (const n of ostiNames(e.nome_osti)) push(byOsti, norm(n), e);
    if (e.matricola) push(byMatricola, matKey(e.matricola), e);
  }
  const resolve = (r: Row): Emp[] => {
    const k = norm(clean(r.dip_nome));
    let c = byName.get(k) ?? [];
    if (c.length !== 1) { const o = byOsti.get(k) ?? []; if (c.length === 0 || o.length === 1) c = o; }
    if (c.length !== 1) { const m = byMatricola.get(matKey(r.dip_matricola)) ?? []; if (m.length === 1) c = m; }
    return c;
  };
  // Righe con lo stesso nome in Osti = la stessa persona (più contratti)
  const ownerOfName = new Map<string, number | null>();   // null = nome con schede diverse: non si usa
  for (const r of rows) {
    const nome = clean(r.dip_nome);
    if (!nome) continue;
    const c = resolve(r);
    if (c.length !== 1) continue;
    const k = norm(nome);
    ownerOfName.set(k, ownerOfName.has(k) && ownerOfName.get(k) !== c[0].id ? null : c[0].id);
  }
  const employeeById = new Map(employees.map(e => [e.id, e]));
  const sixMonthsAgo = new Date(Date.now() - 183 * 864e5).toISOString().slice(0, 10);
  const matched = new Map<number, Row[]>();
  let unmatched = 0, ambiguous = 0;
  for (const r of rows) {
    const nome = clean(r.dip_nome);
    if (!nome) continue;
    let c = resolve(r);
    if (c.length !== 1) { const owner = ownerOfName.get(norm(nome)); if (owner != null) c = [employeeById.get(owner)!]; }
    // Senza scheda e licenziato da almeno 6 mesi: ex dipendente, non è un caso da guardare
    if (c.length !== 1 && (ostiDate(r.dip_licenziato) ?? '9') <= sixMonthsAgo) continue;
    if (c.length === 1) matched.set(c[0].id, [...(matched.get(c[0].id) ?? []), r]);
    else if (c.length > 1) ambiguous++;
    else unmatched++;
  }

  // ── Piano di aggiornamento ──
  const plans: Plan[] = [];
  const contractJobs: { emp: Emp; contratti: ContrattoOsti[] }[] = [];
  const missingCat = new Set<string>();   // reparto/plant/società di Osti che da noi non esiste (non si crea in automatico)
  for (const [id, list] of matched) {
    const emp = employeeById.get(id)!;
    const r = pickBest(list, today);
    const rep = repartoOf(r);
    if (rep && !ctx.deptByName.has(norm(rep))) missingCat.add('rep:' + norm(rep));
    const plant = plantOf(r), ditta = clean(r.ditta);
    if (plant && !ctx.plantByName.has(norm(plant))) missingCat.add('plant:' + norm(plant));
    if (ditta && !ctx.companyByName.has(norm(ditta))) missingCat.add('ditta:' + norm(ditta));
    const { plan } = buildPlan(emp, r, ctx);
    if (plan) plans.push(plan);
    const contratti = contrattiOf(list);
    if (contratti.length) contractJobs.push({ emp, contratti });
  }

  // ── Applicazione: un errore su una scheda non ferma le altre ──
  let updated = 0, errors = 0, contracts = 0;
  for (const p of plans) {
    try { await applyPlan(p, ctx); updated++; }
    catch (err) {
      errors++;
      logger.error(`[osti-sync] scheda ${p.emp.id} non aggiornata: ${err instanceof Error ? err.message : err}`);
    }
  }
  // Contratti: stesse date già registrate = già presente (rieseguire non duplica)
  for (const j of contractJobs) {
    try {
      contracts += await db.begin(async (tx) => {
        let added = 0;
        for (const c of j.contratti) {
          if (await registraContratto(tx, j.emp.id, c, ACTOR, today, 'Contratto Osti')) added++;
        }
        return added;
      });
    } catch (err) {
      errors++;
      logger.error(`[osti-sync] contratti scheda ${j.emp.id} non registrati: ${err instanceof Error ? err.message : err}`);
    }
  }

  const detail = `${updated} schede aggiornate su ${rows.length} righe Osti`
    + (contracts ? `, ${contracts} contratti` : '')
    + `; senza abbinamento ${unmatched + ambiguous}`
    + (missingCat.size ? `; reparti/plant/società mancanti ${missingCat.size}` : '')
    + (errors ? `; errori ${errors}` : '');
  const result: OstiSyncResult = {
    updated, unmatched, ambiguous, errors, contracts, missing: missingCat.size, total: rows.length, detail,
  };
  await auditLog({ userId: null, username: ACTOR.display_name, action: 'hr.osti.sync', entity: 'hr_employee', details: { ...result } });
  return result;
}
