import chokidar                from 'chokidar';
import { extname }             from 'path';
import { db }                  from '../db/client.js';
import { logger }              from '../lib/logger.js';
import { extraerDatosDDT }     from '../ia/ia.service.js';
import {
  revisionManualPath,
  archivedPath,
  copiarARevisionManual,
  moverArchivo,
} from '../storage/storage.service.js';
import { recepcionesEmitter }  from '../gateway/recepciones-emitter.js';

// ─── procesarPDF ─────────────────────────────────────────────────────────────
// Called by the folder watcher OR by the future FTP server — same contract.

export async function procesarPDF(srcPath: string, escanerId = 'ingreso-01'): Promise<void> {
  logger.info(`[recepciones] Nuovo PDF: ${srcPath}`);

  try {
    // 1. Crea riga preliminare → ottieni id
    const [row] = await db`
      INSERT INTO recepciones (pdf_path, escaner_id)
      VALUES ('', ${escanerId})
      RETURNING id_ddt
    `;
    const id = row.id_ddt as number;

    // 2. Copia nel percorso revision_manual (nominato con l'id)
    const pendingPath = revisionManualPath(id);
    await copiarARevisionManual(srcPath, pendingPath);

    // 3. Aggiorna path in DB
    await db`UPDATE recepciones SET pdf_path = ${pendingPath} WHERE id_ddt = ${id}`;

    // 4. Prova estrazione con IA — fallback a revision_manual se fallisce
    let datos = null;
    try {
      datos = await extraerDatosDDT(pendingPath);
    } catch (e) {
      logger.warn(`[recepciones] IA fallita per id=${id}: ${e instanceof Error ? e.message : e}`);
    }

    if (datos?.confianza === 'alta') {
      // 5a. Archiviazione automatica
      const dest = archivedPath(id, datos.numero_ddt, datos.proveedor, datos.fecha, escanerId);
      await moverArchivo(pendingPath, dest);

      await db`
        UPDATE recepciones
        SET pdf_path      = ${dest},
            proveedor     = ${datos.proveedor},
            numero_ddt    = ${datos.numero_ddt},
            fecha_ddt     = ${datos.fecha},
            destinatario  = ${datos.destinatario},
            confianza_ia  = 'alta',
            estado        = 'confirmado',
            confirmado_at = NOW()
        WHERE id_ddt = ${id}
      `;

      const [recep] = await db`SELECT * FROM recepciones WHERE id_ddt = ${id}`;
      recepcionesEmitter.emit('evento', { tipo: 'recepcion:confirmada', data: recep });
      logger.info(`[recepciones] id=${id} archiviato automaticamente`);
    } else {
      // 5b. Revisione manuale
      await db`
        UPDATE recepciones
        SET proveedor     = ${datos?.proveedor    ?? null},
            numero_ddt    = ${datos?.numero_ddt   ?? null},
            fecha_ddt     = ${datos?.fecha        ?? null},
            destinatario  = ${datos?.destinatario ?? null},
            confianza_ia  = ${datos?.confianza    ?? null},
            estado        = 'revision_manual'
        WHERE id_ddt = ${id}
      `;

      const [recep] = await db`SELECT * FROM recepciones WHERE id_ddt = ${id}`;
      recepcionesEmitter.emit('evento', { tipo: 'recepcion:revision_manual', data: recep });
      logger.info(`[recepciones] id=${id} in revisione manuale`);
    }
  } catch (e) {
    logger.error(`[recepciones] Errore processando ${srcPath}: ${e instanceof Error ? e.message : e}`);
  }
}

// ─── startWatcher ────────────────────────────────────────────────────────────

export function startWatcher(): void {
  const folder = process.env.SCAN_FOLDER;
  if (!folder) {
    logger.warn('[recepciones] SCAN_FOLDER non configurata — watcher disabilitato');
    return;
  }

  const watcher = chokidar.watch(folder, {
    usePolling:      true,
    interval:        5_000,
    awaitWriteFinish: { stabilityThreshold: 3_000, pollInterval: 1_000 },
    ignoreInitial:   true,
    depth:           0,
  });

  watcher.on('add', (filePath: string) => {
    if (extname(filePath).toLowerCase() === '.pdf') {
      procesarPDF(filePath).catch(() => {});
    }
  });

  watcher.on('error', (err: unknown) => {
    logger.error(`[recepciones] Watcher error: ${err instanceof Error ? err.message : err}`);
  });

  logger.info(`[recepciones] Watcher attivo su: ${folder}`);
}
