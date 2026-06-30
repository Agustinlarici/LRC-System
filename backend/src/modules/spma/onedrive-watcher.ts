import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { runSpmaImport, type SpmaImportResult } from './import-logic.js';

interface SpFile {
  Name: string;
  UniqueId: string;
  TimeLastModified: string;
  ServerRelativeUrl: string;
}

export interface PollFileDetail {
  name:         string;
  result?:      SpmaImportResult;
  error?:       string;
  skippedHtml?: boolean;
}

export interface PollResult {
  count:   number;
  details: PollFileDetail[];
}

// Get anonymous FedAuth session from the sharing link + derive folder info
async function getShareContext(shareUrl: string): Promise<{
  fedAuth: string;
  host: string;
  webPath: string;
  folderPath: string;
} | null> {
  const r = await fetch(shareUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    redirect: 'manual',
  });

  if (r.status !== 302) {
    logger.warn({ status: r.status }, 'spma-onedrive: sharing URL non ha fatto redirect (link scaduto?)');
    return null;
  }

  const location = r.headers.get('location');
  if (!location) return null;

  const cookies: string[] = r.headers.getSetCookie
    ? r.headers.getSetCookie()
    : [r.headers.get('set-cookie') ?? ''];

  const fedAuth = cookies.find(c => c.startsWith('FedAuth='))?.split(';')[0];
  if (!fedAuth) {
    logger.warn('spma-onedrive: nessun FedAuth cookie — il link potrebbe non essere "Anyone with the link"');
    return null;
  }

  const locationUrl = new URL(location);
  const host = locationUrl.origin;

  // ?id= contains the server-relative folder path
  const idParam = locationUrl.searchParams.get('id');
  if (!idParam) {
    logger.warn({ location }, 'spma-onedrive: nessun parametro id nella redirect location');
    return null;
  }

  const folderPath = decodeURIComponent(idParam);
  // webPath = first two segments: /personal/alarici_str-automotive_com
  const webPath = '/' + folderPath.split('/').filter(Boolean).slice(0, 2).join('/');

  return { fedAuth, host, webPath, folderPath };
}

export async function pollOneDriveFolder(): Promise<PollResult> {
  const shareUrl = process.env.SPMA_ONEDRIVE_SHARE_URL;
  if (!shareUrl) return { count: 0, details: [] };

  let ctx: Awaited<ReturnType<typeof getShareContext>>;
  try {
    ctx = await getShareContext(shareUrl);
  } catch (err) {
    logger.error({ err }, 'spma-onedrive: errore ottenendo sessione SharePoint');
    return { count: 0, details: [] };
  }
  if (!ctx) return { count: 0, details: [] };

  const { fedAuth, host, webPath, folderPath } = ctx;

  // SharePoint REST API to list files in the folder
  const apiUrl =
    `${host}${webPath}/_api/web/GetFolderByServerRelativeUrl('${encodeURIComponent(folderPath)}')/Files` +
    `?$select=Name,UniqueId,TimeLastModified,ServerRelativeUrl`;

  let files: SpFile[];
  try {
    const r = await fetch(apiUrl, {
      headers: {
        'Accept': 'application/json;odata=verbose',
        'Cookie': fedAuth,
        'User-Agent': 'Mozilla/5.0',
      },
    });

    if (!r.ok) {
      logger.warn({ status: r.status, apiUrl }, 'spma-onedrive: impossibile listare cartella');
      return { count: 0, details: [] };
    }

    const json = await r.json() as { d: { results: SpFile[] } };
    files = json.d.results ?? [];
  } catch (err) {
    logger.error({ err }, 'spma-onedrive: errore chiamata REST API SharePoint');
    return { count: 0, details: [] };
  }

  const xlsxFiles = files.filter(f => /\.(xlsx|xls|csv)$/i.test(f.Name));
  if (xlsxFiles.length === 0) return { count: 0, details: [] };

  // Compare against already-processed files
  const processed = await db`SELECT file_id, last_modified FROM spma_onedrive_processed`;
  const processedMap = new Map(processed.map(r => [String(r.file_id), r.last_modified as Date | null]));

  const toProcess = xlsxFiles.filter(f => {
    const prev = processedMap.get(f.UniqueId);
    if (prev === undefined) return true; // never seen
    const modifiedAt = new Date(f.TimeLastModified);
    return prev === null || modifiedAt > prev; // re-import if updated
  });

  if (toProcess.length === 0) return { count: 0, details: [] };

  logger.info(`spma-onedrive: ${toProcess.length} file Excel da importare`);

  let imported = 0;
  const details: PollFileDetail[] = [];

  for (const file of toProcess) {
    const escapedPath  = file.ServerRelativeUrl.replace(/'/g, "''");
    const downloadUrl  = `${host}${webPath}/_api/web/GetFileByServerRelativeUrl('${escapedPath}')/$value`;
    try {
      const r = await fetch(downloadUrl, {
        headers: {
          Cookie:   fedAuth,
          'User-Agent': 'Mozilla/5.0',
          Accept:   'application/octet-stream',
        },
      });

      if (!r.ok) {
        logger.warn({ name: file.Name, status: r.status }, 'spma-onedrive: download fallito');
        details.push({ name: file.Name, error: `Download fallito (HTTP ${r.status})` });
        continue;
      }

      const contentType = r.headers.get('content-type') ?? 'unknown';
      const arrayBuf = await r.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      const firstBytes = buffer.slice(0, 4).toString('hex');

      logger.info({
        name:         file.Name,
        contentType,
        bufferBytes:  buffer.length,
        firstBytesHex: firstBytes,
      }, 'spma-onedrive: file scaricato');

      // Detect HTML response masquerading as 200 OK (e.g. SharePoint login redirect)
      if (contentType.includes('text/html') || firstBytes === '3c21444f' /* <!DO */ || firstBytes.startsWith('3c68') /* <h */ || firstBytes.startsWith('3c21') /* <! */) {
        logger.error({ name: file.Name, contentType, bufferBytes: buffer.length }, 'spma-onedrive: risposta HTML invece del file Excel — cookie FedAuth scaduto o non sufficiente');
        details.push({ name: file.Name, skippedHtml: true, error: 'Risposta HTML — cookie FedAuth scaduto o link non pubblico' });
        continue;
      }

      const result = await runSpmaImport(buffer, file.Name);

      const lastModified = new Date(file.TimeLastModified);
      await db`
        INSERT INTO spma_onedrive_processed (file_id, file_name, last_modified)
        VALUES (${file.UniqueId}, ${file.Name}, ${lastModified})
        ON CONFLICT (file_id) DO UPDATE SET
          file_name     = EXCLUDED.file_name,
          last_modified = EXCLUDED.last_modified,
          processed_at  = NOW()
      `;

      logger.info({
        name:           file.Name,
        total_rows:     result.total_rows_seen,
        upserts:        result.upserts,
        skipped:        result.skipped,
        deleted_stale:  result.deleted_stale,
        sheets:         result.sheets,
        warnings:       result.warnings.length > 0 ? result.warnings : undefined,
      }, 'spma-onedrive: importazione completata');

      details.push({ name: file.Name, result });
      imported++;
    } catch (err) {
      logger.error({ err, name: file.Name }, 'spma-onedrive: importazione fallita');
      details.push({ name: file.Name, error: (err as Error).message });
    }
  }
  return { count: imported, details };
}
