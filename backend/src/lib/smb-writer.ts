import { join } from 'path';
import { writeFile, readFile, unlink } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

const execFileAsync = promisify(execFile);

export function isUncPath(p: string): boolean {
  return p.startsWith('\\\\') || p.startsWith('//');
}

export function parseUnc(uncFolder: string): { share: string; subPath: string } {
  const norm = uncFolder.replace(/\\/g, '/').replace(/^\/\//, '');
  const parts = norm.split('/').filter(Boolean);
  if (parts.length < 2) throw new Error(`Percorso UNC non valido: ${uncFolder}`);
  const [server, shareName, ...rest] = parts;
  return {
    share:   `\\\\${server}\\${shareName}`,
    subPath: rest.join('\\'),
  };
}

// ─── smbclient helpers ────────────────────────────────────────────────────────

function smbClientArgs(smbShare: string, command: string): string[] {
  const user   = process.env.SMB_USER   ?? '';
  const pass   = process.env.SMB_PASS   ?? '';
  const domain = process.env.SMB_DOMAIN ?? '';
  const args = [smbShare, '-U', `${user}%${pass}`];
  if (domain) args.push('-W', domain);
  args.push('-c', command);
  return args;
}

interface SmbEntry { name: string; mtime: Date | null; }

function parseSmbLs(output: string): SmbEntry[] {
  const entries: SmbEntry[] = [];
  for (const line of output.split('\n')) {
    // smbclient ls: "  NAME    [DRHAS…]    size    weekday mon day HH:MM:SS year"
    const m = line.match(/^\s+(.+?)\s{2,}[DRHAS\- ]+\s+\d+\s+(.*?)\s*$/);
    if (!m) continue;
    const name = m[1].trim();
    if (name === '.' || name === '..') continue;
    const dateStr = m[2]?.trim() ?? '';
    const d = dateStr ? new Date(dateStr) : null;
    entries.push({ name, mtime: d && !isNaN(d.getTime()) ? d : null });
  }
  return entries;
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function smbLs(uncFolder: string): Promise<SmbEntry[]> {
  const { share, subPath } = parseUnc(uncFolder);
  const smbShare  = share.replace(/\\/g, '/');
  const remotePath = subPath.replace(/\\/g, '/');
  const cmd = remotePath ? `ls "${remotePath}/*"` : 'ls';
  try {
    const { stdout } = await execFileAsync('smbclient', smbClientArgs(smbShare, cmd));
    return parseSmbLs(stdout);
  } catch (err: unknown) {
    const e = err as Error & { stderr?: string };
    throw new Error(`Impossibile listare "${uncFolder}": ${e.stderr?.trim() || e.message}`);
  }
}

export async function listUncFolder(uncFolder: string): Promise<string[]> {
  return (await smbLs(uncFolder)).map(e => e.name);
}

export async function listUncFolderWithMtime(uncFolder: string): Promise<SmbEntry[]> {
  return smbLs(uncFolder);
}

export async function readUncFile(uncFolder: string, filename: string): Promise<Buffer> {
  const { share, subPath } = parseUnc(uncFolder);
  const smbShare = share.replace(/\\/g, '/');
  const remotePath = subPath
    ? `${subPath.replace(/\\/g, '/')}/${filename}`
    : filename;
  const tmpFile = join(tmpdir(), `smb_${randomBytes(8).toString('hex')}_${filename}`);

  try {
    await execFileAsync('smbclient', smbClientArgs(smbShare, `get "${remotePath}" "${tmpFile}"`));
    return await readFile(tmpFile);
  } catch (err: unknown) {
    const e = err as Error & { stderr?: string };
    throw new Error(`Impossibile leggere "${uncFolder}/${filename}": ${e.stderr?.trim() || e.message}`);
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}

// content può essere testo (es. file EDI) o binario (es. PDF) — l'encoding si applica
// solo alle stringhe, i Buffer vengono scritti così come sono.
export async function writeEdiFile(
  outputFolder: string,
  filename: string,
  content: string | Buffer,
): Promise<void> {
  if (isUncPath(outputFolder)) {
    const { share, subPath } = parseUnc(outputFolder);
    const smbShare   = share.replace(/\\/g, '/');
    const remotePath = (subPath ? `${subPath}\\${filename}` : filename).replace(/\\/g, '/');
    const tmpFile    = join(tmpdir(), `smb_${randomBytes(8).toString('hex')}_${filename}`);

    try {
      await writeFile(tmpFile, typeof content === 'string' ? Buffer.from(content, 'utf8') : content);
      await execFileAsync('smbclient', smbClientArgs(smbShare, `put "${tmpFile}" "${remotePath}"`));
    } catch (err: unknown) {
      const e = err as Error & { stderr?: string };
      throw new Error(`Impossibile scrivere "${outputFolder}/${filename}": ${e.stderr?.trim() || e.message}`);
    } finally {
      await unlink(tmpFile).catch(() => {});
    }
  } else {
    await writeFile(join(outputFolder, filename), content);
  }
}
