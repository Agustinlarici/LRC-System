// PC IA FINTA para los tests: implementa el contrato v1 (firma, nonce, idempotencia, avance por pasos) con guiones
// configurables para provocar fallos. Es solo para pruebas: nunca se usa fuera de ellas.

import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { verificaFirma } from '../firma.js';
import { MetaAnalisiSchema, SnapshotSigleSchema, type MetaAnalisi, type Risultato } from '../contratto.js';
import { risultato as risultatoDemo } from './fixtures-ia-v1.js';

export interface Scenario {
  secret: string;
  ollama: boolean;
  /** Cuantas consultas hacen falta antes de decir «fatto». */
  passiPrimaDelFinire: number;
  /** Si se pone, el trabajo termina en error con este codigo. */
  fallaAnalisi?: { codice: string; messaggio: string };
  /** Respuesta tardia (ms) para probar timeouts. */
  ritardoMs: number;
  /** Responde con una pagina HTML (PC equivocada). */
  rispostaNonJson: boolean;
  /** Puerto fijo (por defecto uno libre al azar). */
  porta?: number;
  risultato: (file: Buffer, meta: MetaAnalisi) => Risultato;
}

export interface RichiestaVista { metodo: string; percorso: string; meta?: MetaAnalisi; dimFile?: number }

export interface FakePcIa {
  url: string;
  scenario: Scenario;
  richieste: RichiestaVista[];
  sigleNote: Set<string>;
  chiudi(): Promise<void>;
}

function leggiCorpo(req: IncomingMessage): Promise<Buffer> {
  return new Promise((ok, ko) => {
    const pezzi: Buffer[] = [];
    req.on('data', (c: Buffer) => pezzi.push(c));
    req.on('end', () => ok(Buffer.concat(pezzi)));
    req.on('error', ko);
  });
}

/** Multipart minimo: cerca le parti `meta` e `file` per nome. */
function parti(corpo: Buffer, tipo: string): Map<string, Buffer> {
  const b = /boundary=(.+)$/.exec(tipo)?.[1];
  const out = new Map<string, Buffer>();
  if (!b) return out;
  const sep = Buffer.from(`--${b}`);
  let da = corpo.indexOf(sep);
  while (da !== -1) {
    const fine = corpo.indexOf(sep, da + sep.length);
    if (fine === -1) break;
    const blocco = corpo.subarray(da + sep.length + 2, fine - 2);                 // salta \r\n iniziale e \r\n finale
    const taglio = blocco.indexOf('\r\n\r\n');
    const testa = blocco.subarray(0, taglio).toString();
    const nome = /name="([^"]+)"/.exec(testa)?.[1];
    if (nome) out.set(nome, blocco.subarray(taglio + 4));
    da = fine;
  }
  return out;
}

export async function avviaFakePcIa(parziale: Partial<Scenario> & { secret: string }): Promise<FakePcIa> {
  const scenario: Scenario = {
    ollama: true, passiPrimaDelFinire: 2, ritardoMs: 0, rispostaNonJson: false, risultato: () => risultatoDemo, ...parziale,
  };
  const richieste: RichiestaVista[] = [];
  const sigleNote = new Set<string>();
  const nonceVisti = new Set<string>();
  const lavori = new Map<string, { chiave: string; consultazioni: number; file: Buffer; meta: MetaAnalisi }>();
  const perChiave = new Map<string, string>();

  const server: Server = createServer(async (req, res) => {
    const risposta = (http: number, corpo: unknown) => { res.writeHead(http, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(corpo)); };
    const errore = (http: number, codice: string, messaggio: string) => risposta(http, { schema: 1, errore: { codice, messaggio } });
    try {
      const corpo = await leggiCorpo(req);
      const url = new URL(req.url ?? '/', 'http://x');
      const percorso = url.pathname;
      richieste.push({ metodo: req.method ?? '', percorso });
      if (scenario.ritardoMs) await new Promise(r => setTimeout(r, scenario.ritardoMs));
      if (scenario.rispostaNonJson) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>non sono la PC IA</html>'); return; }

      const h = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
      const v = verificaFirma(scenario.secret, { metodo: req.method ?? '', percorso, corpo }, h);
      if (!v.ok) return errore(401, 'firma_non_valida', `Firma rifiutata (${v.motivo})`);
      const nonce = h['x-ferrari-nonce']!;
      if (nonceVisti.has(nonce)) return errore(401, 'nonce_ripetuto', 'Richiesta ripetuta');
      nonceVisti.add(nonce);

      if (req.method === 'GET' && percorso === '/v1/salute') {
        return risposta(200, { schema: 1, versione_api: 1, ollama: scenario.ollama, modello: 'gemma4:e2b', in_coda: lavori.size, in_corso: 0, versione_prompt: '3' });
      }
      if (req.method === 'PUT' && percorso === '/v1/sigle') {
        const s = SnapshotSigleSchema.safeParse(JSON.parse(corpo.toString()));
        if (!s.success) return errore(400, 'corpo_non_valido', s.error.issues[0]?.message ?? 'corpo non valido');
        sigleNote.add(s.data.versione_sigle);
        return risposta(200, { schema: 1, versione_sigle: s.data.versione_sigle });
      }
      if (req.method === 'POST' && percorso === '/v1/analisi') {
        if (!scenario.ollama) return errore(503, 'ollama_non_disponibile', 'Ollama non risponde');
        const p = parti(corpo, req.headers['content-type'] ?? '');
        const meta = MetaAnalisiSchema.safeParse(JSON.parse(p.get('meta')?.toString() ?? '{}'));
        const file = p.get('file');
        if (!meta.success || !file) return errore(400, 'corpo_non_valido', 'Mancano meta o file');
        if (file.length > 10 * 1024 * 1024) return errore(413, 'troppo_grande', 'File oltre 10 MB');
        if (!sigleNote.has(meta.data.versione_sigle)) return errore(409, 'sigle_obsolete', 'Versione delle sigle sconosciuta');
        richieste[richieste.length - 1] = { metodo: 'POST', percorso, meta: meta.data, dimFile: file.length };
        const chiave = `${meta.data.sha256}|${meta.data.versione_sigle}`;
        let id = perChiave.get(chiave);                                         // idempotente: stesso file e sigle = stesso lavoro
        if (!id) { id = `job-${lavori.size + 1}`; perChiave.set(chiave, id); lavori.set(id, { chiave, consultazioni: 0, file, meta: meta.data }); }
        return risposta(202, { schema: 1, id, stato: 'in_coda' });
      }
      const m = /^\/v1\/analisi\/([^/]+)$/.exec(percorso);
      if (m && req.method === 'GET') {
        const l = lavori.get(decodeURIComponent(m[1]!));
        if (!l) return errore(404, 'non_trovato', 'Lavoro sconosciuto');
        l.consultazioni++;
        if (l.consultazioni < scenario.passiPrimaDelFinire) {
          return risposta(200, { schema: 1, id: m[1], stato: 'in_corso', passo: l.consultazioni === 1 ? 'lettura' : 'riassunti',
            avanzamento: { fatti: l.consultazioni, totale: scenario.passiPrimaDelFinire, etichetta: l.consultazioni === 1 ? 'Lettura' : 'Riassunti' } });
        }
        if (scenario.fallaAnalisi) return risposta(200, { schema: 1, id: m[1], stato: 'errore', passo: 'riassunti', avanzamento: null, errore: scenario.fallaAnalisi });
        return risposta(200, { schema: 1, id: m[1], stato: 'fatto', passo: 'fine', avanzamento: null, risultato: scenario.risultato(l.file, l.meta) });
      }
      if (m && req.method === 'DELETE') {
        const id = decodeURIComponent(m[1]!);
        if (!lavori.delete(id)) return errore(404, 'non_trovato', 'Lavoro sconosciuto');
        return risposta(200, { schema: 1, id, stato: 'errore' });
      }
      return errore(404, 'non_trovato', 'Percorso sconosciuto');
    } catch (e) {
      return errore(500, 'errore_interno', (e as Error).message);
    }
  });
  await new Promise<void>(ok => server.listen(scenario.porta ?? 0, '127.0.0.1', ok));
  const porta = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${porta}`, scenario, richieste, sigleNote,
    chiudi: () => new Promise<void>(ok => { server.closeAllConnections(); server.close(() => ok()); }),
  };
}
