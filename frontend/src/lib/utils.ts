/** Returns today's date as YYYY-MM-DD */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Format YYYY-MM-DD → DD/MM/YYYY */
export function fmtDate(d: string): string {
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

/** Add/subtract days from a YYYY-MM-DD string */
export function addDays(d: string, n: number): string {
  const dt = new Date(d);
  dt.setDate(dt.getDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** Format ISO timestamp → DD/MM/YYYY HH:MM (Europe/Rome) */
export function fmtDatetime(raw: string): string {
  return new Date(raw).toLocaleString('it-IT', {
    timeZone: 'Europe/Rome',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
