import { join } from 'path';
import { writeFile } from 'fs/promises';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const SMB2 = require('@marsaud/smb2') as new (cfg: {
  share: string; username: string; password: string; domain: string; autoCloseTimeout?: number;
}) => {
  writeFile(path: string, data: string, opts: { encoding: string }): Promise<void>;
  close(): void;
};

export function isUncPath(p: string): boolean {
  return p.startsWith('\\\\') || p.startsWith('//');
}

function parseUnc(uncFolder: string): { share: string; subPath: string } {
  const norm = uncFolder.replace(/\\/g, '/').replace(/^\/\//, '');
  const parts = norm.split('/').filter(Boolean);
  if (parts.length < 2) throw new Error(`Percorso UNC non valido: ${uncFolder}`);
  const [server, shareName, ...rest] = parts;
  return {
    share:   `\\\\${server}\\${shareName}`,
    subPath: rest.join('\\'),
  };
}

export async function writeEdiFile(
  outputFolder: string,
  filename: string,
  content: string,
): Promise<void> {
  if (isUncPath(outputFolder)) {
    const { share, subPath } = parseUnc(outputFolder);
    const remotePath = subPath ? `${subPath}\\${filename}` : filename;

    const smb = new SMB2({
      share,
      username: process.env.SMB_USER    ?? '',
      password: process.env.SMB_PASS    ?? '',
      domain:   process.env.SMB_DOMAIN  ?? '',
      autoCloseTimeout: 0,
    });
    try {
      await smb.writeFile(remotePath, content, { encoding: 'utf8' });
    } finally {
      smb.close();
    }
  } else {
    await writeFile(join(outputFolder, filename), content, 'utf-8');
  }
}
