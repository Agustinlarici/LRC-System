// Tipi e utilità del modulo Schede Ferrari (lato browser). Le API sono in backend/src/modules/ferrari.

import { api } from '@/lib/api';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:${window.location.protocol === 'https:' ? 3444 : 3001}`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

export type StatoFile =
  'QUARANTENA' | 'IN_ATTESA_IA' | 'IN_REVISIONE' | 'ACCETTATO_AUTO' | 'VALIDATO' | 'RIFIUTATO' | 'SOSTITUITO';
export type Esito = 'VERDE' | 'AMBRA' | 'ROSSO';
export type Decisione = 'conferma_vm' | 'conferma_ia' | 'correggi' | 'ignora' | 'verificato_immagini';

export const STATI: { value: StatoFile; label: string }[] = [
  { value: 'IN_ATTESA_IA',   label: 'In attesa IA' },
  { value: 'IN_REVISIONE',   label: 'In revisione' },
  { value: 'ACCETTATO_AUTO', label: 'Accettata (auto)' },
  { value: 'VALIDATO',       label: 'Validata' },
  { value: 'RIFIUTATO',      label: 'Rifiutata' },
  { value: 'SOSTITUITO',     label: 'Sostituita' },
  { value: 'QUARANTENA',     label: 'Quarantena' },
];

export const TIPI_COMPONENTE_LABEL: Record<string, string> = {
  ZONA: 'Zona', LATO: 'Lato', MATERIALE: 'Materiale', COLORE: 'Colore', CODICE_VERNICE: 'Codice vernice',
  FILO: 'Filo', CUCITURA: 'Cucitura', LOGO_SCRITTA: 'Logo / scritta', RIFERIMENTO_IMMAGINI: 'Rimando immagini',
  PLACEHOLDER: 'Segnaposto', ALTRO: 'Altro', NEUTRO: 'Parola senza importanza (si ignora sempre)',
};

export const DECISIONE_LABEL: Record<Decisione, string> = {
  conferma_vm: 'Confermo la VM',
  conferma_ia: 'Confermo la IA',
  correggi: 'Correggo / definisco',
  ignora: 'Ignoro (solo qui)',
  verificato_immagini: 'Ho verificato le immagini',
};

export interface FileRiga {
  id: number; filename: string; stato: StatoFile; ia_stato: 'in_attesa' | 'ricevuta' | 'assente';
  esito: Esito | null; campione: boolean; commessa: string | null; modello: string | null; versione: string | null;
  mercato_codice: string | null; paese: string | null; caricato_da: string; caricato_at: string;
  inviato_ia_at: string | null; chiuso_da: string | null; chiuso_at: string | null; sostituito_da: number | null;
  quarantena_motivo: string | null; n_confronti: number; n_items: number; n_decisioni: number;
}

export interface Riepilogo {
  stati: Partial<Record<StatoFile, number>>;
  proposte: { codici: number; componenti: number };
  ia_in_ritardo: number;
  conoscenza_versione: number;
}

export interface ComponenteVm {
  tipo: string; valore: string; frammento: string; start: number; end: number; origine: 'dizionario' | 'regola';
}
export interface UnitaTesto {
  origine: 'valore' | 'nota' | 'blocco'; n: number; righe: number[]; testo: string;
  componenti: ComponenteVm[]; residuo: { testo: string; start: number; end: number }[]; flags: string[];
}
export interface OpzioneVm {
  riga: number; sezione: string | null; codice: string; descrizione: string; valore: string; classe_valore: string;
  nota: string; codice_noto: boolean; significato: string | null; unita: UnitaTesto[];
}
export interface AnalisiVm {
  motore: string; versione_conoscenza: number;
  header: {
    commessa: string | null;
    variante: { codice: string | null; revisione: string | null; data: string | null };
    tipo_matricola: { raw: string | null; modello: string | null; versione: string | null; mercato_codice: string | null;
      mercato_sigla: string | null; matricola: string | null; progressivo: string | null };
    destinazione: { paese: string | null; codice_mercato: string | null; raw_mrkt: string | null };
    telaio: string | null;
  };
  mercato: { coerente: boolean; dettaglio: string; valori: Record<string, string | null> };
  opzioni: OpzioneVm[];
  anomalie: { tipo: string; riga: number | null; livello: string; dettaglio: string }[];
}

export interface ItemConfronto {
  key: string; riga: number | null; codice: string | null; livello: 'AMBRA' | 'ROSSO'; tipo: string; descrizione: string;
  origine?: 'valore' | 'nota' | 'blocco'; blocco?: number; frammento?: string;
  vm?: Record<string, unknown> | null; ia?: Record<string, unknown> | null;
}
export interface RisultatoConfronto {
  esito: Esito; ia_assente: boolean; versioni: { vm: number; ia: number | null };
  header: { campo: string; vm: string | null; ia: string | null; stato: string }[];
  items: ItemConfronto[]; righe: { riga: number; codice: string; esito: Esito }[];
}

export interface DecisioneRec {
  id: number; item_key: string; decisione: Decisione;
  valore_dopo: { tipo?: string; valore?: string; frammento?: string; significato?: string } | null;
  motivo: string | null; proposta_id: number | null; username: string; creata_at: string;
}

export interface DettaglioFile {
  file: FileRiga & {
    sha256: string; size_bytes: number; matricola: string | null; rev: number; quarantena_motivo: string | null;
    dati_validati: DatiValidati | null; sostituisce: number[] | null;
  };
  vm: { risultato: AnalisiVm; versione_conoscenza: number; creata_at: string } | null;
  vm_confronto: AnalisiVm | null;
  ia: { risultato: { run: Record<string, unknown>; opzioni: { riga: number; componenti: { tipo: string; valore: string; frammento: string }[] }[] }; versione_conoscenza: number; creata_at: string } | null;
  confronto: { id: number; esito: Esito; risultato: RisultatoConfronto; creato_at: string } | null;
  confronti: { id: number; esito: Esito; creato_at: string }[];
  decisioni: DecisioneRec[];
  storico: { id: number; ts: string; username: string | null; azione: string; dettagli: Record<string, unknown> | null }[];
}

export interface DatiValidati {
  validazione: 'automatica' | 'umana'; esito_confronto: string;
  opzioni: {
    riga: number; sezione: string | null; codice: string; descrizione: string; valore: string; nota: string;
    significato: string | null;
    componenti: { tipo: string; valore: string; frammento: string; fonte: string }[];
    note_operatore: { tipo: string; decisione: Decisione; motivo: string | null; utente: string }[];
  }[];
}

// ─── Chiamate con file ────────────────────────────────────────────────────────

async function messaggioErrore(res: Response): Promise<string> {
  const err = await res.json().catch(() => ({})) as { message?: string; error?: string };
  return err.message ?? err.error ?? `HTTP ${res.status}`;
}

export async function inviaFile<T>(path: string, campo: string, files: File[], timeoutMs = 120_000): Promise<T> {
  const form = new FormData();
  for (const f of files) form.append(campo, f);
  const res = await fetch(`${BACKEND}${path}`, { method: 'POST', body: form, credentials: 'include', signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(await messaggioErrore(res));
  return res.json() as Promise<T>;
}

/** Scarica un file dal backend (anche con POST) e lo salva col nome indicato dal server. */
export async function scaricaFile(path: string, opts: { method?: 'GET' | 'POST'; body?: unknown; nome: string; timeoutMs?: number }): Promise<void> {
  const res = await fetch(`${BACKEND}${path}`, {
    method: opts.method ?? 'GET',
    headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: 'include',
    signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
  });
  if (!res.ok) throw new Error(await messaggioErrore(res));
  const disp = res.headers.get('Content-Disposition') ?? '';
  const nome = /filename="([^"]+)"/.exec(disp)?.[1] ?? opts.nome;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const ferrariApi = {
  riepilogo: () => api.get<Riepilogo>('/api/ferrari/summary'),
};

export function fmtData(s: string | null | undefined): string {
  if (!s) return '—';
  return new Date(s).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
}
