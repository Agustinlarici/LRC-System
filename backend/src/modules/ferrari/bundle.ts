// Pacchetti (bundle) scambiati con la PC IA: zip con manifest.json firmato (HMAC-SHA256) e hash di ogni file.
// Il formato e' identico qualunque sia il trasporto (USB, cartella, OneDrive, rete). Contratto: docs/FERRARI-FLUSSO.md §7.
// Lato Python (STR-LocalAI/web/ferrari/bundle.py) deve produrre/verificare esattamente la stessa firma.

import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import PizZip from 'pizzip';
import { z } from 'zod';
import type { AnalisiIa, Canonico, Conoscenza } from './types.js';

export const BUNDLE_SCHEMA_VERSION = 1;
export type BundleTipo = 'to-ai' | 'from-ai' | 'knowledge' | 'sigle';

const MAX_ZIP_BYTES = 80 * 1024 * 1024;
const MAX_UNZIPPED_BYTES = 300 * 1024 * 1024;
const MAX_ENTRIES = 5000;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;

export class BundleError extends Error {
  constructor(message: string) { super(message); this.name = 'BundleError'; }
}

// ─── Firma ────────────────────────────────────────────────────────────────────

/** JSON con chiavi ordinate e senza spazi: la stessa stringa in TypeScript e in Python. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o).filter(k => o[k] !== undefined).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
}

export function firma(manifestSenzaFirma: Record<string, unknown>, secret: string): string {
  return createHmac('sha256', secret).update(stableStringify(manifestSenzaFirma), 'utf8').digest('hex');
}

export function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

// ─── Manifest ─────────────────────────────────────────────────────────────────

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const PATH_OK = /^[A-Za-z0-9_][A-Za-z0-9_.\-/]*$/;

export const ManifestSchema = z.object({
  schema_version:    z.literal(BUNDLE_SCHEMA_VERSION),
  bundle_type:       z.enum(['to-ai', 'from-ai', 'knowledge', 'sigle']),
  bundle_id:         UUID,
  in_reply_to:       UUID.nullable(),
  batch_id:          UUID,
  created_at:        z.string().min(10).max(40),
  producer:          z.enum(['vm', 'ai']),
  knowledge_version: z.number().int().min(0),
  files: z.array(z.object({
    path:   z.string().min(1).max(200).regex(PATH_OK).refine(p => !p.includes('..') && !p.includes('//'), 'percorso non valido'),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    size:   z.number().int().min(0),
  })).max(MAX_ENTRIES),
  hmac_sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type Manifest = z.infer<typeof ManifestSchema>;

export interface BuildOpts {
  tipo:             BundleTipo;
  producer:         'vm' | 'ai';
  secret:           string;
  files:            Record<string, Buffer | string>;
  knowledgeVersion: number;
  batchId?:         string;
  inReplyTo?:       string | null;
  bundleId?:        string;
  createdAt?:       string;
}

export function buildBundle(o: BuildOpts): { zip: Buffer; manifest: Manifest } {
  if (!o.secret) throw new BundleError('Segreto dei pacchetti non configurato');
  const zip = new PizZip();
  const files = Object.entries(o.files).map(([path, content]) => {
    const buf = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
    zip.file(path, buf);
    return { path, sha256: sha256(buf), size: buf.length };
  }).sort((a, b) => (a.path < b.path ? -1 : 1));

  const senzaFirma = {
    schema_version: BUNDLE_SCHEMA_VERSION,
    bundle_type: o.tipo,
    bundle_id: o.bundleId ?? randomUUID(),
    in_reply_to: o.inReplyTo ?? null,
    batch_id: o.batchId ?? randomUUID(),
    created_at: o.createdAt ?? new Date().toISOString(),
    producer: o.producer,
    knowledge_version: o.knowledgeVersion,
    files,
  };
  const manifest: Manifest = { ...senzaFirma, hmac_sha256: firma(senzaFirma, o.secret) } as Manifest;
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  return { zip: zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer, manifest };
}

export interface BundleLetto { manifest: Manifest; files: Map<string, Buffer> }

/** Apre e verifica un pacchetto: dimensioni, firma, hash di ogni file, nessun file non dichiarato. */
export function leggiBundle(buf: Buffer, secret: string, atteso: BundleTipo): BundleLetto {
  if (!secret) throw new BundleError('Segreto dei pacchetti non configurato');
  if (buf.length === 0 || buf.length > MAX_ZIP_BYTES) throw new BundleError('Dimensione del pacchetto non valida');

  let zip: PizZip;
  try {
    zip = new PizZip(buf);
  } catch {
    throw new BundleError('Il file non è uno zip valido');
  }

  const nomi = Object.keys(zip.files).filter(n => !zip.files[n]!.dir);
  if (nomi.length > MAX_ENTRIES + 1) throw new BundleError('Troppi file nel pacchetto');
  let totale = 0;
  for (const n of nomi) {
    const data = (zip.files[n] as unknown as { _data?: { uncompressedSize?: number } })._data;
    totale += data?.uncompressedSize ?? 0;
    if (totale > MAX_UNZIPPED_BYTES) throw new BundleError('Pacchetto troppo grande una volta decompresso');
  }

  const mf = zip.file('manifest.json');
  if (!mf) throw new BundleError('manifest.json mancante');
  const mfSize = (zip.files['manifest.json'] as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
  if (mfSize > MAX_MANIFEST_BYTES) throw new BundleError('manifest.json troppo grande');
  let json: unknown;
  try {
    json = JSON.parse(mf.asText());
  } catch {
    throw new BundleError('manifest.json non è un JSON valido');
  }
  const parsed = ManifestSchema.safeParse(json);
  if (!parsed.success) {
    throw new BundleError(`manifest non valido: ${parsed.error.errors.map(e => `${e.path.join('.')} ${e.message}`).join(', ')}`);
  }
  const manifest = parsed.data;

  const { hmac_sha256, ...senzaFirma } = manifest;
  const attesa = Buffer.from(firma(senzaFirma, secret), 'hex');
  const ricevuta = Buffer.from(hmac_sha256, 'hex');
  if (attesa.length !== ricevuta.length || !timingSafeEqual(attesa, ricevuta)) {
    throw new BundleError('Firma non valida: il pacchetto è alterato o il segreto non coincide');
  }
  if (manifest.bundle_type !== atteso) {
    throw new BundleError(`Tipo di pacchetto errato: atteso ${atteso}, ricevuto ${manifest.bundle_type}`);
  }

  if (manifest.files.reduce((s, f) => s + f.size, 0) > MAX_UNZIPPED_BYTES) {
    throw new BundleError('Pacchetto troppo grande una volta decompresso');
  }
  const dichiarati = new Set(manifest.files.map(f => f.path));
  if (dichiarati.size !== manifest.files.length) throw new BundleError('Percorsi duplicati nel manifest');
  for (const n of nomi) {
    if (n !== 'manifest.json' && !dichiarati.has(n)) throw new BundleError(`File non dichiarato nel manifest: ${n}`);
  }

  const files = new Map<string, Buffer>();
  for (const f of manifest.files) {
    const entry = zip.file(f.path);
    if (!entry) throw new BundleError(`File mancante: ${f.path}`);
    const content = entry.asNodeBuffer();
    if (content.length !== f.size || sha256(content) !== f.sha256) {
      throw new BundleError(`Hash o dimensione errati per ${f.path}`);
    }
    files.set(f.path, content);
  }
  return { manifest, files };
}

// ─── Contenuto dei pacchetti ──────────────────────────────────────────────────

export const fileIdDi = (dbId: number): string => `f${dbId}`;

export interface EsempioConoscenza {
  testo:   string;
  pattern: string;
  tipo:    string;
  valore:  string;
  modello: string | null;
}

export function fileConoscenza(k: Conoscenza, esempi: EsempioConoscenza[]): Record<string, string> {
  return {
    'knowledge/dictionary.json': JSON.stringify(k),
    'knowledge/examples.jsonl': esempi.map(e => JSON.stringify(e)).join('\n') + (esempi.length ? '\n' : ''),
  };
}

export function buildToAi(opts: {
  secret: string; schede: { dbId: number; canonico: Canonico }[]; conoscenza: Conoscenza;
  esempi: EsempioConoscenza[]; batchId?: string;
}) {
  const files: Record<string, string> = { ...fileConoscenza(opts.conoscenza, opts.esempi) };
  for (const s of opts.schede) {
    // La IA non riceve le celle grezze: le evidenze le verifica la VM sull'originale.
    const { celle: _celle, ...senzaCelle } = s.canonico;
    files[`normalized/${fileIdDi(s.dbId)}.json`] = JSON.stringify(senzaCelle);
  }
  return buildBundle({
    tipo: 'to-ai', producer: 'vm', secret: opts.secret, files,
    knowledgeVersion: opts.conoscenza.versione, batchId: opts.batchId,
  });
}

export function buildKnowledge(opts: { secret: string; conoscenza: Conoscenza; esempi: EsempioConoscenza[] }) {
  return buildBundle({
    tipo: 'knowledge', producer: 'vm', secret: opts.secret,
    files: fileConoscenza(opts.conoscenza, opts.esempi), knowledgeVersion: opts.conoscenza.versione,
  });
}

// ─── Risultato della IA (from-ai) ─────────────────────────────────────────────

const Testo = (max: number) => z.string().trim().min(1).max(max);
const Tipo = z.string().trim().min(1).max(40).transform(s => s.toUpperCase());

export const AnalisiIaSchema = z.object({
  schema_version: z.literal(1),
  file_id: Testo(40),
  source_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  modello: z.object({ valore: Testo(80) }).nullable(),
  mercato: z.object({ valore: Testo(80) }).nullable().default(null),
  opzioni: z.array(z.object({
    riga: z.number().int().min(1).max(100000),
    codice: Testo(16),
    componenti: z.array(z.object({ tipo: Tipo, valore: Testo(300), frammento: Testo(600) })).max(500).default([]),
    sconosciuti: z.array(z.object({ testo: Testo(600), motivo: z.string().max(300).optional() })).max(200).default([]),
    ambigui: z.array(z.object({ testo: Testo(600), motivo: z.string().max(300).optional() })).max(200).default([]),
    incoerenze: z.array(z.object({ descrizione: Testo(600) })).max(100).default([]),
  })).max(2000),
  incoerenze_generali: z.array(z.object({ descrizione: Testo(600) })).max(100).default([]),
  run: z.object({
    ollama_model: z.string().max(100), prompt_version: z.string().max(100),
    knowledge_version: z.number().int().min(0), seconds: z.number().min(0),
  }).passthrough(),
});

export function leggiRisultatoIa(contenuto: Buffer): AnalisiIa {
  let json: unknown;
  try {
    json = JSON.parse(contenuto.toString('utf8'));
  } catch {
    throw new BundleError('Risultato IA: JSON non valido');
  }
  const r = AnalisiIaSchema.safeParse(json);
  if (!r.success) {
    throw new BundleError(`Risultato IA non valido: ${r.error.errors.slice(0, 5).map(e => `${e.path.join('.')} ${e.message}`).join('; ')}`);
  }
  return r.data as AnalisiIa;
}

// ─── Sigle (decisioni «va / non va» da sincronizzare tra VM e PC IA) ──────────

export interface VoceSigla { modello: string; codice: string; va: boolean; nome: string }

export function buildSigle(opts: { secret: string; voci: VoceSigla[] }) {
  return buildBundle({
    tipo: 'sigle', producer: 'vm', secret: opts.secret, knowledgeVersion: 0,
    files: { 'sigle.json': JSON.stringify({ sigle: opts.voci }) },
  });
}

/** Voci valide di un pacchetto delle sigle; quelle malformate si ignorano. */
export function leggiSigle(contenuto: Buffer): VoceSigla[] {
  let json: unknown;
  try {
    json = JSON.parse(contenuto.toString('utf8'));
  } catch {
    throw new BundleError('Pacchetto delle sigle non valido');
  }
  const lista = (json as { sigle?: unknown })?.sigle;
  if (!Array.isArray(lista)) throw new BundleError('Pacchetto delle sigle non valido');
  const out: VoceSigla[] = [];
  for (const v of lista) {
    if (!v || typeof v !== 'object') continue;
    const { modello, codice, va, nome } = v as Record<string, unknown>;
    if (typeof modello !== 'string' || typeof codice !== 'string' || typeof va !== 'boolean') continue;
    const m = modello.trim().toUpperCase().slice(0, 30);
    const c = codice.trim().toUpperCase().slice(0, 60);
    if (!m || !c) continue;
    out.push({ modello: m, codice: c, va, nome: typeof nome === 'string' ? nome.slice(0, 120) : '' });
  }
  return out;
}

// ─── Dettagli (riassunti dei testi lunghi, dalla PC IA alla VM, dentro il pacchetto delle sigle) ──────────

export type StatoDettaglio = 'ok' | 'rivedere' | 'rivisto';
export interface VoceDettaglio { commessa: string; codice: string; chiave: string; dettaglio: string; manuale: boolean; stato: StatoDettaglio }

/** Dettagli validi di un pacchetto delle sigle (campo facoltativo `dettagli`); quelli malformati si ignorano. */
export function leggiDettagli(contenuto: Buffer): VoceDettaglio[] {
  let json: unknown;
  try {
    json = JSON.parse(contenuto.toString('utf8'));
  } catch {
    throw new BundleError('Pacchetto delle sigle non valido');
  }
  const lista = (json as { dettagli?: unknown })?.dettagli;
  if (!Array.isArray(lista)) return [];
  const out: VoceDettaglio[] = [];
  for (const v of lista.slice(0, 20000)) {
    if (!v || typeof v !== 'object') continue;
    const { commessa, codice, chiave, dettaglio, manuale, stato } = v as Record<string, unknown>;
    if (typeof commessa !== 'string' || typeof codice !== 'string' || typeof chiave !== 'string' || typeof dettaglio !== 'string') continue;
    const d = dettaglio.replace(/\s+/g, ' ').trim().slice(0, 300);          // vuoto = nessun riassunto (la IA non era sicura)
    if (!commessa.trim() || !codice.trim() || !/^[0-9a-f]{40}$/.test(chiave)) continue;
    out.push({ commessa: commessa.trim().slice(0, 30), codice: codice.trim().toUpperCase().slice(0, 60), chiave, dettaglio: d, manuale: manuale === true,
      stato: stato === 'ok' || stato === 'rivedere' || stato === 'rivisto' ? stato : (d ? 'ok' : 'rivedere') });
  }
  return out;
}
