/**
 * Unisce le righe con la stessa chiave dello storico (fase, cod_seriale, data_inserimento).
 *
 * Un INSERT ... ON CONFLICT DO UPDATE fallisce se due righe dello stesso lotto hanno la stessa
 * chiave ("cannot affect row a second time"). WebThron può restituirle (stesso documento con più
 * valori in un campo extra, o due eventi nello stesso secondo): si tiene la prima e si completano
 * i campi vuoti con i valori delle successive.
 */

export interface HistoryKey {
  fase:             string;
  cod_seriale:      string;
  data_inserimento: Date;
}

export function dedupeByKey<T extends HistoryKey>(records: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const r of records) {
    const key = `${r.fase}\u0000${r.cod_seriale}\u0000${r.data_inserimento.getTime()}`;
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, { ...r }); continue; }
    for (const field of Object.keys(r) as Array<keyof T>) {
      if (prev[field] == null && r[field] != null) prev[field] = r[field];
    }
  }
  return [...byKey.values()];
}
