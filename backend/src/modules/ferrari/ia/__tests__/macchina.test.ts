import { describe, expect, it } from 'vitest';
import { assertPassaggio, passoDi, puoPassare, STATI_JOB, tappe, type JobPerTappe } from '../macchina.js';

const stati = (j: JobPerTappe | null) => tappe(j).map(t => `${t.passo}:${t.stato}`).join(' ');

describe('stati del lavoro', () => {
  it('i passaggi validi', () => {
    expect(puoPassare('in_coda', 'inviato')).toBe(true);
    expect(puoPassare('inviato', 'in_analisi')).toBe(true);
    expect(puoPassare('in_analisi', 'confronto')).toBe(true);
    expect(puoPassare('confronto', 'fatto')).toBe(true);
    expect(puoPassare('attesa_ia', 'in_coda')).toBe(true);
    expect(puoPassare('errore', 'in_coda')).toBe(true);        // «Riprova»
    expect(puoPassare('confronto', 'attesa_ia')).toBe(true);   // guasto passeggero durante il confronto
  });
  it('quelli vietati e gli stati finali', () => {
    expect(puoPassare('fatto', 'in_coda')).toBe(false);
    expect(puoPassare('annullato', 'inviato')).toBe(false);
    expect(puoPassare('in_coda', 'fatto')).toBe(false);
    expect(puoPassare('confronto', 'in_analisi')).toBe(false);
    expect(() => assertPassaggio('fatto', 'inviato')).toThrow(/non consentito/);
    for (const s of STATI_JOB) expect(puoPassare(s, s)).toBe(false);   // niente passaggi su se' stessi
  });
  it('ogni stato ha il suo passo', () => {
    expect(passoDi('in_coda')).toBe('inviata');
    expect(passoDi('in_analisi')).toBe('analisi');
    expect(passoDi('confronto')).toBe('confronto');
    expect(passoDi('fatto')).toBe('pronta');
  });
});

describe('tappe mostrate all\'utente', () => {
  it('senza lavoro (IA spenta): le tappe IA sono saltate e la scheda e\' pronta senza IA', () => {
    expect(stati(null)).toBe('ricevuta:fatto letta:fatto inviata:saltato analisi:saltato confronto:saltato pronta:fatto');
    expect(tappe(null)[5]!.dettaglio).toBe('Senza IA');
  });
  it('in coda → inviato → in analisi (con avanzamento) → confronto → fatto', () => {
    expect(stati({ stato: 'in_coda', passo: 'inviata' })).toBe('ricevuta:fatto letta:fatto inviata:in_corso analisi:da_fare confronto:da_fare pronta:da_fare');
    expect(stati({ stato: 'inviato', passo: 'analisi' })).toBe('ricevuta:fatto letta:fatto inviata:fatto analisi:in_corso confronto:da_fare pronta:da_fare');
    const a = tappe({ stato: 'in_analisi', passo: 'analisi', avanzamento: { fatti: 2, totale: 5, etichetta: 'Riassunti' } });
    expect(a[3]).toMatchObject({ stato: 'in_corso', dettaglio: 'Riassunti 2/5' });
    expect(stati({ stato: 'confronto', passo: 'confronto' })).toBe('ricevuta:fatto letta:fatto inviata:fatto analisi:fatto confronto:in_corso pronta:da_fare');
    expect(stati({ stato: 'fatto', passo: 'pronta', esito: 'uguale' })).toBe('ricevuta:fatto letta:fatto inviata:fatto analisi:fatto confronto:fatto pronta:fatto');
  });
  it('a fine giro con discrepanze il confronto e\' in ambra ma la scheda e\' pronta', () => {
    const t = tappe({ stato: 'fatto', passo: 'pronta', esito: 'discrepanze' });
    expect(t[4]).toMatchObject({ stato: 'attenzione', dettaglio: 'Ci sono discrepanze' });
    expect(t[5]!.stato).toBe('fatto');
  });
  it('IA in attesa: ambra sul passo in cui si e\' fermata; le precedenti restano verdi; la scheda resta usabile', () => {
    expect(stati({ stato: 'attesa_ia', passo: 'inviata', prossimoTentativo: 'alle 10:05' }))
      .toBe('ricevuta:fatto letta:fatto inviata:attenzione analisi:da_fare confronto:da_fare pronta:attenzione');
    expect(stati({ stato: 'attesa_ia', passo: 'analisi' })).toBe('ricevuta:fatto letta:fatto inviata:fatto analisi:attenzione confronto:da_fare pronta:attenzione');
    expect(tappe({ stato: 'attesa_ia', passo: 'inviata', prossimoTentativo: 'alle 10:05' })[2]!.dettaglio).toContain('alle 10:05');
    expect(tappe({ stato: 'attesa_ia', passo: 'inviata' })[5]!.dettaglio).toBe('Usabile senza IA');
  });
  it('errore: rosso sul passo e il motivo', () => {
    const t = tappe({ stato: 'errore', passo: 'analisi', errore: 'Ollama non risponde' });
    expect(t[3]).toMatchObject({ stato: 'errore', dettaglio: 'Ollama non risponde' });
    expect(t[2]!.stato).toBe('fatto');
  });
  it('annullato: tappe IA saltate', () => {
    expect(stati({ stato: 'annullato', passo: 'pronta' })).toBe('ricevuta:fatto letta:fatto inviata:saltato analisi:saltato confronto:saltato pronta:fatto');
  });
  it('sempre sei tappe, nell\'ordine', () => {
    for (const s of STATI_JOB) expect(tappe({ stato: s, passo: 'inviata' }).map(t => t.passo)).toEqual(['ricevuta', 'letta', 'inviata', 'analisi', 'confronto', 'pronta']);
  });
});
