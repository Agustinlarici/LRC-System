// Attesa crescente tra un tentativo e l'altro (1, 2, 5, 15, 60 minuti, tetto 60) con un po' di casualita' (±20%).

export const ATTESE_MINUTI = [1, 2, 5, 15, 60] as const;
export const JITTER = 0.2;

/** Attesa in ms prima del tentativo successivo; `tentativi` = quelli gia' fatti (>= 1). `rand` in [0,1) per i test. */
export function attesaMs(tentativi: number, rand: () => number = Math.random): number {
  const i = Math.min(Math.max(tentativi, 1), ATTESE_MINUTI.length) - 1;
  const base = ATTESE_MINUTI[i]! * 60_000;
  return Math.round(base * (1 + (rand() * 2 - 1) * JITTER));
}

export const prossimoTentativo = (adesso: Date, tentativi: number, rand?: () => number): Date => new Date(adesso.getTime() + attesaMs(tentativi, rand));

export const hasSuperatoMax = (tentativi: number, max: number): boolean => tentativi >= max;
