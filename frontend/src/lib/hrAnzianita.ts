// Anzianità = giorni di servizio sommando tutti i contratti (calcolati dal backend, vista hr_employee_anzianita).
// Qui solo il formato: anni e mesi compiuti (1 anno = 365,25 giorni, 1 mese = 30,4375).
export function fmtAnzianita(giorni: number | null | undefined): string {
  if (giorni == null) return '—';
  if (giorni < 31) return `${giorni} ${giorni === 1 ? 'giorno' : 'giorni'}`;
  const mesiTot = Math.floor(giorni / 30.4375);
  const anni = Math.floor(mesiTot / 12), mesi = mesiTot % 12;
  const a = anni ? `${anni} ${anni === 1 ? 'anno' : 'anni'}` : '';
  const m = mesi ? `${mesi} ${mesi === 1 ? 'mese' : 'mesi'}` : '';
  return [a, m].filter(Boolean).join(' ');
}
