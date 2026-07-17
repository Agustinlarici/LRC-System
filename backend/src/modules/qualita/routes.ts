import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { requireModule, requireManage, type Env } from '../../lib/auth.js';
import { detectQualitaImageExt } from '../../lib/mime-check.js';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { join, extname } from 'path';
import { randomBytes } from 'crypto';

export const qualitaRoutes = new Hono<Env>();

// ─── Upload directory ───────────────────────────────────────────────────────
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? join(process.env.UPLOAD_DIR, 'qualita')
  : join(process.cwd(), 'uploads', 'qualita');

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function contentTypeFor(filename: string): string {
  const ext = extname(filename).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

async function saveUpload(file: File): Promise<{ filename: string; originalName: string }> {
  if (file.size > MAX_FILE_SIZE) throw new HTTPException(400, { message: 'File troppo grande (max 10MB)' });
  const bytes = await file.arrayBuffer();
  const buf = Buffer.from(bytes);
  // L'estensione salvata deriva dai byte reali del file, non dal nome dichiarato dal
  // browser — altrimenti un'immagine incollata dagli appunti o rinominata (es. PNG con
  // nome "foto.jpg") verrebbe salvata con l'estensione sbagliata e servita con un
  // Content-Type che non corrisponde ai byte reali, facendola apparire rotta nel browser.
  const ext = detectQualitaImageExt(buf);
  await mkdir(UPLOAD_DIR, { recursive: true });
  const filename = `${randomBytes(16).toString('hex')}${ext}`;
  await writeFile(join(UPLOAD_DIR, filename), buf);
  return { filename, originalName: file.name };
}

async function serveFile(c: any, filename: string) {
  const data = await readFile(join(UPLOAD_DIR, filename));
  c.header('Content-Type', contentTypeFor(filename));
  return c.body(data);
}

// ─── Componenti: catalogo immagini di riferimento ───────────────────────────

qualitaRoutes.get('/components', requireModule('qualita'), async (c) => {
  const rows = await db`
    SELECT id, name, code, is_active, sort_order, created_by_name, created_at
    FROM qualita_component
    ORDER BY sort_order, name
  `;
  return c.json(rows);
});

qualitaRoutes.get('/components/:id/image', requireModule('qualita'), async (c) => {
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });

  const [component] = await db`SELECT image_path FROM qualita_component WHERE id = ${id}`;
  if (!component) throw new HTTPException(404, { message: 'Componente non trovato' });

  return serveFile(c, component.image_path);
});

const componentFieldsSchema = z.object({
  name:       z.string().min(1).max(150),
  code:       z.string().max(50).optional(),
  sort_order: z.number().int().optional(),
});

function parseMultipartFields<T>(form: FormData, fileKeys: string[], schema: z.ZodType<T>): T {
  const raw: Record<string, any> = {};
  for (const [k, v] of form.entries()) {
    if (fileKeys.includes(k)) continue;
    if (k === 'sort_order' && typeof v === 'string' && v !== '') raw[k] = parseInt(v, 10);
    else raw[k] = v;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ') });
  }
  return parsed.data;
}

qualitaRoutes.post('/components', requireManage('qualita'), async (c) => {
  const contentType = c.req.header('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    throw new HTTPException(400, { message: 'Richiesto multipart/form-data' });
  }
  const form = await c.req.formData();
  const fields = parseMultipartFields(form, ['image'], componentFieldsSchema);

  const imageFile = form.get('image') as File | null;
  if (!imageFile || imageFile.size === 0) throw new HTTPException(400, { message: 'Immagine richiesta' });
  const { filename } = await saveUpload(imageFile);

  const user = c.get('user');
  const [component] = await db`
    INSERT INTO qualita_component ${db({
      name: fields.name,
      code: fields.code ?? null,
      image_path: filename,
      sort_order: fields.sort_order ?? 0,
      created_by_user_id: user.id,
      created_by_name: user.display_name,
    })}
    RETURNING id, name, code, is_active, sort_order, created_by_name, created_at
  `;
  return c.json(component, 201);
});

const componentPatchSchema = z.object({
  name:       z.string().min(1).max(150).optional(),
  code:       z.string().max(50).optional(),
  sort_order: z.number().int().optional(),
  is_active:  z.enum(['true', 'false']).optional(),
});

qualitaRoutes.patch('/components/:id', requireManage('qualita'), async (c) => {
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });

  const [existing] = await db`SELECT id FROM qualita_component WHERE id = ${id}`;
  if (!existing) throw new HTTPException(404, { message: 'Componente non trovato' });

  const contentType = c.req.header('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    throw new HTTPException(400, { message: 'Richiesto multipart/form-data' });
  }
  const form = await c.req.formData();
  const fields = parseMultipartFields(form, ['image'], componentPatchSchema);

  const updates: Record<string, any> = {};
  if (fields.name       !== undefined) updates.name = fields.name;
  if (fields.code       !== undefined) updates.code = fields.code;
  if (fields.sort_order !== undefined) updates.sort_order = fields.sort_order;
  if (fields.is_active  !== undefined) updates.is_active = fields.is_active === 'true';

  let warning: string | null = null;
  const imageFile = form.get('image') as File | null;
  if (imageFile && imageFile.size > 0) {
    const [{ count }] = await db`SELECT COUNT(*) AS count FROM qualita_report WHERE component_id = ${id}`;
    if (parseInt(count, 10) > 0) {
      warning = 'Questo componente ha già segnalazioni registrate: se la nuova immagine ha dimensioni diverse, i disegni storici potrebbero non risultare più allineati.';
    }
    const { filename } = await saveUpload(imageFile);
    updates.image_path = filename;
  }

  if (!Object.keys(updates).length) throw new HTTPException(400, { message: 'Nessun campo da aggiornare' });

  const [component] = await db`
    UPDATE qualita_component SET ${db(updates)} WHERE id = ${id}
    RETURNING id, name, code, is_active, sort_order, created_by_name, created_at
  `;
  return c.json(warning ? { ...component, warning } : component);
});

// ─── Segnalazioni (marcature difetti) ───────────────────────────────────────

const reportFieldsSchema = z.object({
  component_id: z.number().int().positive(),
  commessa:     z.string().min(1).max(100),
  defect_type:  z.string().max(100).optional(),
  severity:     z.enum(['bassa', 'media', 'alta']).optional(),
  note:         z.string().optional(),
});

qualitaRoutes.post('/reports', requireModule('qualita'), async (c) => {
  const contentType = c.req.header('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    throw new HTTPException(400, { message: 'Richiesto multipart/form-data' });
  }
  const form = await c.req.formData();
  const raw: Record<string, any> = {};
  for (const [k, v] of form.entries()) {
    if (k === 'drawing' || k === 'photo') continue;
    if (k === 'component_id' && typeof v === 'string') raw[k] = parseInt(v, 10);
    else raw[k] = v;
  }
  const parsed = reportFieldsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ') });
  }
  const fields = parsed.data;

  const [component] = await db`SELECT id FROM qualita_component WHERE id = ${fields.component_id}`;
  if (!component) throw new HTTPException(400, { message: 'Componente non valido' });

  const drawingFile = form.get('drawing') as File | null;
  if (!drawingFile || drawingFile.size === 0) throw new HTTPException(400, { message: 'Disegno richiesto' });
  const { filename: drawingPath } = await saveUpload(drawingFile);

  let photoPath: string | null = null;
  let photoName: string | null = null;
  const photoFile = form.get('photo') as File | null;
  if (photoFile && photoFile.size > 0) {
    const saved = await saveUpload(photoFile);
    photoPath = saved.filename;
    photoName = saved.originalName;
  }

  const user = c.get('user');
  const [report] = await db`
    INSERT INTO qualita_report ${db({
      component_id: fields.component_id,
      commessa: fields.commessa.trim(),
      drawing_path: drawingPath,
      defect_type: fields.defect_type ?? null,
      severity: fields.severity ?? null,
      note: fields.note ?? null,
      photo_path: photoPath,
      photo_name: photoName,
      created_by_user_id: user.id,
      created_by_name: user.display_name,
    })}
    RETURNING *
  `;
  return c.json(report, 201);
});

qualitaRoutes.get('/reports', requireModule('qualita'), async (c) => {
  const { commessa, component_id } = c.req.query();
  if (!commessa) throw new HTTPException(400, { message: 'Parametro commessa richiesto' });

  const componentFilter = component_id
    ? db`AND r.component_id = ${parseInt(component_id, 10)}`
    : db``;

  const rows = await db`
    SELECT r.*, cc.name AS component_name, cc.code AS component_code
    FROM qualita_report r
    JOIN qualita_component cc ON cc.id = r.component_id
    WHERE r.commessa ILIKE ${'%' + commessa.trim() + '%'} ${componentFilter}
    ORDER BY r.created_at ASC
  `;
  return c.json(rows);
});

qualitaRoutes.get('/reports/:id/drawing', requireModule('qualita'), async (c) => {
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });

  const [report] = await db`SELECT drawing_path FROM qualita_report WHERE id = ${id}`;
  if (!report) throw new HTTPException(404, { message: 'Segnalazione non trovata' });

  return serveFile(c, report.drawing_path);
});

qualitaRoutes.get('/reports/:id/photo', requireModule('qualita'), async (c) => {
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });

  const [report] = await db`SELECT photo_path FROM qualita_report WHERE id = ${id}`;
  if (!report?.photo_path) throw new HTTPException(404, { message: 'Nessuna foto' });

  return serveFile(c, report.photo_path);
});
