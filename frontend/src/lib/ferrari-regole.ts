// Regole dei componenti (stile Outlook): tipi e chiamate verso /api/ferrari/regole-componenti.
import { api } from '@/lib/api';
import { inviaFile } from '@/lib/ferrari';

export type Condizione =
  | { tipo: 'presente'; sigla: string }
  | { tipo: 'assente'; sigla: string }
  | { tipo: 'valore'; sigla: string; testo: string }
  | { tipo: 'testo'; sigla?: string; testo: string };

export type ValoreAzione =
  | { tipo: 'sigla'; sigla: string }
  | { tipo: 'fisso'; testo: string }
  | { tipo: 'testo'; sigla: string };
export interface Azione { componente: string; valore: ValoreAzione }

export interface RegolaComp {
  id?: number;
  nome: string; attiva: boolean; modello: string; logica: 'tutte' | 'qualsiasi';
  condizioni: Condizione[]; eccezioni: Condizione[]; azioni: Azione[]; ferma: boolean;
}

export interface VoceComp { testo: string; descrizione?: string; regole: { id: number; nome: string }[] }
export type EsitoRegola = 'scattata' | 'non_scattata' | 'eccezione' | 'fermata' | 'disattivata' | 'altro_modello';
export const ESITO: Record<EsitoRegola, { testo: string; tono: 'success' | 'neutral' | 'warning' | 'info' }> = {
  scattata: { testo: 'Scatta', tono: 'success' },
  non_scattata: { testo: 'Non scatta', tono: 'neutral' },
  eccezione: { testo: 'Bloccata da un\'eccezione', tono: 'warning' },
  fermata: { testo: 'Fermata da una regola sopra', tono: 'warning' },
  disattivata: { testo: 'Disattivata', tono: 'neutral' },
  altro_modello: { testo: 'Per un altro modello', tono: 'info' },
};

export interface TabellaComponenti {
  modello: string;
  modelli: { modello: string; schede: number }[];
  componenti: string[];
  righe: { commessa: string; file_id: number; versione: string | null; celle: Record<string, VoceComp[]>; non_coperte: string[] }[];
  non_coperte: { sigla: string; schede: number }[];
  regole_attive: number;
}

export interface ProvaRegole {
  commessa: string; file_id: number; modello: string; sigle: string[];
  regole: { id: number; nome: string; esito: EsitoRegola; condizioni: { testo: string; vera: boolean }[]; eccezioni: { testo: string; vera: boolean }[] }[];
  celle: Record<string, VoceComp[]>;
}

/** La regola come la vuole il backend (senza id: l'ordine e' quello della lista). */
export const perApi = (r: RegolaComp): RegolaComp => ({
  nome: r.nome, attiva: r.attiva, modello: r.modello, logica: r.logica, condizioni: r.condizioni, eccezioni: r.eccezioni, azioni: r.azioni, ferma: r.ferma,
});

export interface RisultatoImport { regole: RegolaComp[]; errori: { riga: number; motivo: string }[]; righe: number }

const B = '/api/ferrari/regole-componenti';
export const regoleApi = {
  elenco: () => api.get<{ regole: RegolaComp[] }>(B),
  salva: (regole: RegolaComp[]) => api.put<{ regole: RegolaComp[] }>(B, { regole: regole.map(perApi) }),
  tabella: (modello: string, q: string) => api.get<TabellaComponenti>(`${B}/tabella?modello=${encodeURIComponent(modello)}&q=${encodeURIComponent(q)}`),
  importa: (file: File) => inviaFile<RisultatoImport>(`${B}/importa`, 'file', [file]),
  prova: (commessa: string, regole?: RegolaComp[]) => api.post<ProvaRegole>(`${B}/prova`, { commessa, regole: regole?.map(perApi) }),
};

export function descriviCondizione(c: Condizione): string {
  switch (c.tipo) {
    case 'presente': return `la scheda ha ${c.sigla || '…'}`;
    case 'assente': return `la scheda non ha ${c.sigla || '…'}`;
    case 'valore': return `${c.sigla || '…'} vale «${c.testo}»`;
    case 'testo': return c.sigla?.trim() ? `il testo di ${c.sigla} contiene «${c.testo}»` : `il testo della scheda contiene «${c.testo}»`;
  }
}
export function descriviAzione(a: Azione): string {
  const v = a.valore;
  const cosa = v.tipo === 'sigla' ? v.sigla : v.tipo === 'fisso' ? `«${v.testo}»` : `il testo di ${v.sigla}`;
  return `${a.componente || '…'}: ${cosa || '…'}`;
}

/** Chiave per riconoscere una regola uguale a un'altra (senza nome ne' id): serve a non importare due volte la stessa. */
export const chiaveRegola = (r: RegolaComp) => JSON.stringify([r.modello, r.logica, r.condizioni, r.eccezioni, r.azioni, r.ferma]);

/** Scarica il modello Excel per caricare molte regole: intestazioni, tre esempi e le istruzioni. */
export async function scaricaModelloRegole() {
  const XLSX = await import('xlsx');
  const regole = XLSX.utils.aoa_to_sheet([
    ['Se ha', 'Non ha', 'Aggiungi a', 'Valore', 'Modello', 'Ferma'],
    ['AS06 + AS07', '', 'Paraurti', 'AS06', '', 'SI'],
    ['AS06', '', 'Paraurti, Minigonne', '', '', ''],
    ['', 'EXAB', 'Paraurti', 'EXAT', '', ''],
  ]);
  regole['!cols'] = [{ wch: 22 }, { wch: 16 }, { wch: 26 }, { wch: 18 }, { wch: 12 }, { wch: 8 }];
  const istruzioni = XLSX.utils.aoa_to_sheet([
    ['Una riga = una regola. Le regole si applicano nell\'ordine delle righe: metti sopra quelle specifiche.'],
    [''],
    ['Se ha', 'Sigle che la scheda deve avere, separate da + (tutte). «MRKT=CINA» = il valore di MRKT e\' CINA.'],
    ['Non ha', 'Sigle che la scheda NON deve avere, separate da +.'],
    ['Aggiungi a', 'Componenti dove aggiungere il valore, separati da virgola.'],
    ['Valore', 'Cosa aggiungere. Vuoto = la sigla di «Se ha» (se ce n\'e\' una sola). Una sigla di «Se ha» = quella sigla con la sua descrizione. Altro = un testo fisso (es. EXAT).'],
    ['Modello', 'Vuoto o «tutti» = tutti i modelli; oppure un modello (es. F171VS).'],
    ['Ferma', 'SI = se la regola scatta, le regole seguenti non si applicano.'],
    [''],
    ['Condizioni piu\' complesse (oppure, eccezioni, testo contiene) si creano nella pagina Regole.'],
  ]);
  istruzioni['!cols'] = [{ wch: 14 }, { wch: 110 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, regole, 'Regole');
  XLSX.utils.book_append_sheet(wb, istruzioni, 'Istruzioni');
  XLSX.writeFile(wb, 'modello-regole-componenti.xlsx');
}
