import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { runSpmaImport, type SpmaImportResult } from './import-logic.js';

export interface PollFileDetail {
  name:    string;
  result?: SpmaImportResult;
  error?:  string;
}

export interface PollResult {
  count:   number;
  details: PollFileDetail[];
}

interface GraphItem {
  name:                              string;
  id:                                string;
  lastModifiedDateTime:              string;
  file?:                             object;
  '@microsoft.graph.downloadUrl'?:   string;
}

function sharingUrlToGraphId(shareUrl: string): string {
  // Microsoft Graph encoding: base64url("u!{url}") without padding
  return Buffer.from(`u!${shareUrl}`).toString('base64url').replace(/=/g, '');
}

export async function pollOneDriveFolder(): Promise<PollResult> {
  const shareUrl = process.env.SPMA_ONEDRIVE_SHARE_URL;
  if (!shareUrl) return { count: 0, details: [] };

  const shareId  = sharingUrlToGraphId(shareUrl);
  const graphUrl = `https://graph.microsoft.com/v1.0/shares/${shareId}/root/children` +
    `?$select=name,id,lastModifiedDateTime,file,@microsoft.graph.downloadUrl`;

  let items: GraphItem[];
  try {
    const r = await fetch(graphUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
    });

    if (!r.ok) {
      const body = await r.text().catch(() => '');
      logger.warn({ status: r.status, body: body.slice(0, 200) }, 'spma-onedrive: Graph API listing fallito');
      return { count: 0, details: [] };
    }

    const json = await r.json() as { value: GraphItem[] };
    items = json.value ?? [];
  } catch (err) {
    logger.error({ err }, 'spma-onedrive: errore chiamata Graph API');
    return { count: 0, details: [] };
  }

  const xlsxItems = items.filter(i => i.file && /\.(xlsx|xls|csv)$/i.test(i.name));
  if (xlsxItems.length === 0) return { count: 0, details: [] };

  // Compare against already-processed files
  const processed    = await db`SELECT file_id, last_modified FROM spma_onedrive_processed`;
  const processedMap = new Map(processed.map(r => [String(r.file_id), r.last_modified as Date | null]));

  const toProcess = xlsxItems.filter(item => {
    const prev = processedMap.get(item.id);
    if (prev === undefined) return true;
    const modifiedAt = new Date(item.lastModifiedDateTime);
    return prev === null || modifiedAt > prev;
  });

  if (toProcess.length === 0) return { count: 0, details: [] };

  logger.info(`spma-onedrive: ${toProcess.length} file Excel da importare (Graph API)`);

  let imported = 0;
  const details: PollFileDetail[] = [];

  for (const item of toProcess) {
    const downloadUrl = item['@microsoft.graph.downloadUrl'];
    if (!downloadUrl) {
      logger.warn({ name: item.name }, 'spma-onedrive: downloadUrl assente — verificare permessi link');
      details.push({ name: item.name, error: 'Download URL non disponibile — il link OneDrive potrebbe essere "Solo visualizzazione" senza download' });
      continue;
    }

    try {
      const r = await fetch(downloadUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });

      if (!r.ok) {
        logger.warn({ name: item.name, status: r.status }, 'spma-onedrive: download fallito');
        details.push({ name: item.name, error: `Download fallito (HTTP ${r.status})` });
        continue;
      }

      const buffer = Buffer.from(await r.arrayBuffer());
      logger.info({ name: item.name, bufferBytes: buffer.length }, 'spma-onedrive: file scaricato');

      const result = await runSpmaImport(buffer, item.name);

      await db`
        INSERT INTO spma_onedrive_processed (file_id, file_name, last_modified)
        VALUES (${item.id}, ${item.name}, ${new Date(item.lastModifiedDateTime)})
        ON CONFLICT (file_id) DO UPDATE SET
          file_name     = EXCLUDED.file_name,
          last_modified = EXCLUDED.last_modified,
          processed_at  = NOW()
      `;

      logger.info({
        name:          item.name,
        total_rows:    result.total_rows_seen,
        upserts:       result.upserts,
        skipped:       result.skipped,
        deleted_stale: result.deleted_stale,
        warnings:      result.warnings.length > 0 ? result.warnings : undefined,
      }, 'spma-onedrive: importazione completata');

      details.push({ name: item.name, result });
      imported++;
    } catch (err) {
      logger.error({ err, name: item.name }, 'spma-onedrive: importazione fallita');
      details.push({ name: item.name, error: (err as Error).message });
    }
  }

  return { count: imported, details };
}
