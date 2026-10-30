// Lettura automatica degli Excel Ferrari da una cartella (senza IA).
// La cartella e' una cartella di rete (\\server\condivisione\...) letta con smbclient come le altre cartelle EDI,
// oppure un percorso locale. Ogni file si legge una volta (stesso nome + stessa data di modifica = saltato);
// la scheda entra come in «carica a mano»: le sigle nuove restano «da decidere» nelle Impostazioni.

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { db } from '../../db/client.js';
import { isUncPath, listUncFolderWithMtime, readUncFile } from '../../lib/smb-writer.js';
import { logger } from '../../lib/logger.js';
import { audit, caricaScheda, getConfig, setConfig, type Utente } from './service.js';

const MAX_FILE = 10 * 1024 * 1024;
const NOME_VALIDO = /^[^"';\\/\r\n]{1,200}\.xlsx?$/i;      // niente virgolette o separatori: il nome finisce in un comando smbclient
export const UTENTE_AUTO: Utente = { id: 0, username: 'cartella-auto' };

export interface CartellaConfig { percorso: string; auto: boolean; ora: number }

export async function leggiConfig(): Promise<CartellaConfig> {
  const ora = Number(await getConfig('cartella_ora'));
  return {
    percorso: (await getConfig('cartella_percorso')) ?? '',
    auto: (await getConfig('cartella_auto')) === 'true',
    ora: Number.isInteger(ora) && ora >= 0 && ora <= 23 ? ora : 4,
  };
}

export function validaPercorso(p: string): string {
  const v = p.trim();
  if (!v) return '';
  if (v.length > 300 || /[\r\n\0]/.test(v)) throw new Error('Percorso non valido');
  if (!isUncPath(v) && !v.startsWith('/')) throw new Error('Il percorso deve essere una cartella di rete (\\\\server\\cartella\\...) o un percorso assoluto');
  if (v.split(/[\\/]/).includes('..')) throw new Error('Percorso non valido');
  return v;
}

export async function salvaConfig(user: Utente, c: Partial<CartellaConfig>): Promise<CartellaConfig> {
  if (c.percorso !== undefined) await setConfig('cartella_percorso', validaPercorso(c.percorso));
  if (c.auto !== undefined) await setConfig('cartella_auto', c.auto ? 'true' : 'false');
  if (c.ora !== undefined) {
    if (!Number.isInteger(c.ora) || c.ora < 0 || c.ora > 23) throw new Error('Ora non valida (0-23)');
    await setConfig('cartella_ora', String(c.ora));
  }
  const nuova = await leggiConfig();
  await db.begin(async raw => audit(raw as unknown as Parameters<typeof audit>[0], user, 'cartella.config', 'config', null, { ...nuova }));
  return nuova;
}

interface Voce { nome: string; mtime: Date | null }

async function elenca(percorso: string): Promise<Voce[]> {
  if (isUncPath(percorso)) return (await listUncFolderWithMtime(percorso)).map(e => ({ nome: e.name, mtime: e.mtime }));
  const out: Voce[] = [];
  for (const e of await readdir(percorso, { withFileTypes: true })) {
    if (e.isFile()) out.push({ nome: e.name, mtime: (await stat(join(percorso, e.name))).mtime });
  }
  return out;
}

const leggi = (percorso: string, nome: string): Promise<Buffer> =>
  isUncPath(percorso) ? readUncFile(percorso, nome) : readFile(join(percorso, nome));

export interface DettaglioFile { nome: string; esito: 'nuovo' | 'duplicato' | 'quarantena' | 'errore'; commessa?: string; motivo?: string }
export interface EsitoRun {
  id: number; tipo: 'auto' | 'manuale'; trovati: number; invariati: number; nuovi: number; duplicati: number; quarantena: number; errori: number;
  dettaglio: DettaglioFile[]; errore: string | null;
}

let inCorso: { tipo: 'auto' | 'manuale'; avviato_at: string } | null = null;
export const statoLettura = () => inCorso;

/** Legge la cartella adesso. Una sola lettura alla volta: se ce n'e' una in corso, rifiuta. */
export async function leggiCartella(tipo: 'auto' | 'manuale', chi: string | null): Promise<EsitoRun> {
  if (inCorso) throw new Error('Una lettura della cartella e\' gia\' in corso');
  inCorso = { tipo, avviato_at: new Date().toISOString() };
  const esito: EsitoRun = { id: 0, tipo, trovati: 0, invariati: 0, nuovi: 0, duplicati: 0, quarantena: 0, errori: 0, dettaglio: [], errore: null };
  try {
    const { percorso } = await leggiConfig();
    if (!percorso) throw new Error('Cartella non configurata: scegli la cartella nelle Impostazioni');
    const [run] = await db<{ id: number }[]>`INSERT INTO ferrari_cartella_run (tipo, utente) VALUES (${tipo}, ${chi}) RETURNING id`;
    esito.id = run!.id;
    try {
      const visti = new Map((await db<{ nome: string; mtime: Date | null; esito: string }[]>`SELECT nome, mtime, esito FROM ferrari_cartella_visto`)
        .map(r => [r.nome, r] as const));
      for (const v of (await elenca(percorso)).filter(x => NOME_VALIDO.test(x.nome)).sort((a, b) => a.nome.localeCompare(b.nome))) {
        const prima = visti.get(v.nome);
        if (prima && prima.esito !== 'errore' && (prima.mtime?.getTime() ?? null) === (v.mtime?.getTime() ?? null)) { esito.invariati++; continue; }
        esito.trovati++;
        const d: DettaglioFile = { nome: v.nome, esito: 'errore' };
        let sha: string | null = null;
        try {
          const buf = await leggi(percorso, v.nome);
          if (buf.length > MAX_FILE) throw new Error('File troppo grande (max 10 MB)');
          const r = await caricaScheda(UTENTE_AUTO, v.nome, buf);
          const [f] = await db<{ sha256: string; commessa: string | null }[]>`SELECT sha256, commessa FROM ferrari_file WHERE id = ${r.id}`;
          sha = f?.sha256 ?? null;
          d.commessa = f?.commessa ?? undefined;
          if (r.duplicato) { d.esito = 'duplicato'; esito.duplicati++; }
          else if (r.stato === 'QUARANTENA') { d.esito = 'quarantena'; d.motivo = r.motivo; esito.quarantena++; }
          else { d.esito = 'nuovo'; esito.nuovi++; }
        } catch (e) {
          d.motivo = e instanceof Error ? e.message : String(e);
          esito.errori++;
        }
        esito.dettaglio.push(d);
        await db`
          INSERT INTO ferrari_cartella_visto (nome, mtime, sha256, esito, commessa)
          VALUES (${v.nome}, ${v.mtime}, ${sha}, ${d.esito}, ${d.commessa ?? null})
          ON CONFLICT (nome) DO UPDATE SET mtime = EXCLUDED.mtime, sha256 = EXCLUDED.sha256, esito = EXCLUDED.esito,
                                           commessa = EXCLUDED.commessa, visto_at = now()`;
      }
    } catch (e) {
      esito.errore = e instanceof Error ? e.message : String(e);
    }
    await db`
      UPDATE ferrari_cartella_run SET finito_at = now(), trovati = ${esito.trovati}, invariati = ${esito.invariati}, nuovi = ${esito.nuovi},
        duplicati = ${esito.duplicati}, quarantena = ${esito.quarantena}, errori = ${esito.errori},
        dettaglio = ${db.json(JSON.parse(JSON.stringify(esito.dettaglio.slice(0, 200))))}, errore = ${esito.errore}
      WHERE id = ${esito.id}`;
    if (esito.errore) logger.error(`[ferrari-cartella] ${esito.errore}`);
    else logger.info(`[ferrari-cartella] ${tipo}: ${esito.nuovi} nuove, ${esito.duplicati} duplicate, ${esito.quarantena} in quarantena, ${esito.errori} errori, ${esito.invariati} invariate`);
    return esito;
  } finally {
    inCorso = null;
  }
}

/** Ultime letture, per la pagina delle Impostazioni. */
export async function ultimeLetture(limite = 10) {
  return db`
    SELECT id, tipo, utente, avviato_at, finito_at, trovati, invariati, nuovi, duplicati, quarantena, errori, dettaglio, errore
    FROM ferrari_cartella_run ORDER BY id DESC LIMIT ${limite}`;
}

/** Chiamata dal cron ogni ora: legge solo se e' attivo e se e' l'ora scelta. */
export async function letturaNotturna(ora: number): Promise<EsitoRun | null> {
  const c = await leggiConfig();
  if (!c.auto || !c.percorso || c.ora !== ora) return null;
  return leggiCartella('auto', null);
}
