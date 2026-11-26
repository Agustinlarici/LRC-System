// Semaforo di un progetto: calcolato dai dati, mai inserito a mano.
//   rosso  (In ritardo)  = una fase è scaduta con attività ancora aperte, oppure un'attività aperta è scaduta
//   giallo (Attenzione)  = attività bloccata, in attesa da 3+ giorni, oltre la scadenza della sua fase,
//                          oppure nessun movimento da 7+ giorni
//   verde  (In linea)    = nessun segnale
// I giorni sono relativi a oggi (negativo = nel passato), così la funzione è pura e si prova senza database.

export type HealthTone = 'success' | 'warning' | 'danger' | 'neutral';
export interface Health { tone: HealthTone; label: string; reasons: string[] }

export interface HealthPhase { name: string; due_days: number | null; open_tasks: number }
export interface HealthTask {
  title: string; status: string; status_note: string | null;
  due_days: number | null; waiting_days: number | null; phase_due_days: number | null;
}
export interface HealthInput {
  status: string;                     // attivo | in_pausa | chiuso
  idle_days: number | null;           // giorni dall'ultimo movimento (null = mai)
  phases: HealthPhase[];
  tasks: HealthTask[];                // solo le attività NON fatte
}

export const WAITING_ALERT_DAYS = 3;
export const IDLE_ALERT_DAYS = 7;

export function dayLabel(n: number): string {
  if (n < 0) return `scaduta da ${-n} g`;
  if (n === 0) return 'oggi';
  return `tra ${n} g`;
}

export function computeHealth(i: HealthInput): Health {
  if (i.status === 'in_pausa') return { tone: 'neutral', label: 'In pausa', reasons: [] };
  if (i.status === 'chiuso')   return { tone: 'neutral', label: 'Chiuso', reasons: [] };

  const reasons: string[] = [];
  let red = false, amber = false;

  for (const ph of i.phases) {
    if (ph.due_days !== null && ph.due_days < 0 && ph.open_tasks > 0) {
      red = true;
      reasons.push(`La fase «${ph.name}» è scaduta con ${ph.open_tasks} ${ph.open_tasks === 1 ? 'attività aperta' : 'attività aperte'}`);
    }
  }
  for (const t of i.tasks) {
    if (t.due_days !== null && t.due_days < 0) {
      red = true;
      reasons.push(`«${t.title}» è in ritardo (${dayLabel(t.due_days)})`);
    }
    if (t.status === 'bloccata') {
      amber = true;
      reasons.push(`«${t.title}» è bloccata${t.status_note ? `: ${t.status_note}` : ''}`);
    }
    if (t.status === 'in_attesa' && t.waiting_days !== null && t.waiting_days >= WAITING_ALERT_DAYS) {
      amber = true;
      reasons.push(`«${t.title}» è in attesa da ${t.waiting_days} giorni`);
    }
    if (t.due_days !== null && t.phase_due_days !== null && t.due_days > t.phase_due_days) {
      amber = true;
      reasons.push(`«${t.title}» supera la scadenza della sua fase`);
    }
  }
  if (i.idle_days !== null && i.idle_days >= IDLE_ALERT_DAYS) {
    amber = true;
    reasons.push(`Nessun movimento da ${i.idle_days} giorni`);
  }

  if (red)   return { tone: 'danger',  label: 'In ritardo', reasons };
  if (amber) return { tone: 'warning', label: 'Attenzione', reasons };
  return { tone: 'success', label: 'In linea', reasons };
}
