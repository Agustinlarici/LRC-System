import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { requireManage, type Env } from '../../lib/auth.js';
import { parseBody } from '../../lib/validate.js';
import { auditLog } from '../../lib/audit.js';

// Import massivo dei contratti interinali (CSV del gestionale paghe: una riga = un contratto).
// Per ogni contratto nuovo si registra: la riga in hr_employee_contract (scheda → "Contratti")
// e gli eventi in timeline (assunzione con data fine + cessazione se già finito).
// Rieseguire lo stesso file non duplica nulla: stessa persona + stesse date = già presente.

export const hrContractRoutes = new Hono<Env>();

const titleCase = (s: string) => s.trim().toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
// Nota che marca le schede create dall'import: serve a ritrovarle in seguito
const IMPORT_NOTE = "Creato dall'import massivo contratti interinali";
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const importSchema = z.object({
  rows: z.array(z.object({
    matricola:   z.string().max(30).optional().nullable(),
    cognome:     z.string().max(100),
    nome:        z.string().max(100),
    qualifica:   z.string().max(100).optional().nullable(),
    data_inizio: z.string().optional().nullable(),
    data_fine:   z.string().optional().nullable(),
  })).max(20000),
  // Scelta dell'utente per chi non è in anagrafica, per chiave persona: 'new' = crea scheda,
  // 'skip' = non importare, numero = collega a quella scheda. Senza scelta non si fa nulla.
  decisions: z.record(z.string(), z.union([z.literal('new'), z.literal('skip'), z.number().int()])).default({}),
  // dry_run: calcola l'esito e annulla tutto (nessuna scrittura)
  dry_run: z.boolean().default(false),
});

interface Issue { type: string; name: string; note: string }
class DryRun extends Error {}
// true se le due parole differiscono per una sola lettera (sostituita, in più o in meno)
function lev1(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}
interface Person { id: number; cognome: string; nome: string; nome_osti: string | null }

hrContractRoutes.post('/import', requireManage('hr'), async (c) => {
  const { rows, decisions, dry_run } = await parseBody(c, importSchema);
  const user = c.get('user');
  const today = new Date().toISOString().slice(0, 10);
  const issues: Issue[] = [];
  let skipped = 0;

  // Righe valide
  const valid: { matricola: string | null; cognome: string; nome: string; qualifica: string | null; inizio: string; fine: string | null }[] = [];
  for (const r of rows) {
    const label = `${r.cognome} ${r.nome}`.trim() || '(senza nome)';
    if (!r.cognome.trim() || !r.nome.trim()) { skipped++; issues.push({ type: 'Saltato', name: label, note: 'nome o cognome mancante' }); continue; }
    if (!r.data_inizio || !ISO.test(r.data_inizio)) { skipped++; issues.push({ type: 'Saltato', name: label, note: 'data assunzione mancante o non valida' }); continue; }
    if (r.data_fine && !ISO.test(r.data_fine)) { skipped++; issues.push({ type: 'Saltato', name: label, note: 'data licenziamento non valida' }); continue; }
    if (r.data_fine && r.data_fine < r.data_inizio) { skipped++; issues.push({ type: 'Saltato', name: label, note: `fine (${r.data_fine}) prima dell'inizio (${r.data_inizio})` }); continue; }
    valid.push({
      matricola: r.matricola?.trim() || null, cognome: r.cognome.trim(), nome: r.nome.trim(),
      qualifica: r.qualifica?.trim() || null, inizio: r.data_inizio, fine: r.data_fine || null,
    });
  }

  // Il nome completo è cognome + nome concatenati, come nell'import di Osti: nella scheda l'ultima parola
  // è il nome e il resto il cognome, nel CSV invece cognome e nome sono colonne separate (ABBATE | GIUSEPPE ALESSIO
  // contro "Abbate Giuseppe" | "Alessio"). Quindi si confronta l'insieme delle parole, senza badare a dove cade il taglio.
  const tokens = (s: string) => norm(s).split(' ').filter(Boolean);
  const sortedKey = (s: string) => tokens(s).sort().join(' ');
  // Il gestionale tronca i nomi ("MUHAMMA" per "MUHAMMAD"): stesse parole tranne l'ultima, una inizio dell'altra
  const truncOf = (short: string, long: string): boolean => {
    const a = tokens(short), b = tokens(long);
    if (a.length !== b.length || a.length === 0) return false;
    const last = a.length - 1;
    for (let k = 0; k < last; k++) if (a[k] !== b[k]) return false;
    return a[last].length >= 3 && a[last].length < b[last].length && b[last].startsWith(a[last]);
  };
  const fullNames = new Set(valid.map(r => norm(`${r.cognome} ${r.nome}`)));
  const canonicalFull = (r: { cognome: string; nome: string }): string => {
    const own = norm(`${r.cognome} ${r.nome}`);
    let best = own;
    for (const other of fullNames) if (truncOf(best, other)) best = other;
    return best;
  };

  const newPeople: { key: string; name: string; contracts: number; suggestions: { id: number; label: string }[]; best: number | null }[] = [];
  let result: { created: number; linked: number; contracts: number; duplicates: number };
  try {
  result = await db.begin(async (tx) => {
    const employees = await tx<Person[]>`SELECT id, cognome, nome, nome_osti FROM hr_employee`;
    // Chiavi di ricerca: nome completo della scheda e nomi Osti collegati (separati da |)
    const byKey = new Map<string, Person[]>();
    const addKey = (k: string, e: Person) => { const l = byKey.get(k) ?? []; if (!l.includes(e)) l.push(e); byKey.set(k, l); };
    const indexPerson = (e: Person) => {
      addKey(sortedKey(`${e.cognome} ${e.nome}`), e);
      for (const n of (e.nome_osti ?? '').split('|')) if (n.trim()) addKey(sortedKey(n), e);
    };
    employees.forEach(indexPerson);

    // Persona della riga: stesse parole (in qualsiasi ordine); altrimenti nome troncato da una parte o dall'altra
    const findPerson = (canon: string): Person[] => {
      const exact = byKey.get(sortedKey(canon));
      if (exact?.length) return exact;
      return employees.filter(e => {
        const full = norm(`${e.cognome} ${e.nome}`);
        return truncOf(canon, full) || truncOf(full, canon);
      });
    };
    // Suggerimenti come nell'import Osti: parole uguali o quasi uguali (una lettera di differenza, nome troncato),
    // anche quando il CSV ha parole in più o in meno (ARUMADURA ISHAN SANJEEVA DE SILVA ~ Arumadura Ishan Sanjeewa).
    const wordsMatch = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && (a.startsWith(b) || b.startsWith(a) || lev1(a, b)));
    const suggest = (canon: string): { list: { id: number; label: string }[]; best: number | null } => {
      const csv = tokens(canon);
      const scored: { id: number; label: string; score: number; strong: boolean }[] = [];
      for (const e of employees) {
        const emp = tokens(`${e.cognome} ${e.nome}`);
        const used = new Set<number>();
        let hit = 0;
        for (const w of csv) {
          const k = emp.findIndex((x, idx) => !used.has(idx) && wordsMatch(w, x));
          if (k >= 0) { used.add(k); hit++; }
        }
        if (hit < 2) continue;
        const cover = hit / Math.min(csv.length, emp.length);
        if (cover < 0.66) continue;
        scored.push({ id: e.id, label: `${e.cognome} ${e.nome}`, score: hit / Math.max(csv.length, emp.length), strong: cover === 1 });
      }
      scored.sort((a, b) => b.score - a.score);
      const top = scored.slice(0, 4);
      // Preselezione solo se c'è un solo candidato forte
      const strong = top.filter(t => t.strong && t.score >= 0.6);
      return { list: top.map(t => ({ id: t.id, label: t.label })), best: strong.length === 1 ? strong[0].id : null };
    };

    // Raggruppa per persona (stesse parole, nomi troncati unificati)
    const groups = new Map<string, { key: string; canon: string; rows: typeof valid }>();
    for (const r of valid) {
      const canon = canonicalFull(r);
      const k = sortedKey(canon);
      const g = groups.get(k) ?? { key: k, canon, rows: [] };
      g.rows.push(r);
      groups.set(k, g);
    }

    let created = 0, linked = 0, contracts = 0, duplicates = 0;
    for (const { key, canon, rows: list } of groups.values()) {
      const first = list[0];
      const label = `${first.cognome} ${first.nome}`;
      let found = findPerson(canon);
      const decision = decisions[key];
      // Scelta manuale: collegare a una scheda esistente
      if (!found.length && typeof decision === 'number') found = employees.filter(e => e.id === decision);
      if (found.length > 1) {
        skipped += list.length;
        issues.push({ type: 'Ambiguo', name: label, note: `${found.length} dipendenti con questo nome: ${list.length} contratti non importati` });
        continue;
      }

      let employeeId: number;
      if (found.length === 1) {
        employeeId = found[0].id; linked++;
      } else {
        if (decision !== 'new') {
          // Senza scelta (o "non importare"): si propone all'utente con i suggerimenti, nessuna scrittura
          skipped += list.length;
          const sug = suggest(canon);
          if (decision === undefined) newPeople.push({ key, name: label, contracts: list.length, suggestions: sug.list, best: sug.best });
          issues.push({ type: 'Non in anagrafica', name: label, note: `${list.length} contratti non importati${sug.list.length ? ` · simile a: ${sug.list.map(x => x.label).join('; ')}` : ''}` });
          continue;
        }
        issues.push({ type: 'Creato', name: label, note: `nuova scheda interinale (${list.length} contratti)` });
        // Persona non ancora in anagrafica: si crea come interinale (cessata se tutti i contratti sono finiti)
        const longest = list.reduce((a, b) => (b.nome.length > a.nome.length ? b : a)).nome;
        const inizio = list.map(r => r.inizio).sort()[0];
        const ongoing = list.some(r => !r.fine || r.fine > today);
        const ultimaFine = list.map(r => r.fine ?? '').sort().pop() || null;
        const [emp] = await tx<{ id: number }[]>`
          INSERT INTO hr_employee ${tx({
            nome: titleCase(longest), cognome: titleCase(first.cognome),
            tipo_contratto: 'INTERINALE',
            data_assunzione: inizio,
            data_cessazione: ongoing ? null : ultimaFine,
            stato: ongoing ? 'attivo' : 'cessato',
            note: IMPORT_NOTE,
          })}
          RETURNING id`;
        employeeId = emp.id; created++;
        const nuova: Person = { id: emp.id, cognome: titleCase(first.cognome), nome: titleCase(longest), nome_osti: null };
        employees.push(nuova);
        indexPerson(nuova);
      }

      for (const r of list) {
        const [ins] = await tx<{ id: number }[]>`
          INSERT INTO hr_employee_contract (employee_id, matricola, qualifica, data_inizio, data_fine)
          VALUES (${employeeId}, ${r.matricola}, ${r.qualifica}, ${r.inizio}, ${r.fine})
          ON CONFLICT (employee_id, data_inizio, (COALESCE(data_fine, 'infinity'::date))) DO NOTHING
          RETURNING id`;
        if (!ins) { duplicates++; continue; }
        contracts++;
        const note = `Contratto interinale${r.matricola ? ` · matricola ${r.matricola}` : ''}`;
        await tx`
          INSERT INTO hr_employee_event ${tx({
            employee_id: employeeId, event_type: 'assunzione', event_date: r.inizio, end_date: r.fine,
            to_value: r.qualifica, note, created_by_user_id: user.id, created_by_name: user.display_name,
          })}`;
        if (r.fine && r.fine <= today) {
          await tx`
            INSERT INTO hr_employee_event ${tx({
              employee_id: employeeId, event_type: 'cessazione', event_date: r.fine,
              note: 'Fine contratto interinale', created_by_user_id: user.id, created_by_name: user.display_name,
            })}`;
        }
      }
    }
    if (dry_run) throw new DryRun();
    return { created, linked, contracts, duplicates };
  });
  } catch (err) {
    if (!(err instanceof DryRun)) throw err;
    return c.json({ dry_run: true, new_people: newPeople, skipped, issues });
  }

  await auditLog({ userId: user.id, username: user.username, action: 'hr.contracts.import', entity: 'hr_employee_contract', details: result });
  return c.json({ ...result, skipped, issues, new_people: newPeople });
});
