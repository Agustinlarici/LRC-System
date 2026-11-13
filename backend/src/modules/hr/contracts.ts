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
  // create_missing: crea chi non è in anagrafica (solo se l'utente l'ha confermato)
  create_missing: z.boolean().default(false),
  // dry_run: calcola l'esito e annulla tutto (nessuna scrittura)
  dry_run: z.boolean().default(false),
});

interface Issue { type: string; name: string; note: string }
class DryRun extends Error {}
interface Person { id: number; cognome: string; nome: string }

hrContractRoutes.post('/import', requireManage('hr'), async (c) => {
  const { rows, create_missing, dry_run } = await parseBody(c, importSchema);
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

  // Il gestionale tronca i nomi a 8 lettere ("MUHAMMA" per "MUHAMMAD"): dentro lo stesso cognome
  // un nome che è l'inizio di uno più lungo viene unificato a quello più lungo.
  const namesByCognome = new Map<string, Set<string>>();
  for (const r of valid) {
    const k = norm(r.cognome);
    namesByCognome.set(k, (namesByCognome.get(k) ?? new Set()).add(norm(r.nome)));
  }
  const canonicalName = (cognome: string, nome: string): string => {
    const n = norm(nome);
    let best = n;
    for (const other of namesByCognome.get(norm(cognome)) ?? []) if (other.length > best.length && other.startsWith(n)) best = other;
    return best;
  };

  const newPeople: string[] = [];
  let result: { created: number; linked: number; contracts: number; duplicates: number };
  try {
  result = await db.begin(async (tx) => {
    const employees = await tx<Person[]>`SELECT id, cognome, nome FROM hr_employee`;
    const byCognome = new Map<string, Person[]>();
    for (const e of employees) byCognome.set(norm(e.cognome), [...(byCognome.get(norm(e.cognome)) ?? []), e]);

    // Persona della riga: nome uguale, oppure uno dei due è l'inizio dell'altro (nome troncato)
    const findPerson = (cognome: string, nome: string): Person[] => {
      const n = canonicalName(cognome, nome);
      const list = byCognome.get(norm(cognome)) ?? [];
      const exact = list.filter(e => norm(e.nome) === n);
      if (exact.length) return exact;
      return list.filter(e => norm(e.nome).startsWith(n) || n.startsWith(norm(e.nome)));
    };

    // Raggruppa per persona (stesso cognome + nome unificato)
    const groups = new Map<string, typeof valid>();
    for (const r of valid) {
      const k = `${norm(r.cognome)}|${canonicalName(r.cognome, r.nome)}`;
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }

    let created = 0, linked = 0, contracts = 0, duplicates = 0;
    for (const list of groups.values()) {
      const first = list[0];
      const label = `${first.cognome} ${first.nome}`;
      const found = findPerson(first.cognome, first.nome);
      if (found.length > 1) {
        skipped += list.length;
        issues.push({ type: 'Ambiguo', name: label, note: `${found.length} dipendenti con questo nome: ${list.length} contratti non importati` });
        continue;
      }

      let employeeId: number;
      if (found.length === 1) {
        employeeId = found[0].id; linked++;
      } else {
        if (!create_missing) {
          skipped += list.length;
          issues.push({ type: 'Non in anagrafica', name: label, note: `${list.length} contratti non importati (persona non creata)` });
          continue;
        }
        newPeople.push(label);
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
            note: "Creato dall'import massivo contratti interinali",
          })}
          RETURNING id`;
        employeeId = emp.id; created++;
        const list2 = byCognome.get(norm(first.cognome)) ?? [];
        list2.push({ id: emp.id, cognome: first.cognome, nome: longest });
        byCognome.set(norm(first.cognome), list2);
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
