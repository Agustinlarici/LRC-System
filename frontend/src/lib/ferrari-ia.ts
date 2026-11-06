// Tipi e chiamate del collegamento con la PC IA (lato browser). Le API sono in backend/src/modules/ferrari/ia.
import { api } from '@/lib/api';

export type StatoTappa = 'fatto' | 'in_corso' | 'da_fare' | 'attenzione' | 'errore' | 'saltato';
export interface Tappa { passo: string; etichetta: string; stato: StatoTappa; dettaglio?: string }

export type StatoJob = 'in_coda' | 'inviato' | 'in_analisi' | 'confronto' | 'fatto' | 'attesa_ia' | 'errore' | 'annullato';
export const STATI_IN_CORSO: readonly string[] = ['in_coda', 'inviato', 'in_analisi', 'confronto'];

export interface SchedaIa {
  file_id: number; filename: string; commessa: string | null; modello: string | null; caricato_at: string;
  job_id: string | null; stato: StatoJob | null; tentativi: number | null; errore: string | null;
  esito: 'uguale' | 'discrepanze' | null; prossimo_tentativo_at: string | null; tappe: Tappa[];
}

export interface ConfigIa { attiva: boolean; url: string; maxTentativi: number; timeoutS: number }
export interface Salute { ollama: boolean; modello: string | null; in_coda: number; in_corso: number; versione_prompt: string }
export interface StatoIa {
  config: ConfigIa;
  connessione: { stato: 'sconosciuta' | 'ok' | 'non_raggiungibile'; falliti: number; ultimoControllo: string | null; errore: string | null; salute: Salute | null };
  contatori: Record<string, number>;
}

export interface Discrepanza {
  codice: string; tipo: 'solo_vm' | 'solo_ia' | 'valore_diverso' | 'testo_diverso' | 'conteggio_diverso'; peso: 'sigla' | 'info';
  riga_vm: number | null; riga_ia: number | null; vm?: string; ia?: string; dettaglio: string;
}
export interface PassoLog { passo: string; stato: 'in_corso' | 'ok' | 'attenzione' | 'errore' | 'saltato'; dettaglio: string | null; at: string }
export interface DettaglioJob { job: { id: string; stato: StatoJob; tentativi: number; errore: string | null }; passi: PassoLog[]; risultato: { esito: 'uguale' | 'discrepanze'; discrepanze: Discrepanza[] } | null }

export const TIPO_DISCREPANZA: Record<Discrepanza['tipo'], string> = {
  solo_vm: 'Solo nella lettura della VM', solo_ia: 'Solo nella lettura della IA', valore_diverso: 'Valore diverso',
  testo_diverso: 'Testo diverso', conteggio_diverso: 'Compare un numero diverso di volte',
};

const B = '/api/ferrari/ia';
export const iaApi = {
  stato: () => api.get<StatoIa>(`${B}/stato`),
  schede: (limite = 50) => api.get<{ schede: SchedaIa[] }>(`${B}/schede?limite=${limite}`).then(r => r.schede),
  dettaglio: (id: string) => api.get<DettaglioJob>(`${B}/jobs/${encodeURIComponent(id)}`),
  salvaConfig: (c: Partial<ConfigIa>) => api.put<ConfigIa>(`${B}/config`, c),
  prova: () => api.post<{ ok: true; salute: Salute } | { ok: false; errore: string }>(`${B}/prova`, {}),
  sincronizzaSigle: () => api.post<{ ok: true; versione: string; colonne: number; sottoSigle: number } | { ok: false; errore: string }>(`${B}/sigle/sincronizza`, {}),
  riprova: (id: string) => api.post(`${B}/jobs/${encodeURIComponent(id)}/riprova`, {}),
  annulla: (id: string) => api.post(`${B}/jobs/${encodeURIComponent(id)}/annulla`, {}),
  analizza: (fileId: number) => api.post(`${B}/schede/${fileId}/analizza`, {}),
  accodaMancanti: () => api.post<{ accodate: number }>(`${B}/accoda-mancanti`, {}),
};
