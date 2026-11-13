// Regole dei componenti (stile Outlook): tipi e chiamate verso /api/ferrari/regole-componenti.
import { api } from '@/lib/api';

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

const B = '/api/ferrari/regole-componenti';
export const regoleApi = {
  elenco: () => api.get<{ regole: RegolaComp[] }>(B),
  salva: (regole: RegolaComp[]) => api.put<{ regole: RegolaComp[] }>(B, { regole: regole.map(perApi) }),
  tabella: (modello: string, q: string) => api.get<TabellaComponenti>(`${B}/tabella?modello=${encodeURIComponent(modello)}&q=${encodeURIComponent(q)}`),
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
