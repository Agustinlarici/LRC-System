import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { runSpmaImport } from './import-logic.js';

interface SpFile {
  Name: string;
  UniqueId: string;
  TimeLastModified: string;
  ServerRelativeUrl: string;
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

export async function pollOneDriveFolder(): Promise<void> {
  const shareUrl = process.env.SPMA_ONEDRIVE_SHARE_URL;
  if (!shareUrl) return;

  let ctx: Awaited<ReturnType<typeof getShareContext>>;
  try {
    ctx = await getShareContext(shareUrl);
  } catch (err) {
    logger.error({ err }, 'spma-onedrive: errore ottenendo sessione SharePoint');
    return;
  }
  if (!ctx) return;

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
      return;
    }

    const json = await r.json() as { d: { results: SpFile[] } };
    files = json.d.results ?? [];
  } catch (err) {
    logger.error({ err }, 'spma-onedrive: errore chiamata REST API SharePoint');
    return;
  }

  const xlsxFiles = files.filter(f => /\.(xlsx|xls|csv)$/i.test(f.Name));
  if (xlsxFiles.length === 0) return;

  // Compare against already-processed files
  const processed = await db`SELECT file_id, last_modified FROM spma_onedrive_processed`;
  const processedMap = new Map(processed.map(r => [String(r.file_id), r.last_modified as Date | null]));

  const toProcess = xlsxFiles.filter(f => {
    const prev = processedMap.get(f.UniqueId);
    if (prev === undefined) return true; // never seen
    const modifiedAt = new Date(f.TimeLastModified);
    return prev === null || modifiedAt > prev; // re-import if updated
  });

  if (toProcess.length === 0) return;

  logger.info(`spma-onedrive: ${toProcess.length} file Excel da importare`);

  for (const file of toProcess) {
    const downloadUrl = host + file.ServerRelativeUrl;
    try {
      const r = await fetch(downloadUrl, {
        headers: { Cookie: fedAuth, 'User-Agent': 'Mozilla/5.0' },
      });

      if (!r.ok) {
        logger.warn({ name: file.Name, status: r.status }, 'spma-onedrive: download fallito');
        continue;
      }

      const buffer = Buffer.from(await r.arrayBuffer());
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
        name:          file.Name,
        upserts:       result.upserts,
        skipped:       result.skipped,
        deleted_stale: result.deleted_stale,
      }, 'spma-onedrive: importazione completata');
    } catch (err) {
      logger.error({ err, name: file.Name }, 'spma-onedrive: importazione fallita');
    }
  }
}
