// Stati di un lavoro IA e tappe che l'utente vede. Funzioni pure: nessun database, nessun orologio.

export const STATI_JOB = ['in_coda', 'inviato', 'in_analisi', 'confronto', 'fatto', 'attesa_ia', 'errore', 'annullato'] as const;
export type StatoJob = typeof STATI_JOB[number];
export const STATI_ATTIVI: readonly StatoJob[] = ['in_coda', 'inviato', 'in_analisi', 'confronto', 'attesa_ia'];

export const PASSI_UTENTE = ['ricevuta', 'letta', 'inviata', 'analisi', 'confronto', 'pronta'] as const;
export type PassoUtente = typeof PASSI_UTENTE[number];

const ETICHETTE: Record<PassoUtente, string> = {
  ricevuta: 'Ricevuta', letta: 'Letta', inviata: 'Inviata alla IA', analisi: 'Analisi IA', confronto: 'Confronto', pronta: 'Pronta',
};

const TRANSIZIONI: Record<StatoJob, readonly StatoJob[]> = {
  in_coda: ['inviato', 'attesa_ia', 'errore', 'annullato'],
  inviato: ['in_analisi', 'confronto', 'attesa_ia', 'errore', 'annullato'],
  in_analisi: ['confronto', 'attesa_ia', 'errore', 'annullato'],
  confronto: ['fatto', 'errore'],
  attesa_ia: ['in_coda', 'errore', 'annullato'],      // scaduta l'attesa torna in coda e si reinvia
  errore: ['in_coda'],                                // «Riprova» a mano
  fatto: [],
  annullato: [],
};

export const puoPassare = (da: StatoJob, a: StatoJob): boolean => TRANSIZIONI[da].includes(a);

export function assertPassaggio(da: StatoJob, a: StatoJob): void {
  if (!puoPassare(da, a)) throw new Error(`Passaggio non consentito: ${da} → ${a}`);
}

/** Il passo (tappa) in cui si trova un lavoro per ogni stato. */
export const passoDi = (stato: StatoJob): PassoUtente =>
  stato === 'in_coda' || stato === 'attesa_ia' ? 'inviata'
  : stato === 'inviato' || stato === 'in_analisi' ? 'analisi'
  : stato === 'confronto' ? 'confronto'
  : 'pronta';

export type StatoTappa = 'fatto' | 'in_corso' | 'da_fare' | 'attenzione' | 'errore' | 'saltato';
export interface Tappa { passo: PassoUtente; etichetta: string; stato: StatoTappa; dettaglio?: string }

export interface JobPerTappe {
  stato: StatoJob;
  /** Il passo in cui il lavoro e' arrivato prima del guasto (per attesa_ia ed errore). */
  passo: PassoUtente;
  avanzamento?: { fatti: number; totale: number; etichetta: string } | null;
  errore?: string | null;
  esito?: 'uguale' | 'discrepanze' | null;
  prossimoTentativo?: string | null;
}

/**
 * Le sei tappe da mostrare. `job` = null: nessun lavoro (IA spenta o scheda anteriore all'IA) → tappe IA «saltate».
 * La scheda e' usabile dalla tappa «Letta»: «Pronta» si accende solo a fine giro, o resta in ambra se la IA non risponde.
 */
export function tappe(job: JobPerTappe | null): Tappa[] {
  const t = (passo: PassoUtente, stato: StatoTappa, dettaglio?: string): Tappa => ({ passo, etichetta: ETICHETTE[passo], stato, ...(dettaglio ? { dettaglio } : {}) });
  if (!job) {
    return [t('ricevuta', 'fatto'), t('letta', 'fatto'), t('inviata', 'saltato', 'IA spenta'), t('analisi', 'saltato'), t('confronto', 'saltato'), t('pronta', 'fatto', 'Senza IA')];
  }
  const base = [t('ricevuta', 'fatto'), t('letta', 'fatto')];
  const da = (passo: PassoUtente): Tappa => t(passo, 'da_fare');
  switch (job.stato) {
    case 'in_coda':
      return [...base, t('inviata', 'in_corso', 'In coda'), da('analisi'), da('confronto'), da('pronta')];
    case 'inviato':
      return [...base, t('inviata', 'fatto'), t('analisi', 'in_corso', 'Inviata, in attesa di partire'), da('confronto'), da('pronta')];
    case 'in_analisi': {
      const a = job.avanzamento;
      const dett = a ? `${a.etichetta} ${a.fatti}/${a.totale}`.trim() : undefined;
      return [...base, t('inviata', 'fatto'), t('analisi', 'in_corso', dett), da('confronto'), da('pronta')];
    }
    case 'confronto':
      return [...base, t('inviata', 'fatto'), t('analisi', 'fatto'), t('confronto', 'in_corso'), da('pronta')];
    case 'fatto':
      return [...base, t('inviata', 'fatto'), t('analisi', 'fatto'),
        job.esito === 'discrepanze' ? t('confronto', 'attenzione', 'Ci sono discrepanze') : t('confronto', 'fatto'), t('pronta', 'fatto')];
    case 'annullato':
      return [...base, t('inviata', 'saltato'), t('analisi', 'saltato'), t('confronto', 'saltato'), t('pronta', 'fatto', 'Senza IA')];
    case 'attesa_ia':
    case 'errore': {
      const guasto: PassoUtente = job.passo === 'analisi' || job.passo === 'confronto' ? job.passo : 'inviata';
      const stato: StatoTappa = job.stato === 'errore' ? 'errore' : 'attenzione';
      const dett = job.stato === 'errore' ? (job.errore ?? 'Errore') : `IA in attesa${job.prossimoTentativo ? `, riprovo ${job.prossimoTentativo}` : ''}`;
      const idx = PASSI_UTENTE.indexOf(guasto);
      return [...base, ...(['inviata', 'analisi', 'confronto'] as const).map((p): Tappa => {
        const i = PASSI_UTENTE.indexOf(p);
        return i < idx ? t(p, 'fatto') : i === idx ? t(p, stato, dett) : da(p);
      }), t('pronta', 'attenzione', 'Usabile senza IA')];
    }
  }
}
