// Controllo con il SOP: tipi e chiamate verso /api/ferrari/sop.
import { api } from '@/lib/api';

export interface ImportSop { id: number; filename: string; colonne: string[]; righe: number; con_dati: number; caricato_da: string | null; caricato_at: string }
export type TipoDifferenza = 'diverso' | 'solo_sop' | 'solo_vm';
export interface DifferenzaSop { commessa: string; file_id: number; colonna: string; sop: string; vm: string; tipo: TipoDifferenza; nota?: string }
export interface StatoColonnaSop { colonna: string; ok: number; diverso: number; solo_sop: number; solo_vm: number }
export interface ConfrontoSop {
  import: ImportSop;
  riepilogo: { righe_sop: number; con_dati: number; confrontate: number; non_caricate: number; tutte_ok: number; con_differenze: number; differenze_totali: number; mercato_senza_regola: number };
  colonne: StatoColonnaSop[];
  colonne_senza_regola: string[];
  differenze: DifferenzaSop[];
  troncato: boolean;
  non_caricate: string[];
  regole_mancanti: boolean;
}

export type RegolaSop =
  | { colonna: string; tipo: 'sigle'; sigle: string[]; base: string; unisci: string }
  | { colonna: string; tipo: 'colore'; gamma: string[]; extra: string }
  | { colonna: string; tipo: 'mercato'; mappa: Record<string, string> };

export const TIPO_DIFFERENZA: Record<TipoDifferenza, string> = { diverso: 'Valore diverso', solo_sop: 'Solo nel SOP', solo_vm: 'Solo nella VM' };

const B = '/api/ferrari/sop';
export const sopApi = {
  importazioni: () => api.get<{ importazioni: ImportSop[] }>(`${B}/importazioni`),
  confronto: () => api.get<ConfrontoSop>(`${B}/confronto`, 120_000),
  regole: () => api.get<{ regole: RegolaSop[] }>(`${B}/regole`),
  salvaRegole: (regole: RegolaSop[]) => api.put<{ salvate: number }>(`${B}/regole`, { regole }),
  suggerite: () => api.post<{ aggiunte: number }>(`${B}/regole/suggerite`),
};
