import { parseScan, type BucciUnit } from './lookup.js';

export interface PendingItem { id: number; scanned_code: string }

export interface Resolution { item_id: number; unit: BucciUnit }

export type Problem =
  | { item_id: number; scanned_code: string; kind: 'not_found' }
  | { item_id: number; scanned_code: string; kind: 'duplicate'; seriale: string }
  | { item_id: number; scanned_code: string; kind: 'ambiguous'; candidates: BucciUnit[] };

const up = (s: string) => s.toUpperCase();

/**
 * Abbina i codici scansionati (non ancora risolti) alle righe trovate in iKnow.
 * `taken` = seriali già presenti nella spedizione (maiuscolo); viene aggiornato con quelli assegnati.
 * Seriale: una riga per codice. Commessa (BUCCxxxx): k scansioni della stessa commessa e n seriali
 * disponibili → se n = k si assegnano in ordine, se n > k l'operatore deve scegliere.
 */
export function planResolution(
  pending:    PendingItem[],
  taken:      Set<string>,
  bySeriale:  BucciUnit[],
  byCommessa: BucciUnit[],
): { resolved: Resolution[]; problems: Problem[] } {
  const resolved: Resolution[] = [];
  const problems: Problem[] = [];
  const serialeIndex = new Map(bySeriale.map(u => [up(u.seriale), u]));
  const commessaGroups = new Map<string, PendingItem[]>();

  for (const item of pending) {
    const parsed = parseScan(item.scanned_code);
    if (!parsed) { problems.push({ item_id: item.id, scanned_code: item.scanned_code, kind: 'not_found' }); continue; }

    if (parsed.kind === 'commessa') {
      const group = commessaGroups.get(parsed.commessa) ?? [];
      group.push(item);
      commessaGroups.set(parsed.commessa, group);
      continue;
    }

    const unit = serialeIndex.get(up(parsed.seriale));
    if (!unit) { problems.push({ item_id: item.id, scanned_code: item.scanned_code, kind: 'not_found' }); continue; }
    if (taken.has(up(unit.seriale))) {
      problems.push({ item_id: item.id, scanned_code: item.scanned_code, kind: 'duplicate', seriale: unit.seriale });
      continue;
    }
    taken.add(up(unit.seriale));
    resolved.push({ item_id: item.id, unit });
  }

  for (const [commessa, items] of commessaGroups) {
    const all  = byCommessa.filter(u => u.commessa === commessa);
    const free = all.filter(u => !taken.has(up(u.seriale)));

    for (const [i, item] of items.entries()) {
      const base = { item_id: item.id, scanned_code: item.scanned_code };
      if (all.length === 0) { problems.push({ ...base, kind: 'not_found' }); continue; }
      if (free.length === 0 || (free.length < items.length && i >= free.length)) {
        problems.push({ ...base, kind: 'duplicate', seriale: all[0].seriale });
        continue;
      }
      if (free.length > items.length) { problems.push({ ...base, kind: 'ambiguous', candidates: free }); continue; }
      const unit = free[i];
      taken.add(up(unit.seriale));
      resolved.push({ item_id: item.id, unit });
    }
  }

  return { resolved, problems };
}
