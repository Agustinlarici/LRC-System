import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { db } from '../../db/client.js';
import { requireModule, requireManage, type Env, type AuthUser } from '../../lib/auth.js';
import { parseBody } from '../../lib/validate.js';
import { auditLog } from '../../lib/audit.js';

export const hrDocumentRoutes = new Hono<Env>();

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const BLANK = '________________';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const CONSULTAZIONE_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: DOCX_MIME,
  doc: 'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

const EVENT_TYPES = [
  'assunzione', 'cambio_reparto', 'cambio_mansione', 'cambio_livello', 'cambio_capo',
  'trasferimento', 'promozione', 'cessazione', 'malattia', 'maternita_paternita',
  'infortunio', 'congedo', 'rientro', 'altro',
] as const;

// ─── Catalogo segnaposto ─────────────────────────────────────────────────────
// Nel .docx si scrive {nome}, {cognome}… (graffe singole). Tre gruppi:
//  - anagrafica: presi dalla scheda del dipendente
//  - evento: valori del cambiamento (precedente/nuovo); si precompilano dall'ultimo
//    evento di quel tipo in timeline e si possono correggere prima di generare
//  - retribuzione: dallo storico retributivo, richiedono il permesso hr_salary

interface Placeholder { key: string; label: string; group: 'anagrafica' | 'evento' | 'retribuzione' }

const PLACEHOLDERS: Placeholder[] = [
  { key: 'nome',               label: 'Nome',                               group: 'anagrafica' },
  { key: 'cognome',            label: 'Cognome',                            group: 'anagrafica' },
  { key: 'nome_completo',      label: 'Nome e cognome',                     group: 'anagrafica' },
  { key: 'matricola',          label: 'Matricola',                          group: 'anagrafica' },
  { key: 'codice_fiscale',     label: 'Codice fiscale',                     group: 'anagrafica' },
  { key: 'data_nascita',       label: 'Data di nascita',                    group: 'anagrafica' },
  { key: 'indirizzo',          label: 'Indirizzo',                          group: 'anagrafica' },
  { key: 'mansione',           label: 'Mansione attuale',                   group: 'anagrafica' },
  { key: 'livello',            label: 'Livello attuale',                    group: 'anagrafica' },
  { key: 'categoria',          label: 'Categoria',                          group: 'anagrafica' },
  { key: 'tipo_contratto',     label: 'Tipo di contratto',                  group: 'anagrafica' },
  { key: 'funzione_aziendale', label: 'Funzione aziendale',                 group: 'anagrafica' },
  { key: 'reparto',            label: 'Reparto',                            group: 'anagrafica' },
  { key: 'sede',               label: 'Sede / stabilimento attuale',        group: 'anagrafica' },
  { key: 'societa',            label: 'Società contrattuale',               group: 'anagrafica' },
  { key: 'responsabile',       label: 'Responsabile diretto',               group: 'anagrafica' },
  { key: 'data_assunzione',    label: 'Data di assunzione',                 group: 'anagrafica' },
  { key: 'data_odierna',       label: 'Data di oggi',                       group: 'anagrafica' },

  { key: 'data_decorrenza',    label: 'Data di decorrenza del cambio',      group: 'evento' },
  { key: 'mansione_precedente', label: 'Mansione precedente',               group: 'evento' },
  { key: 'mansione_nuova',     label: 'Mansione nuova',                     group: 'evento' },
  { key: 'livello_precedente', label: 'Livello precedente',                 group: 'evento' },
  { key: 'livello_nuovo',      label: 'Livello nuovo',                      group: 'evento' },
  { key: 'reparto_precedente', label: 'Reparto precedente',                 group: 'evento' },
  { key: 'reparto_nuovo',      label: 'Reparto nuovo',                      group: 'evento' },
  { key: 'sede_precedente',    label: 'Stabilimento precedente',            group: 'evento' },
  { key: 'sede_nuova',         label: 'Stabilimento nuovo',                 group: 'evento' },
  { key: 'superminimo',        label: 'Superminimo (da inserire a mano)',   group: 'evento' },

  { key: 'retribuzione_annua_lorda', label: 'RAL attuale (ultima in storico)', group: 'retribuzione' },
  { key: 'retribuzione_precedente',  label: 'RAL precedente',                  group: 'retribuzione' },
  { key: 'livello_retributivo',      label: 'Livello retributivo',             group: 'retribuzione' },
];

const PLACEHOLDER_KEYS = new Set(PLACEHOLDERS.map(p => p.key));
const SALARY_KEYS = new Set(PLACEHOLDERS.filter(p => p.group === 'retribuzione').map(p => p.key));
const EVENT_KEYS = PLACEHOLDERS.filter(p => p.group === 'evento').map(p => p.key);

// Coppia (precedente, nuovo) → tipo evento della timeline da cui precompilarla
const EVENT_PAIRS: { type: string; from: string; to: string }[] = [
  { type: 'cambio_mansione', from: 'mansione_precedente', to: 'mansione_nuova' },
  { type: 'cambio_livello',  from: 'livello_precedente',  to: 'livello_nuovo' },
  { type: 'cambio_reparto',  from: 'reparto_precedente',  to: 'reparto_nuovo' },
  { type: 'trasferimento',   from: 'sede_precedente',     to: 'sede_nuova' },
];

function hasSalaryView(user: AuthUser): boolean {
  if (user.role === 'admin') return true;
  const perm = user.permissions.find(p => p.module_key === 'hr_salary');
  return !!(perm?.can_view || perm?.can_manage);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseId(raw: string | undefined): number {
  const id = parseInt(raw ?? '', 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });
  return id;
}

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '';
  const iso = d instanceof Date ? d.toISOString() : String(d);
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '';
  return n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Data odierna AAAA-MM-GG nel fuso del server, per distinguere i file scaricati
function today(): string {
  return new Date().toLocaleDateString('sv-SE');
}

function extension(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  return i < 0 ? '' : fileName.slice(i + 1).toLowerCase();
}

function attachment(c: any, data: Buffer | Uint8Array, mime: string, fileName: string) {
  c.header('Content-Type', mime);
  c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  c.header('Cache-Control', 'no-store');
  return c.body(data as any);
}

// Testo dei file Word che possono contenere segnaposto (corpo, intestazioni, piè di pagina).
// Si tolgono i tag XML prima del regex perché Word spezza spesso "{nome}" in più run.
function extractPlaceholders(buffer: Buffer): string[] {
  const zip = new PizZip(buffer);
  const found = new Set<string>();
  for (const name of Object.keys(zip.files)) {
    if (!/^word\/(document|header\d*|footer\d*)\.xml$/.test(name)) continue;
    const text = zip.files[name].asText().replace(/<[^>]+>/g, '');
    for (const m of text.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) found.add(m[1]);
  }
  return [...found];
}

function renderDocx(buffer: Buffer, data: Record<string, string>): Buffer {
  let doc: Docxtemplater;
  try {
    doc = new Docxtemplater(new PizZip(buffer), {
      delimiters: { start: '{', end: '}' },
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => BLANK,
    });
    doc.render(data);
  } catch (err: any) {
    const first = err?.properties?.errors?.[0]?.properties?.explanation ?? err?.message ?? 'errore sconosciuto';
    throw new HTTPException(400, { message: `Il modello Word non è valido: ${first}` });
  }
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

type DocRow = {
  id: number; name: string; kind: string; event_type: string | null;
  file_name: string | null; file_mime: string | null; file_data: Buffer | null; placeholders: string[];
};

async function loadDocWithFile(id: number): Promise<DocRow> {
  const [row] = await db<DocRow[]>`
    SELECT id, name, kind, event_type, file_name, file_mime, file_data, placeholders
    FROM hr_document WHERE id = ${id}
  `;
  if (!row) throw new HTTPException(404, { message: 'Documento non trovato' });
  if (!row.file_data) throw new HTTPException(404, { message: 'Nessun file caricato per questo documento' });
  return row;
}

function safeBaseName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '').trim() || 'documento';
}

// ─── Elenco, catalogo segnaposto ─────────────────────────────────────────────

hrDocumentRoutes.get('/', requireModule('hr'), async (c) => {
  const rows = await db`
    SELECT id, name, description, kind, event_type, file_name, file_size,
           (file_data IS NOT NULL) AS has_file, placeholders, sort_order, is_active,
           uploaded_by_name, uploaded_at
    FROM hr_document
    ORDER BY sort_order, name
  `;
  return c.json(rows);
});

hrDocumentRoutes.get('/placeholders', requireModule('hr'), (c) => c.json(PLACEHOLDERS));

// ─── Gestione voci ───────────────────────────────────────────────────────────

const documentFieldsSchema = z.object({
  name:        z.string().min(1).max(150),
  description: z.string().max(255).optional().nullable(),
  kind:        z.enum(['modello', 'consultazione']).optional(),
  event_type:  z.enum([...EVENT_TYPES, 'aumento_retributivo']).optional().nullable(),
  sort_order:  z.number().int().optional(),
  is_active:   z.boolean().optional(),
});

const documentReturning = db`id, name, description, kind, event_type, file_name, file_size, (file_data IS NOT NULL) AS has_file, placeholders, sort_order, is_active, uploaded_by_name, uploaded_at`;

hrDocumentRoutes.post('/', requireManage('hr'), async (c) => {
  const body = await parseBody(c, documentFieldsSchema);
  const user = c.get('user');
  try {
    const [row] = await db`
      INSERT INTO hr_document ${db({ ...body, name: body.name.trim() })}
      RETURNING ${documentReturning}
    `;
    await auditLog({ userId: user.id, username: user.username, action: 'hr.document.create', entity: 'hr_document', entityId: row.id, details: { name: row.name } });
    return c.json(row, 201);
  } catch (err: any) {
    if (err?.code === '23505') throw new HTTPException(409, { message: `Esiste già un documento chiamato "${body.name.trim()}"` });
    throw err;
  }
});

hrDocumentRoutes.patch('/:id', requireManage('hr'), async (c) => {
  const id = parseId(c.req.param('id'));
  const body = await parseBody(c, documentFieldsSchema.partial());
  if (!Object.keys(body).length) throw new HTTPException(400, { message: 'Nessun campo da aggiornare' });
  if (body.name !== undefined) body.name = body.name.trim();
  const user = c.get('user');
  try {
    const [row] = await db`
      UPDATE hr_document SET ${db(body)} WHERE id = ${id}
      RETURNING ${documentReturning}
    `;
    if (!row) throw new HTTPException(404, { message: 'Documento non trovato' });
    await auditLog({ userId: user.id, username: user.username, action: 'hr.document.update', entity: 'hr_document', entityId: id, details: body });
    return c.json(row);
  } catch (err: any) {
    if (err?.code === '23505') throw new HTTPException(409, { message: 'Esiste già un documento con questo nome' });
    throw err;
  }
});

hrDocumentRoutes.delete('/:id', requireManage('hr'), async (c) => {
  const id = parseId(c.req.param('id'));
  const user = c.get('user');
  const [row] = await db`DELETE FROM hr_document WHERE id = ${id} RETURNING id, name`;
  if (!row) throw new HTTPException(404, { message: 'Documento non trovato' });
  await auditLog({ userId: user.id, username: user.username, action: 'hr.document.delete', entity: 'hr_document', entityId: id, details: { name: row.name } });
  return c.json({ ok: true });
});

// ─── File: upload / download ─────────────────────────────────────────────────

hrDocumentRoutes.put('/:id/file', requireManage('hr'), async (c) => {
  const id = parseId(c.req.param('id'));
  const user = c.get('user');
  const [doc] = await db`SELECT id, name, kind FROM hr_document WHERE id = ${id}`;
  if (!doc) throw new HTTPException(404, { message: 'Documento non trovato' });

  let form: FormData;
  try { form = await c.req.formData(); }
  catch { throw new HTTPException(400, { message: 'Richiesta non valida: atteso un file' }); }
  const file = form.get('file');
  if (!(file instanceof File)) throw new HTTPException(400, { message: 'Nessun file ricevuto' });
  if (file.size === 0) throw new HTTPException(400, { message: 'Il file è vuoto' });
  if (file.size > MAX_FILE_BYTES) throw new HTTPException(413, { message: 'File troppo grande (massimo 10 MB)' });

  const ext = extension(file.name);
  const buffer = Buffer.from(await file.arrayBuffer());

  let mime: string;
  let placeholders: string[] = [];
  let unknown: string[] = [];

  if (doc.kind === 'modello') {
    // Si guarda il contenuto, non l'estensione: un .docx rinominato .doc (o viceversa) è comune.
    // .docx = archivio ZIP ("PK"); .doc vero = contenitore OLE (D0 CF 11 E0).
    const isZip = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
    const isOle = buffer.length > 4 && buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;
    if (isOle) throw new HTTPException(400, { message: 'Questo file è nel formato Word vecchio (.doc): aprilo in Word e salvalo come .docx (File → Salva con nome), poi ricaricalo' });
    if (!isZip) throw new HTTPException(400, { message: 'Il file non sembra un documento Word .docx valido' });
    mime = DOCX_MIME;
    try {
      placeholders = extractPlaceholders(buffer);
      // Compilazione di prova: scova segnaposto spezzati o graffe non chiuse prima di salvare
      renderDocx(buffer, Object.fromEntries(placeholders.map(p => [p, BLANK])));
    } catch (err) {
      if (err instanceof HTTPException) throw err;
      throw new HTTPException(400, { message: 'Impossibile leggere il file: non sembra un .docx valido' });
    }
    unknown = placeholders.filter(p => !PLACEHOLDER_KEYS.has(p));
  } else {
    mime = CONSULTAZIONE_MIME[ext];
    if (!mime) throw new HTTPException(400, { message: `Formato .${ext || '?'} non supportato (usa PDF, Word, Excel o immagine)` });
  }

  await db`
    UPDATE hr_document SET
      file_name = ${file.name}, file_mime = ${mime}, file_size = ${buffer.length}, file_data = ${buffer},
      placeholders = ${placeholders}, uploaded_by_name = ${user.display_name}, uploaded_at = now()
    WHERE id = ${id}
  `;
  await auditLog({ userId: user.id, username: user.username, action: 'hr.document.upload', entity: 'hr_document', entityId: id, details: { name: doc.name, file: file.name } });

  const [row] = await db`SELECT ${documentReturning} FROM hr_document WHERE id = ${id}`;
  return c.json({ ...row, unknown_placeholders: unknown });
});

hrDocumentRoutes.get('/:id/file', requireModule('hr'), async (c) => {
  const doc = await loadDocWithFile(parseId(c.req.param('id')));
  return attachment(c, doc.file_data!, doc.file_mime ?? 'application/octet-stream', doc.file_name ?? safeBaseName(doc.name));
});

// Versione vuota: ogni segnaposto diventa una riga ________ da riempire a mano.
hrDocumentRoutes.get('/:id/blank', requireModule('hr'), async (c) => {
  const doc = await loadDocWithFile(parseId(c.req.param('id')));
  if (doc.kind !== 'modello') throw new HTTPException(400, { message: 'Solo i modelli hanno una versione vuota' });
  const out = renderDocx(doc.file_data!, Object.fromEntries(doc.placeholders.map(p => [p, BLANK])));
  return attachment(c, out, DOCX_MIME, `${safeBaseName(doc.name)} (vuoto) - ${today()}.docx`);
});

// ─── Generazione per un dipendente ───────────────────────────────────────────

const generateSchema = z.object({
  employee_id: z.number().int().positive(),
  event_id:    z.number().int().positive().optional().nullable(),
  // Valori inseriti a mano (solo chiavi del catalogo): vincono su quelli ricavati dal sistema
  values:      z.record(z.string().max(500)).optional(),
});

type EmpRow = Record<string, any>;

async function buildValues(employeeId: number, eventId: number | null | undefined, user: AuthUser, needsSalary: boolean) {
  const [emp] = await db<EmpRow[]>`
    SELECT e.nome, e.cognome, e.matricola, e.codice_fiscale, e.data_nascita, e.indirizzo,
           e.mansione, e.livello, e.categoria, e.tipo_contratto, e.funzione_aziendale,
           e.data_assunzione, d.name AS reparto, cc.name AS societa,
           (capo.nome || ' ' || capo.cognome) AS responsabile,
           (SELECT string_agg(pl.name, ', ' ORDER BY pl.name) FROM hr_plant pl WHERE pl.id = ANY(e.plant_ids)) AS sede
    FROM hr_employee e
    LEFT JOIN hr_department d ON d.id = e.reparto_id
    LEFT JOIN hr_contract_company cc ON cc.id = e.contract_company_id
    LEFT JOIN hr_employee capo ON capo.id = e.capo_id
    WHERE e.id = ${employeeId}
  `;
  if (!emp) throw new HTTPException(404, { message: 'Dipendente non trovato' });

  const v: Record<string, string> = {
    nome: emp.nome ?? '',
    cognome: emp.cognome ?? '',
    nome_completo: `${emp.nome ?? ''} ${emp.cognome ?? ''}`.trim(),
    matricola: emp.matricola ?? '',
    codice_fiscale: emp.codice_fiscale ?? '',
    data_nascita: fmtDate(emp.data_nascita),
    indirizzo: emp.indirizzo ?? '',
    mansione: emp.mansione ?? '',
    livello: emp.livello ?? '',
    categoria: emp.categoria ?? '',
    tipo_contratto: emp.tipo_contratto ?? '',
    funzione_aziendale: emp.funzione_aziendale ?? '',
    reparto: emp.reparto ?? '',
    sede: emp.sede ?? '',
    societa: emp.societa ?? '',
    responsabile: emp.responsabile ?? '',
    data_assunzione: fmtDate(emp.data_assunzione),
    data_odierna: fmtDate(new Date()),
  };

  // Valori dell'evento: quello indicato, altrimenti l'ultimo di ciascun tipo
  let decorrenza = '';
  if (eventId) {
    const [ev] = await db`
      SELECT event_type, event_date, from_value, to_value
      FROM hr_employee_event WHERE id = ${eventId} AND employee_id = ${employeeId}
    `;
    if (!ev) throw new HTTPException(404, { message: 'Evento non trovato per questo dipendente' });
    decorrenza = fmtDate(ev.event_date);
    const pair = EVENT_PAIRS.find(p => p.type === ev.event_type);
    if (pair) { v[pair.from] = ev.from_value ?? ''; v[pair.to] = ev.to_value ?? ''; }
  }
  for (const pair of EVENT_PAIRS) {
    if (v[pair.to] !== undefined) continue;
    const [ev] = await db`
      SELECT event_date, from_value, to_value FROM hr_employee_event
      WHERE employee_id = ${employeeId} AND event_type = ${pair.type}
      ORDER BY event_date DESC, created_at DESC LIMIT 1
    `;
    v[pair.from] = ev?.from_value ?? '';
    v[pair.to] = ev?.to_value ?? '';
    if (!decorrenza && ev) decorrenza = fmtDate(ev.event_date);
  }
  v.data_decorrenza = decorrenza;

  if (needsSalary) {
    if (!hasSalaryView(user)) throw new HTTPException(403, { message: 'Questo modello usa dati retributivi: serve il permesso sui dati retributivi' });
    const salaries = await db`
      SELECT livello_retributivo, retribuzione_annua_lorda::float8 AS ral
      FROM hr_employee_salary WHERE employee_id = ${employeeId}
      ORDER BY data_decorrenza DESC, id DESC LIMIT 2
    `;
    v.retribuzione_annua_lorda = fmtMoney(salaries[0]?.ral);
    v.retribuzione_precedente = fmtMoney(salaries[1]?.ral);
    v.livello_retributivo = salaries[0]?.livello_retributivo ?? '';
  }

  return { values: v, employee: emp };
}

// Valori ricavati dal sistema per un dipendente, così la UI li mostra prima di generare
// e l'utente può correggere quelli dell'evento. Solo i segnaposto presenti nel modello.
hrDocumentRoutes.get('/:id/preview/:employeeId', requireManage('hr'), async (c) => {
  const doc = await loadDocWithFile(parseId(c.req.param('id')));
  const employeeId = parseId(c.req.param('employeeId'));
  const eventId = c.req.query('event_id') ? parseId(c.req.query('event_id')) : null;
  const needsSalary = doc.placeholders.some(p => SALARY_KEYS.has(p));
  const { values } = await buildValues(employeeId, eventId, c.get('user'), needsSalary);
  const editable = EVENT_KEYS.filter(k => doc.placeholders.includes(k));
  return c.json({
    editable: editable.map(k => ({ key: k, label: PLACEHOLDERS.find(p => p.key === k)!.label, value: values[k] ?? '' })),
  });
});

hrDocumentRoutes.post('/:id/generate', requireManage('hr'), async (c) => {
  const doc = await loadDocWithFile(parseId(c.req.param('id')));
  if (doc.kind !== 'modello') throw new HTTPException(400, { message: 'Solo i modelli si possono compilare' });
  const body = await parseBody(c, generateSchema);
  const user = c.get('user');

  const needsSalary = doc.placeholders.some(p => SALARY_KEYS.has(p));
  const { values, employee } = await buildValues(body.employee_id, body.event_id, user, needsSalary);

  for (const [k, val] of Object.entries(body.values ?? {})) {
    if (EVENT_KEYS.includes(k)) values[k] = val.trim();
  }
  // Un valore vuoto resta una riga ________ da compilare a mano, mai un buco muto nel testo
  const data = Object.fromEntries(Object.entries(values).map(([k, val]) => [k, val || BLANK]));

  const out = renderDocx(doc.file_data!, data);
  await auditLog({ userId: user.id, username: user.username, action: 'hr.document.generate', entity: 'hr_document', entityId: doc.id, details: { employee_id: body.employee_id, event_id: body.event_id ?? null } });
  return attachment(c, out, DOCX_MIME, `${safeBaseName(doc.name)} - ${employee.cognome} ${employee.nome} - ${today()}.docx`);
});
