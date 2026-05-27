import { Hono }                  from 'hono';
import { HTTPException }         from 'hono/http-exception';
import { streamSSE }             from 'hono/streaming';
import { z }                     from 'zod';
import { createReadStream }      from 'fs';
import { stat }                  from 'fs/promises';
import { resolve }               from 'path';
import { Readable }              from 'stream';
import { db }                    from '../../db/client.js';
import { parseBody }             from '../../lib/validate.js';
import { recepcionesEmitter }    from '../../gateway/recepciones-emitter.js';
import { auditLog }              from '../../lib/audit.js';
import {
  archivedPath,
  moverArchivo,
} from '../../storage/storage.service.js';

const DOCS_ROOT = resolve(process.env.DOCS_FOLDER ?? '/documentos');

export const recepcionesRoutes = new Hono();

// ─── Schemas ─────────────────────────────────────────────────────────────────

const PatchSchema = z.object({
  proveedor:    z.string().min(1).optional(),
  numero_ddt:   z.string().min(1).optional(),
  fecha_ddt:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  destinatario: z.string().min(1).optional(),
});

// ─── GET / ───────────────────────────────────────────────────────────────────

recepcionesRoutes.get('/', async (c) => {
  const estado = c.req.query('estado');
  const fecha  = c.req.query('fecha') ?? new Date().toISOString().slice(0, 10);

  const rows = estado
    ? await db`
        SELECT * FROM recepciones
        WHERE creado_at::date = ${fecha}::date
          AND estado = ${estado}
        ORDER BY creado_at DESC
      `
    : await db`
        SELECT * FROM recepciones
        WHERE creado_at::date = ${fecha}::date
        ORDER BY creado_at DESC
      `;

  return c.json(rows);
});

// ─── PATCH /:id ──────────────────────────────────────────────────────────────

recepcionesRoutes.patch('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });

  const body = await parseBody(c, PatchSchema);

  const [existing] = await db`SELECT * FROM recepciones WHERE id_ddt = ${id}`;
  if (!existing) throw new HTTPException(404, { message: 'Recepcion non trovata' });

  const proveedor   = body.proveedor    ?? (existing.proveedor    as string | null);
  const numero_ddt  = body.numero_ddt   ?? (existing.numero_ddt   as string | null);
  const fecha_ddt   = body.fecha_ddt    ?? (existing.fecha_ddt    as string | null);
  const destinatario = body.destinatario ?? (existing.destinatario as string | null);

  // Move file from revision_manual to archive if needed
  let newPath = existing.pdf_path as string;
  if (existing.estado === 'revision_manual') {
    const dest = archivedPath(id, numero_ddt, proveedor, fecha_ddt, existing.escaner_id as string);
    try {
      await moverArchivo(newPath, dest);
      newPath = dest;
    } catch (e) {
      // File missing is non-fatal — keep existing path
    }
  }

  await db`
    UPDATE recepciones
    SET proveedor     = ${proveedor},
        numero_ddt    = ${numero_ddt},
        fecha_ddt     = ${fecha_ddt},
        destinatario  = ${destinatario},
        pdf_path      = ${newPath},
        estado        = 'confirmado',
        confirmado_at = NOW()
    WHERE id_ddt = ${id}
  `;

  const [updated] = await db`SELECT * FROM recepciones WHERE id_ddt = ${id}`;
  recepcionesEmitter.emit('evento', { tipo: 'recepcion:actualizada', data: updated });
  const ip = c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? c.req.header('x-real-ip') ?? null;
  auditLog({ action: 'recepcion_confirmada', entity: 'recepciones', entityId: id, ip, details: { numero_ddt, proveedor } });

  return c.json(updated);
});

// ─── GET /:id/pdf ─────────────────────────────────────────────────────────────

recepcionesRoutes.get('/:id/pdf', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) throw new HTTPException(400, { message: 'ID non valido' });

  const [row] = await db`SELECT pdf_path FROM recepciones WHERE id_ddt = ${id}`;
  if (!row) throw new HTTPException(404, { message: 'Recepcion non trovata' });

  const pdfPath     = row.pdf_path as string;
  const resolvedPath = resolve(pdfPath);
  if (!resolvedPath.startsWith(DOCS_ROOT + '/') && resolvedPath !== DOCS_ROOT) {
    throw new HTTPException(403, { message: 'Accesso negato' });
  }
  try {
    await stat(resolvedPath);
  } catch {
    throw new HTTPException(404, { message: 'File PDF non trovato' });
  }

  const nodeStream = createReadStream(resolvedPath);
  const webStream  = Readable.toWeb(nodeStream) as ReadableStream;

  return new Response(webStream, {
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': `inline; filename="recepcion-${id}.pdf"`,
    },
  });
});

// ─── GET /sse ────────────────────────────────────────────────────────────────

recepcionesRoutes.get('/sse', (c) => {
  return streamSSE(c, async (stream) => {
    let aborted = false;
    type Waiter = { resolve: () => void };
    const queue: Array<Record<string, unknown>> = [];
    let waiter: Waiter | null = null;

    const enqueue = (ev: Record<string, unknown>) => {
      queue.push(ev);
      const w = waiter;
      waiter = null;
      w?.resolve();
    };

    recepcionesEmitter.on('evento', enqueue);

    stream.onAbort(() => {
      aborted = true;
      recepcionesEmitter.off('evento', enqueue);
      waiter?.resolve();
    });

    try {
      await stream.writeSSE({ event: 'connected', data: '{}' });
    } catch {
      aborted = true;
    }

    while (!aborted) {
      if (queue.length === 0) {
        await new Promise<void>(r => { waiter = { resolve: r }; });
      }
      if (aborted) break;
      const ev = queue.shift();
      if (!ev) continue;
      try {
        await stream.writeSSE({ event: ev.tipo as string, data: JSON.stringify(ev) });
      } catch {
        break;
      }
    }

    recepcionesEmitter.off('evento', enqueue);
  });
});
