/**
 * Calcoli di tempo per le letture da WebThron (funzioni pure, testabili).
 *
 * Le date di `ubidocum.datain` si confrontano come stringhe "naive" (senza fuso), così
 * MariaDB usa l'indice su `datain` e non c'è nessuna conversione di fuso lato driver.
 */

const pad = (n: number) => String(n).padStart(2, '0');

function fmt(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
         `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/**
 * Limiti [da, a) di `datain` equivalenti al vecchio filtro
 * `DATE(CONVERT_TZ(datain, '+00:00', '+01:00')) = date`, ma sull'indice: da 23:00 del giorno
 * prima a 23:00 del giorno. Stessa semantica di prima (offset fisso +01:00), senza scansione.
 */
export function dayBoundsNaive(date: string): { from: string; to: string } {
  const [y, m, d] = date.split('-').map(Number);
  const end = Date.UTC(y, m - 1, d, 23, 0, 0);
  return { from: fmt(end - 86_400_000), to: fmt(end) };
}

/** Spezza l'intervallo di giorni [from, to] in rebanadine contigue di `sliceHours` ore. */
export function buildRangeSlices(from: string, to: string, sliceHours = 4): Array<{ from: string; to: string }> {
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  const start = Date.UTC(y1, m1 - 1, d1, 23, 0, 0) - 86_400_000;
  const end   = Date.UTC(y2, m2 - 1, d2, 23, 0, 0);
  const step  = Math.max(1, sliceHours) * 3_600_000;

  const out: Array<{ from: string; to: string }> = [];
  for (let t = start; t < end; t += step) {
    out.push({ from: fmt(t), to: fmt(Math.min(t + step, end)) });
  }
  return out;
}

/** I `count` giorni prima di `today` (YYYY-MM-DD), dal più recente (ieri) al più vecchio. */
export function pastDays(today: string, count: number): string[] {
  const [y, m, d] = today.split('-').map(Number);
  const out: string[] = [];
  for (let i = 1; i <= count; i++) {
    out.push(new Date(Date.UTC(y, m - 1, d - i, 12)).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Giorni da rileggere nella rilettura notturna, dal più recente. Con `includeToday` (la lettura
 * delle 23:30) parte da oggi, altrimenti da ieri (quella delle 01:00). `count` conta tutti i giorni.
 */
export function daysToReread(today: string, count: number, includeToday: boolean): string[] {
  if (!includeToday) return pastDays(today, count);
  return [today, ...pastDays(today, Math.max(0, count - 1))];
}

/** True se `date` cade nella fascia notturna [fromHour, toHour) in ora di Roma (es. 23 → 5). */
export function isQuietHour(date: Date, fromHour: number, toHour: number): boolean {
  if (fromHour === toHour) return false;
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome', hour: '2-digit', hourCycle: 'h23',
  }).format(date));
  return fromHour > toHour ? (hour >= fromHour || hour < toHour) : (hour >= fromHour && hour < toHour);
}
