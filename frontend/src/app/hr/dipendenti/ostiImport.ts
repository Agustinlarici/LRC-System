import type { HrEmployee, HrDepartment, HrPlant, HrContractCompany } from '@/types';
import type { ImportResult, ImportIssue } from '@/components/ui/ImportExcelButton';
import { rankCandidates } from '@/lib/hrPhoto';

// Import dell'elenco dipendenti del sistema Osti (CSV "elenco_dipendenti.csv", colonne dip_*).
//
// 1. Abbina ogni riga a un dipendente: prima per cognome+nome, poi per "Nome Osti" già salvato.
// 2. Aggiorna i campi: dove la scheda è vuota scrive in silenzio; dove c'è già un valore diverso
//    lo cambia e lo registra nella timeline come evento.
// Osti non è mai la fonte per svuotare un campo: una cella vuota in Osti non cancella nulla.

type Row = Record<string, string>;

const FIELD_LABEL: Record<string, string> = {
  nome_osti: 'Nome Osti', matricola: 'Matricola', data_assunzione: 'Data assunzione', data_cessazione: 'Data cessazione',
  mansione: 'Mansione', livello: 'Livello', stato: 'Stato', nazionalita: 'Nazionalità', tipo_nazionalita: 'Extra UE / Italia', indirizzo: 'Indirizzo', citta: 'Città',
  provincia: 'Provincia', cap: 'CAP', data_nascita: 'Data di nascita', sesso: 'Sesso', codice_fiscale: 'Codice fiscale',
  telefono: 'Telefono', note: 'Note', email: 'Email', reparto_id: 'Reparto', plant_ids: 'Plant', contract_company_id: 'Società contratto', gruppo_orario: 'Gruppo orario',
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

// Chiave di confronto delle matricole: senza zeri davanti, così 000123 e 123 sono la stessa
const matKey = (s: string | null | undefined) => noLeadingZeros(norm(s));

// "Extra UE / Italia" si ricava dal paese della nazionalità di Osti (ITALIANA, MOLDAVA…).
// Doppia nazionalità ("moldava/rumena"): se una delle due è italiana o dell'UE vale quella.
const UE_RE = /^(rum$|rom$|romen|rumen|romania|rumania|polac|polon|bulgar|spagnol|spagna|frances|francia|tedesc|german|croat|portoghes|portogallo|grec|ungher|cec[ao]$|repubblica ceca|slovacc|sloven|litu|letton|eston|finland|svedes|svezia|danes|danimarca|olandes|paesi bassi|belg|austria|irlandes|irlanda|maltes|malta|cipri|lussemburg)/;
const TIPI_NAZIONALITA = new Set(['ITALIANO', 'UE', 'EXTRA UE']);
function tipoNazionalita(s: string | undefined): string | null {
  const v = norm(s);
  if (!v || v === '-') return null;
  const parts = v.split(/\s*[\/,;]\s*|\s+e\s+/);
  if (parts.some(p => /^ital/.test(p))) return 'ITALIANO';
  return parts.some(p => UE_RE.test(p)) ? 'UE' : 'EXTRA UE';
}

const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

// Codici numerici di Osti (badge, terminale…): vuoto, 0 e "-" significano "nessuno"
const positive = (s: string | undefined) => { const v = clean(s); return v && v !== '0' && v !== '-' ? v : null; };

interface Plan {
  emp: HrEmployee;
  fill: Record<string, unknown>;                              // campi vuoti nella scheda: scrittura silenziosa
  change: Record<string, unknown>;                            // campi con valore diverso: cambio registrato
  changes: { field: string; from: string; to: string }[];     // per la nota dell'evento
  cessa: boolean;                                             // la persona passa a "cessato"
  takeFrom: number[];                                         // schede a cui si toglie la matricola (la stessa, scritta con o senza zeri)
}

// Tra più righe Osti per la stessa persona (es. assunta, licenziata e riassunta con un'altra matricola)
// vale quella in corso; a parità, l'assunzione più recente.
function pickBest(rows: Row[], today: string): Row {
  const inCorso = (r: Row) => { const d = ostiDate(r.dip_licenziato); return !d || d > today; };
  return [...rows].sort((a, b) =>
    Number(inCorso(b)) - Number(inCorso(a)) || (ostiDate(b.dip_assunto) ?? '').localeCompare(ostiDate(a.dip_assunto) ?? ''))[0];
}

interface Ctx {
  backend: string;
  today: string;
  deptByName: Map<string, number>;
  deptName: Map<number, string>;
  plantByName: Map<string, number>;
  plantName: Map<number, string>;
  companyByName: Map<string, number>;
  companyName: Map<number, string>;
  matricolaOwner: Map<string, number[]>;   // matricola (senza zeri) → schede che la hanno, con o senza zeri
  matricolaOf: Map<number, string>;        // scheda → matricola com'è salvata
  claimed: Set<string>;                    // matricole già assegnate in questo import
}

const json = { 'Content-Type': 'application/json' };

// Valori che Osti propone per una persona, già puliti. Valore assente = null (non tocca nulla).
function wantOf(r: Row, ctx: Ctx): Record<string, string | number | boolean | number[] | null> {
  const email = clean(r.dip_email);
  const sesso = clean(r.dip_sesso).toUpperCase();
  const matricola = noLeadingZeros(r.dip_matricola);
  const livello = clean(r.dip_livello);
  const plantId = ctx.plantByName.get(norm(clean(r.filiale)));   // filiale/ditta arrivano solo dalla lettura MySQL
  return {
    nome_osti: clean(r.dip_nome),
    matricola: matricola && matricola !== '0' ? matricola : null,
    data_assunzione: ostiDate(r.dip_assunto),
    data_cessazione: ostiDate(r.dip_licenziato),
    mansione: clean(r.dip_mansione) || null,
    livello: livello && livello !== '-' && livello !== '0' ? livello : null,
    nazionalita: clean(r.dip_nazione) || null,   // come in Osti
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
    gruppo_orario: clean(r.gruppo_orario) || null,
    badge: positive(r.dip_badge),
    transponder: positive(r.dip_transponder),
    terminale: positive(r.dip_terminale),
    qualifica: clean(r.dip_qualifica) || null,
    // 0/1 di Osti: la colonna "indeterminato" è un sì/no; il part-time da noi è testo, si scrive solo "Sì"
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

// "REPARTO VERNICIATURA" in Osti = "VERNICIATURA" da noi
const repartoOf = (r: Row) => clean(r.reparto).replace(/^reparto\s+/i, '');

// Confronta la scheda con quanto propone Osti e dice cosa scrivere
function buildPlan(emp: HrEmployee, r: Row, ctx: Ctx): { plan: Plan | null; conflict: string | null } {
  const want = wantOf(r, ctx);
  const licenziato = ostiDate(r.dip_licenziato);
  const have = (f: string): string => {
    const v = (emp as unknown as Record<string, unknown>)[f];
    if (v == null || v === '') return '';
    if (f === 'nazionalita' && TIPI_NAZIONALITA.has(String(v).trim().toUpperCase())) return '';   // vecchia categoria: ora sta in tipo_nazionalita
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

  const plan: Plan = { emp, fill: {}, change: {}, changes: [], cessa: false, takeFrom: [] };
  let conflict: string | null = null;
  for (const [f, v] of Object.entries(want)) {
    if (v == null) continue;                                    // Osti vuoto: non tocca nulla
    const cur = have(f);
    if (cur !== '' && norm(cur) === norm(show(f, v))) continue; // già uguale (a meno di maiuscole/spazi)
    if (f === 'matricola') {
      // La matricola di Osti vince: si scrive sempre senza zeri. Se un'altra scheda ha già lo stesso numero
      // (la base accetta una matricola per persona) la perde: resta traccia nella sua timeline.
      const key = matKey(String(v));
      if (ctx.claimed.has(key)) { conflict = `${v} è già assegnata a un'altra riga di questo import`; continue; }
      ctx.claimed.add(key);
      plan.takeFrom = (ctx.matricolaOwner.get(key) ?? []).filter(id => id !== emp.id);
      if (cur === '' || noLeadingZeros(cur) === String(v)) plan.fill.matricola = v;   // solo gli zeri davanti: in silenzio
      else { plan.change.matricola = v; plan.changes.push({ field: f, from: cur, to: String(v) }); }
      continue;
    }
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
  // Data di cessazione futura = contratto ancora in corso: chi risultava cessato torna attivo
  if (licenziato && licenziato > ctx.today && emp.stato === 'cessato') {
    plan.change.stato = 'attivo';
    plan.change.data_cessazione = licenziato;
    plan.changes.push({ field: 'stato', from: 'cessato', to: 'attivo' });
    delete plan.fill.data_cessazione;
  }
  const empty = !Object.keys(plan.fill).length && !Object.keys(plan.change).length;
  if (empty) plan.takeFrom = [];
  return { plan: empty ? null : plan, conflict };
}

// reparto, mansione e livello hanno già il loro evento automatico nel backend
const AUTO_EVENT = new Set(['livello', 'mansione', 'reparto_id']);

async function applyPlan(p: Plan, ctx: Ctx): Promise<boolean> {
  const patch = (body: Record<string, unknown>, silent: boolean) => fetch(
    `${ctx.backend}/api/hr/employees/${p.emp.id}${silent ? '?storico=0' : ''}`,
    { method: 'PATCH', headers: json, credentials: 'include', body: JSON.stringify(body) },
  );
  const setMatricola = (id: number, value: string | null) => fetch(
    `${ctx.backend}/api/hr/employees/${id}?storico=0`,
    { method: 'PATCH', headers: json, credentials: 'include', body: JSON.stringify({ matricola: value }) },
  );
  const taken: { id: number; old: string }[] = [];
  for (const id of p.takeFrom) {
    const old = ctx.matricolaOf.get(id);
    if (old == null) continue;
    if (!(await setMatricola(id, null)).ok) return false;
    taken.push({ id, old });
  }
  let ok = true;
  if (Object.keys(p.fill).length) ok = (await patch(p.fill, true)).ok;
  if (ok && Object.keys(p.change).length) {
    ok = (await patch(p.change, false)).ok;
    const manual = p.changes.filter(c => !AUTO_EVENT.has(c.field) && !(p.cessa && c.field === 'data_cessazione'));
    if (ok && manual.length) {
      await fetch(`${ctx.backend}/api/hr/employees/${p.emp.id}/events`, {
        method: 'POST', headers: json, credentials: 'include',
        body: JSON.stringify({
          event_type: 'altro', event_date: ctx.today,
          note: 'Import Osti — ' + manual.map(c => `${FIELD_LABEL[c.field] ?? c.field}: «${c.from}» → «${c.to}»`).join('; '),
        }),
      });
    }
  }
  if (!ok) {
    for (const t of taken) await setMatricola(t.id, t.old);   // salvataggio fallito: le altre schede riprendono la loro matricola
    return false;
  }
  for (const t of taken) {
    await fetch(`${ctx.backend}/api/hr/employees/${t.id}/events`, {
      method: 'POST', headers: json, credentials: 'include',
      body: JSON.stringify({
        event_type: 'altro', event_date: ctx.today,
        note: `Import Osti — Matricola «${t.old}» tolta: in Osti è di ${empLabel(p.emp)}`,
      }),
    });
    ctx.matricolaOf.delete(t.id);
  }
  return ok;
}

const empLabel = (e: HrEmployee) => `${e.cognome} ${e.nome}`;

export async function runOstiImport(
  rows: Row[],
  deps: {
    backend: string; employees: HrEmployee[]; departments: HrDepartment[]; plants: HrPlant[]; companies: HrContractCompany[];
    confirm: (o: { title: string; message: string; confirmLabel: string }) => Promise<boolean>;
    onChanged?: () => void;   // dopo ogni scelta fatta nella tabella del dettaglio (ricarica l'elenco)
  },
): Promise<ImportResult> {
  const { backend, employees, departments, plants, companies, confirm, onChanged } = deps;
  if (!rows.some(r => 'dip_nome' in r)) {
    return { inserted: 0, skipped: 0, errors: 1, detail: 'File non riconosciuto: manca la colonna dip_nome (serve l\'elenco dipendenti di Osti).' };
  }
  const today = new Date().toISOString().slice(0, 10);
  const ctx: Ctx = {
    backend, today,
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

  // ── Azioni che l'utente può scegliere dalla tabella del dettaglio ────────────
  // Collega la riga Osti a un dipendente scelto a mano: scrive il Nome Osti e aggiorna i dati.
  async function link(id: number, r: Row): Promise<string> {
    const res = await fetch(`${backend}/api/hr/employees/${id}`, { credentials: 'include' });
    if (!res.ok) throw new Error('dipendente non trovato');
    const emp: HrEmployee = await res.json();
    const { plan } = buildPlan(emp, r, ctx);
    if (plan && !(await applyPlan(plan, ctx))) throw new Error('dati rifiutati dal backend');
    onChanged?.();
    return `Collegato a ${empLabel(emp)}`;
  }
  // Crea un dipendente nuovo con i dati di Osti ("COGNOME NOME": l'ultima parola è il nome)
  async function create(r: Row): Promise<string> {
    const words = clean(r.dip_nome).split(' ');
    const nome = words[words.length - 1];
    const cognome = words.length > 1 ? words.slice(0, -1).join(' ') : nome;
    const body: Record<string, unknown> = { nome, cognome };
    for (const [f, v] of Object.entries(wantOf(r, ctx))) if (v != null) body[f] = v;
    if (body.matricola && ctx.matricolaOwner.has(matKey(String(body.matricola)))) delete body.matricola;
    if (!body.data_assunzione) body.data_assunzione = today;
    const res = await fetch(`${backend}/api/hr/employees`, { method: 'POST', headers: json, credentials: 'include', body: JSON.stringify(body) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'dati rifiutati dal backend');
    const emp: HrEmployee = await res.json();
    if (emp.matricola) { ctx.matricolaOwner.set(matKey(emp.matricola), [emp.id]); ctx.matricolaOf.set(emp.id, emp.matricola); }
    onChanged?.();
    return `Creato ${empLabel(emp)}`;
  }
  const empChoices = (list: HrEmployee[]) => list
    .map(e => ({ value: String(e.id), label: `${empLabel(e)}${e.matricola ? ` · ${e.matricola}` : ''}${e.stato === 'cessato' ? ' (cessato)' : ''}` }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const allChoices = empChoices(employees);

  // ── Abbinamento ──────────────────────────────────────────────────────────────
  const byName = new Map<string, HrEmployee[]>();
  const byOsti = new Map<string, HrEmployee[]>();
  const push = (m: Map<string, HrEmployee[]>, k: string, e: HrEmployee) => m.set(k, [...(m.get(k) ?? []), e]);
  for (const e of employees) {
    push(byName, norm(`${e.cognome} ${e.nome}`), e);
    if (e.nome_osti) push(byOsti, norm(e.nome_osti), e);
  }
  // La matricola è unica: se il nome non basta (es. cognome e nome scritti diversamente in Osti) abbina da lì
  const byMatricola = new Map<string, HrEmployee[]>();
  for (const e of employees) if (e.matricola) push(byMatricola, matKey(e.matricola), e);
  const matched = new Map<number, Row[]>();
  let unmatched = 0, ambiguous = 0;
  const issues: ImportIssue[] = [];   // una riga per ogni caso da guardare: finiscono nella tabella del risultato
  const suggestedIds = new Map<ImportIssue, number[]>();   // candidati per i casi 'Non trovato'; si filtrano a fine giro
  let storici = 0;   // ex dipendenti (licenziati in Osti da almeno 6 mesi) che da noi non esistono: normale, non si segnalano
  const sixMonthsAgo = new Date(Date.now() - 183 * 864e5).toISOString().slice(0, 10);
  for (const r of rows) {
    const nome = clean(r.dip_nome);
    if (!nome) continue;
    const k = norm(nome);
    let c = byName.get(k) ?? [];
    if (c.length !== 1) { const o = byOsti.get(k) ?? []; if (c.length === 0 || o.length === 1) c = o; }
    if (c.length !== 1) { const m = byMatricola.get(matKey(r.dip_matricola)) ?? []; if (m.length === 1) c = m; }   // solo se la matricola è di una persona sola
    // Senza scheda (o con nome ambiguo) e licenziato da almeno 6 mesi: non è un caso da guardare
    if (c.length !== 1 && (ostiDate(r.dip_licenziato) ?? '9') <= sixMonthsAgo) { storici++; continue; }
    if (c.length === 1) matched.set(c[0].id, [...(matched.get(c[0].id) ?? []), r]);
    else if (c.length > 1) {
      ambiguous++;
      issues.push({
        type: 'Nome ambiguo', name: nome, note: 'più dipendenti con questo nome: scegli quello giusto',
        choices: empChoices(c), actions: [{ label: 'Collega', needsChoice: true, run: ch => link(Number(ch), r) }],
      });
    } else {
      unmatched++;
      const issue: ImportIssue = {
        type: 'Non trovato', name: nome, note: `matricola ${clean(r.dip_matricola) || '—'} · ${clean(r.reparto) || '—'}`,
        choices: allChoices,
        actions: [
          { label: 'Collega', needsChoice: true, run: ch => link(Number(ch), r) },
          { label: 'Crea nuovo', run: () => create(r) },
        ],
      };
      suggestedIds.set(issue, rankCandidates(nome, employees, 8).map(x => x.id));
      issues.push(issue);
    }
  }

  // Suggeriti: i più simili per nome, esclusi quelli già abbinati a un'altra riga di Osti
  const labelOf = new Map(allChoices.map(c => [c.value, c]));
  for (const [issue, ids] of suggestedIds) {
    issue.suggested = ids.filter(id => !matched.has(id)).slice(0, 3)
      .map(id => labelOf.get(String(id))).filter((c): c is { value: string; label: string } => !!c);
  }

  // ── Piano di aggiornamento ───────────────────────────────────────────────────
  const empById = new Map(employees.map(e => [e.id, e]));
  const plans: Plan[] = [];
  const missingDepts = new Map<string, { label: string; emps: HrEmployee[] }>();   // reparto di Osti che da noi non esiste
  const missingCat = new Map<string, { kind: 'plant' | 'company'; label: string; emps: HrEmployee[] }>();   // filiale/ditta di Osti che da noi non esiste
  let duplicates = 0;
  for (const [id, list] of matched) {
    const emp = empById.get(id)!;
    const r = pickBest(list, today);
    duplicates += list.length - 1;
    const rep = repartoOf(r);
    if (rep && !ctx.deptByName.has(norm(rep))) {
      const m = missingDepts.get(norm(rep)) ?? { label: rep, emps: [] };
      m.emps.push(emp);
      missingDepts.set(norm(rep), m);
    }
    for (const [kind, label, known] of [['plant', clean(r.filiale), ctx.plantByName], ['company', clean(r.ditta), ctx.companyByName]] as const) {
      if (!label || known.has(norm(label))) continue;
      const m = missingCat.get(kind + norm(label)) ?? { kind, label, emps: [] };
      m.emps.push(emp);
      missingCat.set(kind + norm(label), m);
    }
    const { plan, conflict } = buildPlan(emp, r, ctx);
    if (conflict) issues.push({ type: 'Matricola già assegnata', name: empLabel(emp), note: conflict });
    if (plan) plans.push(plan);
  }
  // Un reparto nuovo si crea una volta sola e si assegna a chi non ne ha uno (gli altri tengono il loro, più preciso)
  for (const { label, emps } of missingDepts.values()) {
    issues.push({
      type: 'Reparto non presente', name: label, note: `${emps.length} dipendenti in Osti`,
      actions: [{
        label: 'Crea reparto',
        run: async () => {
          const res = await fetch(`${backend}/api/hr/departments`, { method: 'POST', headers: json, credentials: 'include', body: JSON.stringify({ name: label }) });
          if (!res.ok) throw new Error('reparto non creato');
          const dep: { id: number } = await res.json();
          ctx.deptByName.set(norm(label), dep.id);
          ctx.deptName.set(dep.id, label);
          let assegnati = 0;
          for (const e of emps) {
            if (e.reparto_id != null) continue;
            const p = await fetch(`${backend}/api/hr/employees/${e.id}?storico=0`, { method: 'PATCH', headers: json, credentials: 'include', body: JSON.stringify({ reparto_id: dep.id }) });
            if (p.ok) assegnati++;
          }
          onChanged?.();
          return `Reparto creato, assegnato a ${assegnati} (${emps.length - assegnati} hanno già un reparto)`;
        },
      }],
    });
  }

  // Plant e società nuovi: si creano una volta sola e si assegnano a chi non ne ha (come per i reparti)
  for (const { kind, label, emps } of missingCat.values()) {
    const isPlant = kind === 'plant';
    issues.push({
      type: isPlant ? 'Plant non presente' : 'Società non presente', name: label, note: `${emps.length} dipendenti in Osti`,
      actions: [{
        label: isPlant ? 'Crea plant' : 'Crea società',
        run: async () => {
          const res = await fetch(`${backend}/api/hr/${isPlant ? 'plants' : 'contract-companies'}`, { method: 'POST', headers: json, credentials: 'include', body: JSON.stringify({ name: label }) });
          if (!res.ok) throw new Error('voce non creata');
          const created: { id: number } = await res.json();
          (isPlant ? ctx.plantByName : ctx.companyByName).set(norm(label), created.id);
          (isPlant ? ctx.plantName : ctx.companyName).set(created.id, label);
          let assegnati = 0;
          for (const e of emps) {
            if (isPlant ? (e.plant_ids ?? []).length : e.contract_company_id != null) continue;
            const body = isPlant ? { plant_ids: [created.id] } : { contract_company_id: created.id };
            const p = await fetch(`${backend}/api/hr/employees/${e.id}?storico=0`, { method: 'PATCH', headers: json, credentials: 'include', body: JSON.stringify(body) });
            if (p.ok) assegnati++;
          }
          onChanged?.();
          return `${isPlant ? 'Plant creato' : 'Società creata'}, assegnata a ${assegnati} (${emps.length - assegnati} ne hanno già una)`;
        },
      }],
    });
  }

  const nFill = plans.filter(p => Object.keys(p.fill).length).length;
  const nChange = plans.filter(p => Object.keys(p.change).length).length;
  const nCessa = plans.filter(p => p.cessa).length;
  const nTolte = plans.reduce((n, p) => n + p.takeFrom.length, 0);
  const summary = `${plans.length} dipendenti da aggiornare (${nFill} con campi da compilare, ${nChange} con valori da cambiare`
    + `${nCessa ? `, ${nCessa} da segnare come cessati` : ''}${nTolte ? `, ${nTolte} matricole tolte ad altre schede (stesso numero)` : ''}). Senza abbinamento: ${unmatched + ambiguous}.`;
  if (plans.length === 0) return { inserted: 0, skipped: unmatched + ambiguous, errors: 0, detail: `Niente da aggiornare. ${summary}`, issues };
  if (!(await confirm({ title: 'Importa elenco Osti', message: summary, confirmLabel: 'Aggiorna' }))) {
    return { inserted: 0, skipped: 0, errors: 0, detail: 'Import annullato, nessuna modifica.' };
  }

  // ── Applicazione ─────────────────────────────────────────────────────────────
  let updated = 0, errors = 0;
  for (const p of plans) {
    if (await applyPlan(p, ctx)) updated++;
    else { errors++; issues.push({ type: 'Errore di salvataggio', name: empLabel(p.emp), note: 'il backend ha rifiutato i dati (campo troppo lungo o non valido)' }); }
  }

  return {
    inserted: 0, updated, skipped: unmatched + ambiguous, errors,
    detail: `Aggiornati ${updated}. Senza abbinamento: ${unmatched + ambiguous}.`
      + (storici ? ` Ex dipendenti Osti senza scheda da noi (ignorati): ${storici}.` : '')
      + (duplicates ? ` Righe doppie (vale la più recente): ${duplicates}.` : ''),
    issues,
  };
}
