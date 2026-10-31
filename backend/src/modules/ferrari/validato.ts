// Dati finali di una scheda validata: parte dall'analisi della VM e applica le decisioni delle persone.
// Funzione pura: nessun accesso al database.

import { TIPO_NEUTRO } from './analyzer.js';
import { collapse } from './text.js';
import type { AnalisiVm, HeaderScheda, ItemConfronto, RisultatoConfronto } from './types.js';

export type Decisione = 'conferma_vm' | 'conferma_ia' | 'correggi' | 'ignora' | 'verificato_immagini';

export interface ValoreDopo { tipo?: string; valore?: string; frammento?: string; significato?: string }

export interface DecisioneRecord {
  item_key:    string;
  decisione:   Decisione;
  valore_dopo: ValoreDopo | null;
  motivo:      string | null;
  username:    string;
  creata_at:   string | Date;
}

export interface ComponenteFinale {
  tipo: string; valore: string; frammento: string;
  origine: string; blocco: number; fonte: 'vm' | 'ia' | 'operatore';
}

export interface OpzioneFinale {
  riga: number; sezione: string | null; codice: string; descrizione: string; valore: string; nota: string;
  codice_noto: boolean; significato: string | null;
  componenti: ComponenteFinale[];
  note_operatore: { item_key: string; tipo: string; decisione: Decisione; motivo: string | null; utente: string }[];
}

export interface DatiValidati {
  header:   HeaderScheda;
  esito_confronto: string;
  validazione: 'automatica' | 'umana';
  opzioni:  OpzioneFinale[];
  note_scheda: { item_key: string; tipo: string; decisione: Decisione; motivo: string | null; utente: string }[];
}

const SOLO_FLAG = new Set(['RIFERIMENTO_IMMAGINI', 'PLACEHOLDER']);

/** Ultima decisione per ogni item (le decisioni sono solo-aggiunta: vale l'ultima). */
export function ultimePerItem(decisioni: DecisioneRecord[]): Map<string, DecisioneRecord> {
  const m = new Map<string, DecisioneRecord>();
  for (const d of decisioni) m.set(d.item_key, d);
  return m;
}

export function itemNonRisolti(confronto: RisultatoConfronto, decisioni: DecisioneRecord[]): ItemConfronto[] {
  const ult = ultimePerItem(decisioni);
  return confronto.items.filter(i => !ult.has(i.key));
}

export function costruisciDatiValidati(
  vm: AnalisiVm, confronto: RisultatoConfronto, decisioni: DecisioneRecord[], automatica: boolean,
): DatiValidati {
  const ult = ultimePerItem(decisioni);
  const perRiga = new Map<number, ItemConfronto[]>();
  const itemScheda: ItemConfronto[] = [];
  for (const it of confronto.items) {
    if (it.riga === null) itemScheda.push(it);
    else perRiga.set(it.riga, [...(perRiga.get(it.riga) ?? []), it]);
  }

  const nota = (it: ItemConfronto) => {
    const d = ult.get(it.key);
    return d ? { item_key: it.key, tipo: it.tipo, decisione: d.decisione, motivo: d.motivo, utente: d.username } : null;
  };

  const opzioni: OpzioneFinale[] = vm.opzioni.map(o => {
    const items = perRiga.get(o.riga) ?? [];
    const finali: ComponenteFinale[] = [];

    // Componenti della VM, tranne quelli che una persona ha scartato o sostituito
    for (const u of o.unita) {
      for (const c of u.componenti) {
        if (c.tipo === TIPO_NEUTRO || SOLO_FLAG.has(c.tipo)) continue;
        const toccato = items.find(i =>
          (i.tipo === 'componente_solo_vm' || i.tipo === 'valore_diverso') &&
          i.origine === u.origine && i.blocco === u.n &&
          collapse(String((i.vm as { frammento?: string } | null | undefined)?.frammento ?? '')) === collapse(c.frammento));
        const d = toccato ? ult.get(toccato.key) : undefined;
        if (d && (d.decisione === 'ignora' || d.decisione === 'conferma_ia' || d.decisione === 'correggi')) continue;
        finali.push({ tipo: c.tipo, valore: c.valore, frammento: c.frammento, origine: u.origine, blocco: u.n, fonte: 'vm' });
      }
    }

    // Aggiunte e sostituzioni decise da una persona
    for (const it of items) {
      const d = ult.get(it.key);
      if (!d) continue;
      const base = { origine: it.origine ?? 'blocco', blocco: it.blocco ?? 0 };
      if (d.decisione === 'conferma_ia' && it.ia && typeof it.ia.tipo === 'string' && typeof it.ia.valore === 'string') {
        finali.push({ tipo: it.ia.tipo, valore: it.ia.valore, frammento: String(it.ia.frammento ?? it.frammento ?? ''), fonte: 'ia', ...base });
      } else if (d.decisione === 'correggi' && d.valore_dopo?.tipo && d.valore_dopo.tipo !== TIPO_NEUTRO && d.valore_dopo.valore) {
        finali.push({
          tipo: d.valore_dopo.tipo, valore: d.valore_dopo.valore,
          frammento: d.valore_dopo.frammento ?? String(it.frammento ?? ''), fonte: 'operatore', ...base,
        });
      }
    }

    const note_operatore = items.map(nota).filter((n): n is NonNullable<ReturnType<typeof nota>> => n !== null);
    return {
      riga: o.riga, sezione: o.sezione, codice: o.codice, descrizione: o.descrizione, valore: o.valore, nota: o.nota,
      codice_noto: o.codice_noto, significato: o.significato, componenti: finali, note_operatore,
    };
  });

  return {
    header: vm.header,
    esito_confronto: confronto.esito,
    validazione: automatica ? 'automatica' : 'umana',
    opzioni,
    note_scheda: itemScheda.map(nota).filter((n): n is NonNullable<ReturnType<typeof nota>> => n !== null),
  };
}

// ─── Quali decisioni sono ammesse per ogni tipo di item ───────────────────────

const AMMESSE: Record<string, Decisione[]> = {
  immagini:            ['verificato_immagini'],
  componente_solo_ia:  ['conferma_ia', 'ignora', 'correggi'],
  componente_solo_vm:  ['conferma_vm', 'ignora', 'correggi'],
  valore_diverso:      ['conferma_vm', 'conferma_ia', 'correggi'],
  sconosciuto_vm:      ['correggi', 'ignora'],
  sconosciuto_ia:      ['correggi', 'ignora'],
  ambiguo_ia:          ['correggi', 'ignora'],
  codice_ignoto:       ['correggi', 'ignora'],
  ia_assente:          ['conferma_vm'],
};
const DEFAULT_AMMESSE: Decisione[] = ['conferma_vm', 'ignora', 'correggi'];

export function decisioniAmmesse(it: ItemConfronto): Decisione[] {
  return AMMESSE[it.tipo] ?? DEFAULT_AMMESSE;
}

/** Messaggio di errore se la decisione non e' valida per l'item, altrimenti null. */
export function erroreDecisione(
  it: ItemConfronto, decisione: Decisione, valoreDopo: ValoreDopo | null, motivo: string | null,
): string | null {
  if (!decisioniAmmesse(it).includes(decisione)) {
    return `Decisione "${decisione}" non ammessa per un item "${it.tipo}" (ammesse: ${decisioniAmmesse(it).join(', ')})`;
  }
  if (it.livello === 'ROSSO' && !(motivo && motivo.trim())) {
    return 'Per un problema ROSSO serve una motivazione';
  }
  if (decisione === 'correggi') {
    if (it.tipo === 'codice_ignoto') {
      if (!valoreDopo?.significato?.trim()) return 'Indicare il significato del codice';
    } else if (it.tipo.startsWith('sconosciuto') || it.tipo === 'ambiguo_ia' || it.tipo === 'componente_solo_ia'
      || it.tipo === 'componente_solo_vm' || it.tipo === 'valore_diverso') {
      if (!valoreDopo?.tipo?.trim() || !valoreDopo.valore?.trim()) return 'Indicare tipo e valore del componente';
    } else if (!(motivo && motivo.trim())) {
      return 'Per correggere serve una motivazione';
    }
  }
  return null;
}
