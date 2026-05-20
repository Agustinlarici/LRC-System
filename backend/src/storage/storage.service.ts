import { mkdir, copyFile, rename } from 'fs/promises';
import { dirname, join }          from 'path';

function docsRoot(): string {
  return process.env.DOCS_FOLDER ?? '/documentos';
}

function sanitize(s: string | null | undefined): string {
  if (!s) return 'sconosciuto';
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9\-_ .]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .substring(0, 40) || 'sconosciuto';
}

function dateParts(date: Date = new Date()): { y: string; m: string; d: string } {
  return {
    y: date.getFullYear().toString(),
    m: (date.getMonth() + 1).toString().padStart(2, '0'),
    d: date.getDate().toString().padStart(2, '0'),
  };
}

export function revisionManualPath(id: number): string {
  const { y, m, d } = dateParts();
  return join(docsRoot(), 'revision_manual', `${y}-${m}-${d}-${id}.pdf`);
}

export function archivedPath(
  id:        number,
  numeroDdt: string | null,
  proveedor: string | null,
  fecha:     string | null,
  escanerId: string,
): string {
  const docDate = fecha ? new Date(fecha) : new Date();
  const { y, m, d } = dateParts(docDate);
  const n    = sanitize(numeroDdt);
  const prov = sanitize(proveedor);
  return join(docsRoot(), y, m, d, escanerId, `${id}-${n}-${prov}.pdf`);
}

export async function copiarARevisionManual(srcPath: string, destPath: string): Promise<void> {
  await mkdir(dirname(destPath), { recursive: true });
  await copyFile(srcPath, destPath);
}

export async function moverArchivo(srcPath: string, destPath: string): Promise<void> {
  if (srcPath === destPath) return;
  await mkdir(dirname(destPath), { recursive: true });
  await rename(srcPath, destPath);
}