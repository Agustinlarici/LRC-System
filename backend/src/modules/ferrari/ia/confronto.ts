// Confronto fra la lettura della VM (per codice) e quella di controllo della IA. Funzione pura.
// La chiave e' il CODICE di sigla: la IA puo' riscrivere le descrizioni, i codici no. Le descrizioni non si confrontano.

import { classeValore } from '../matrice.js';
import { collapse, norm } from '../text.js';
import type { Opzione } from '../types.js';
import type { LetturaOpzione } from './contratto.js';

export type TipoDiscrepanza = 'solo_vm' | 'solo_ia' | 'valore_diverso' | 'testo_diverso' | 'conteggio_diverso';

export interface Discrepanza {
  codice: string;
  tipo: TipoDiscrepanza;
  /** «sigla»: il codice e' una colonna o sotto-sigla (conta per l'esito); «info»: solo informativa. */
  peso: 'sigla' | 'info';
  riga_vm: number | null;
  riga_ia: number | null;
  vm?: string;
  ia?: string;
  dettaglio: string;
}

export interface EsitoConfronto { esito: 'uguale' | 'discrepanze'; discrepanze: Discrepanza[]; confrontati: number }

const codiceDi = (c: string) => collapse(c);

/** «SI», «Sì», « si » sono lo stesso valore; i numeri con virgola o punto pure; il resto si confronta senza maiuscole/spazi/accenti. */
export function normalizzaValore(valore: string): string {
  switch (classeValore(valore)) {
    case 'VUOTO': return '';
    case 'SI': return 'SI';
    case 'EXTRA': return 'EXTRA';
    case 'NUMERO': return String(Number(valore.trim().replace(',', '.')));
    default: return collapse(valore);
  }
}

/** Le parole-codice del testo (quelle con almeno una cifra: 0357, TLM13, FYM.*0229...): e' quello che non deve perdersi. */
export function tokenTesto(testo: string): Set<string> {
  return new Set(norm(testo).match(/[A-Z0-9][A-Z0-9.*\-/]*\d[A-Z0-9.*\-/]*/g) ?? []);
}

const testoVm = (o: Opzione) => o.blocchi_testo.map(b => b.testo).join(' ');
const testoIa = (o: LetturaOpzione) => o.testi.join(' ');

function raggruppa<T>(lista: readonly T[], codice: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of lista) {
    const c = codiceDi(codice(x));
    if (!c) continue;
    (m.get(c) ?? m.set(c, []).get(c)!).push(x);
  }
  return m;
}

/**
 * `interesse`: i codici che sono colonne o sotto-sigle. Se e' vuoto (nessuna sigla scelta) contano tutti.
 * Un'opzione che la VM stessa sospetta (codice scritto male: `suggerito`) e' sempre solo informativa.
 */
export function confrontaPerCodice(vm: readonly Opzione[], ia: readonly LetturaOpzione[], interesse: ReadonlySet<string>): EsitoConfronto {
  const A = raggruppa(vm, o => o.codice);
  const B = raggruppa(ia, o => o.codice);
  const discrepanze: Discrepanza[] = [];
  const pesoDi = (codice: string, sospetta: boolean): 'sigla' | 'info' =>
    sospetta ? 'info' : interesse.size === 0 || interesse.has(codice) ? 'sigla' : 'info';
  let confrontati = 0;

  for (const codice of [...new Set([...A.keys(), ...B.keys()])].sort()) {
    const a = A.get(codice) ?? [], b = B.get(codice) ?? [];
    const sospetta = a.some(o => !!o.suggerito);
    const peso = pesoDi(codice, sospetta);
    const base = { codice, peso, riga_vm: a[0]?.riga ?? null, riga_ia: b[0]?.riga ?? null };
    if (a.length === 0) { discrepanze.push({ ...base, tipo: 'solo_ia', dettaglio: 'La IA ha letto questo codice, la VM no', ia: b[0]!.valore }); continue; }
    if (b.length === 0) { discrepanze.push({ ...base, tipo: 'solo_vm', dettaglio: 'La VM ha letto questo codice, la IA no', vm: a[0]!.valore }); continue; }
    if (a.length !== b.length) {
      discrepanze.push({ ...base, tipo: 'conteggio_diverso', dettaglio: `Il codice compare ${a.length} volte per la VM e ${b.length} per la IA` });
    }
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const x = a[i]!, y = b[i]!;
      confrontati++;
      const riga = { ...base, riga_vm: x.riga ?? null, riga_ia: y.riga ?? null };
      if (normalizzaValore(x.valore) !== normalizzaValore(y.valore)) {
        discrepanze.push({ ...riga, tipo: 'valore_diverso', vm: x.valore.trim(), ia: y.valore.trim(), dettaglio: 'Il valore e\' diverso' });
      }
      const tv = tokenTesto(testoVm(x)), ti = tokenTesto(testoIa(y));
      const soloVm = [...tv].filter(t => !ti.has(t)), soloIa = [...ti].filter(t => !tv.has(t));
      const unoSoloVuoto = (testoVm(x).trim() === '') !== (testoIa(y).trim() === '');
      if (soloVm.length || soloIa.length || unoSoloVuoto) {
        discrepanze.push({
          ...riga, tipo: 'testo_diverso', vm: testoVm(x).trim().slice(0, 200), ia: testoIa(y).trim().slice(0, 200),
          dettaglio: unoSoloVuoto ? 'Il testo libero c\'e\' solo da una parte'
            : `Codici o numeri diversi nel testo${soloVm.length ? ` (solo VM: ${soloVm.join(', ')})` : ''}${soloIa.length ? ` (solo IA: ${soloIa.join(', ')})` : ''}`,
        });
      }
    }
  }
  return { esito: discrepanze.some(d => d.peso === 'sigla') ? 'discrepanze' : 'uguale', discrepanze, confrontati };
}
