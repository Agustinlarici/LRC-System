import type { HrEmployee, HrDepartment } from '@/types';
import type { ImportResult, ImportIssue } from '@/components/ui/ImportExcelButton';

// Import dell'elenco dipendenti del sistema Osti (CSV "elenco_dipendenti.csv", colonne dip_*).
//
// 1. Abbina ogni riga a un dipendente: prima per cognome+nome, poi per "Nome Osti" già salvato.
// 2. Aggiorna i campi: dove la scheda è vuota scrive in silenzio; dove c'è già un valore diverso
//    lo cambia e lo registra nella timeline come evento.
// Osti non è mai la fonte per svuotare un campo: una cella vuota in Osti non cancella nulla.

type Row = Record<string, string>;

// Campi che Osti descrive in modo più generico dei nostri (es. reparto "VERNICIATURA" contro il nostro
// "CARTEGGIATURA", mansione "addetto allo stampaggio" contro "STAMPATORE"): si compilano solo se vuoti.
const FILL_ONLY = new Set(['reparto_id', 'mansione', 'nazionalita']);

const FIELD_LABEL: Record<string, string> = {
  nome_osti: 'Nome Osti', matricola: 'Matricola', data_assunzione: 'Data assunzione', data_cessazione: 'Data cessazione',
  mansione: 'Mansione', livello: 'Livello', nazionalita: 'Nazionalità', indirizzo: 'Indirizzo', citta: 'Città',
  provincia: 'Provincia', cap: 'CAP', data_nascita: 'Data di nascita', sesso: 'Sesso', codice_fiscale: 'Codice fiscale',
  telefono: 'Telefono', note: 'Note', email: 'Email', reparto_id: 'Reparto', gruppo_orario: 'Gruppo orario',
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

const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

interface Plan {
  emp: HrEmployee;
  fill: Record<string, unknown>;                              // campi vuoti nella scheda: scrittura silenziosa
  change: Record<string, unknown>;                            // campi con valore diverso: cambio registrato
  changes: { field: string; from: string; to: string }[];     // per la nota dell'evento
  cessa: boolean;                                             // la persona passa a "cessato"
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
  matricolaOwner: Map<string, number>;
}

const json = { 'Content-Type': 'application/json' };

// Valori che Osti propone per una persona, già puliti. Valore assente = null (non tocca nulla).
function wantOf(r: Row, ctx: Ctx): Record<string, string | number | null> {
  const email = clean(r.dip_email);
  const sesso = clean(r.dip_sesso).toUpperCase();
  const matricola = clean(r.dip_matricola);
  const livello = clean(r.dip_livello);
  return {
    nome_osti: clean(r.dip_nome),
    matricola: matricola && matricola !== '0' ? matricola : null,
    data_assunzione: ostiDate(r.dip_assunto),
    data_cessazione: ostiDate(r.dip_licenziato),
    mansione: clean(r.dip_mansione) || null,
    livello: livello && livello !== '-' && livello !== '0' ? livello : null,
    nazionalita: clean(r.dip_nazione) || null,
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
    gruppo_orario: clean(r.gruppo_orario) || null,
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
    if (f === 'reparto_id') return ctx.deptName.get(v as number) ?? '';
    if (f.startsWith('data_')) return String(v).slice(0, 10);
    return String(v);
  };
  const show = (f: string, v: string | number) => (f === 'reparto_id' ? ctx.deptName.get(v as number) ?? '' : String(v));

  const plan: Plan = { emp, fill: {}, change: {}, changes: [], cessa: false };
  let conflict: string | null = null;
  for (const [f, v] of Object.entries(want)) {
    if (v == null) continue;                                    // Osti vuoto: non tocca nulla
    const cur = have(f);
    if (cur !== '' && norm(cur) === norm(show(f, v))) continue; // già uguale (a meno di maiuscole/spazi)
    if (f === 'matricola') {
      const owner = ctx.matricolaOwner.get(norm(String(v)));
      if (owner != null && owner !== emp.id) { conflict = `${v} è di un altro dipendente`; continue; }
    }
    if (cur === '') plan.fill[f] = v;
    else if (!FILL_ONLY.has(f)) { plan.change[f] = v; plan.changes.push({ field: f, from: cur, to: show(f, v) }); }
  }
  // Cessazione già trascorsa: la persona risulta cessata. Una data futura è solo la fine del contratto.
  if (licenziato && licenziato <= ctx.today && emp.stato !== 'cessato') {
    plan.cessa = true;
    plan.change.stato = 'cessato';
    plan.change.data_cessazione = licenziato;
    delete plan.fill.data_cessazione;
  }
  const empty = !Object.keys(plan.fill).length && !Object.keys(plan.change).length;
  return { plan: empty ? null : plan, conflict };
}

// reparto, mansione e livello hanno già il loro evento automatico nel backend
const AUTO_EVENT = new Set(['livello', 'mansione', 'reparto_id']);

async function applyPlan(p: Plan, ctx: Ctx): Promise<boolean> {
  const patch = (body: Record<string, unknown>, silent: boolean) => fetch(
    `${ctx.backend}/api/hr/employees/${p.emp.id}${silent ? '?storico=0' : ''}`,
    { method: 'PATCH', headers: json, credentials: 'include', body: JSON.stringify(body) },
  );
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
  return ok;
}

const empLabel = (e: HrEmployee) => `${e.cognome} ${e.nome}`;

export async function runOstiImport(
  rows: Row[],
  deps: {
    backend: string; employees: HrEmployee[]; departments: HrDepartment[];
    confirm: (o: { title: string; message: string; confirmLabel: string }) => Promise<boolean>;
    onChanged?: () => void;   // dopo ogni scelta fatta nella tabella del dettaglio (ricarica l'elenco)
  },
): Promise<ImportResult> {
  const { backend, employees, departments, confirm, onChanged } = deps;
  if (!rows.some(r => 'dip_nome' in r)) {
    return { inserted: 0, skipped: 0, errors: 1, detail: 'File non riconosciuto: manca la colonna dip_nome (serve l\'elenco dipendenti di Osti).' };
  }
  const today = new Date().toISOString().slice(0, 10);
  const ctx: Ctx = {
    backend, today,
    deptByName: new Map(departments.map(d => [norm(d.name), d.id])),
    deptName: new Map(departments.map(d => [d.id, d.name])),
    matricolaOwner: new Map(employees.filter(e => e.matricola).map(e => [norm(e.matricola), e.id])),
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
    if (body.matricola && ctx.matricolaOwner.has(norm(String(body.matricola)))) delete body.matricola;
    if (!body.data_assunzione) body.data_assunzione = today;
    const res = await fetch(`${backend}/api/hr/employees`, { method: 'POST', headers: json, credentials: 'include', body: JSON.stringify(body) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'dati rifiutati dal backend');
    const emp: HrEmployee = await res.json();
    if (emp.matricola) ctx.matricolaOwner.set(norm(emp.matricola), emp.id);
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
  const matched = new Map<number, Row[]>();
  let unmatched = 0, ambiguous = 0;
  const issues: ImportIssue[] = [];   // una riga per ogni caso da guardare: finiscono nella tabella del risultato
  let storici = 0;   // ex dipendenti (già cessati in Osti) che da noi non esistono: normale, non si segnalano uno per uno
  for (const r of rows) {
    const nome = clean(r.dip_nome);
    if (!nome) continue;
    const k = norm(nome);
    let c = byName.get(k) ?? [];
    if (c.length !== 1) { const o = byOsti.get(k) ?? []; if (c.length === 0 || o.length === 1) c = o; }
    if (c.length === 1) matched.set(c[0].id, [...(matched.get(c[0].id) ?? []), r]);
    else if (c.length > 1) {
      ambiguous++;
      issues.push({
        type: 'Nome ambiguo', name: nome, note: 'più dipendenti con questo nome: scegli quello giusto',
        choices: empChoices(c), actions: [{ label: 'Collega', needsChoice: true, run: ch => link(Number(ch), r) }],
      });
    } else if ((ostiDate(r.dip_licenziato) ?? '9') <= today) storici++;
    else {
      unmatched++;
      issues.push({
        type: 'Non trovato', name: nome, note: `matricola ${clean(r.dip_matricola) || '—'} · ${clean(r.reparto) || '—'}`,
        choices: allChoices,
        actions: [
          { label: 'Collega', needsChoice: true, run: ch => link(Number(ch), r) },
          { label: 'Crea nuovo', run: () => create(r) },
        ],
      });
    }
  }

  // ── Piano di aggiornamento ───────────────────────────────────────────────────
  const empById = new Map(employees.map(e => [e.id, e]));
  const plans: Plan[] = [];
  const missingDepts = new Map<string, { label: string; emps: HrEmployee[] }>();   // reparto di Osti che da noi non esiste
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

  const nFill = plans.filter(p => Object.keys(p.fill).length).length;
  const nChange = plans.filter(p => Object.keys(p.change).length).length;
  const nCessa = plans.filter(p => p.cessa).length;
  const summary = `${plans.length} dipendenti da aggiornare (${nFill} con campi da compilare, ${nChange} con valori da cambiare`
    + `${nCessa ? `, ${nCessa} da segnare come cessati` : ''}). Senza abbinamento: ${unmatched + ambiguous}.`;
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
