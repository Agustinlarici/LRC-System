import { describe, it, expect } from 'vitest';
import { computeHealth, type HealthInput } from '../health.js';

const base: HealthInput = { status: 'attivo', idle_days: 0, phases: [], tasks: [] };
const task = (o: Partial<HealthInput['tasks'][number]> = {}) =>
  ({ title: 'T', status: 'da_fare', status_note: null, due_days: null, waiting_days: null, phase_due_days: null, ...o });

describe('semaforo del progetto', () => {
  it('verde senza segnali', () => {
    const h = computeHealth({ ...base, tasks: [task({ due_days: 5 })], phases: [{ name: 'A', due_days: 10, open_tasks: 1 }] });
    expect(h).toMatchObject({ tone: 'success', label: 'In linea', reasons: [] });
  });

  it('in pausa e chiuso sono neutri e senza motivi, anche con attività in ritardo', () => {
    const t = [task({ due_days: -9 })];
    expect(computeHealth({ ...base, status: 'in_pausa', tasks: t })).toMatchObject({ tone: 'neutral', label: 'In pausa', reasons: [] });
    expect(computeHealth({ ...base, status: 'chiuso', tasks: t })).toMatchObject({ tone: 'neutral', label: 'Chiuso' });
  });

  it('rosso: fase scaduta con attività aperte', () => {
    const h = computeHealth({ ...base, phases: [{ name: 'Preparazione', due_days: -2, open_tasks: 2 }] });
    expect(h.tone).toBe('danger');
    expect(h.reasons[0]).toBe('La fase «Preparazione» è scaduta con 2 attività aperte');
  });

  it('una fase scaduta ma completa non da segnale', () => {
    expect(computeHealth({ ...base, phases: [{ name: 'Fatta', due_days: -30, open_tasks: 0 }] }).tone).toBe('success');
  });

  it('rosso: attività aperta scaduta', () => {
    const h = computeHealth({ ...base, tasks: [task({ title: 'Backup', due_days: -2 })] });
    expect(h).toMatchObject({ tone: 'danger', label: 'In ritardo' });
    expect(h.reasons).toEqual(['«Backup» è in ritardo (scaduta da 2 g)']);
  });

  it('giallo: bloccata (con motivo), in attesa da 3+ giorni, oltre la fase, fermo da 7+ giorni', () => {
    expect(computeHealth({ ...base, tasks: [task({ title: 'Server', status: 'bloccata', status_note: 'manca la licenza' })] }).reasons)
      .toEqual(['«Server» è bloccata: manca la licenza']);
    expect(computeHealth({ ...base, tasks: [task({ status: 'in_attesa', waiting_days: 3 })] }).tone).toBe('warning');
    expect(computeHealth({ ...base, tasks: [task({ status: 'in_attesa', waiting_days: 2 })] }).tone).toBe('success');
    expect(computeHealth({ ...base, tasks: [task({ due_days: 9, phase_due_days: 6 })] }).tone).toBe('warning');
    expect(computeHealth({ ...base, tasks: [task({ due_days: 6, phase_due_days: 6 })] }).tone).toBe('success');
    expect(computeHealth({ ...base, idle_days: 7 }).reasons).toEqual(['Nessun movimento da 7 giorni']);
    expect(computeHealth({ ...base, idle_days: 6 }).tone).toBe('success');
  });

  it('il rosso vince sul giallo e conserva tutti i motivi', () => {
    const h = computeHealth({ ...base, idle_days: 10, tasks: [task({ title: 'A', due_days: -1 }), task({ title: 'B', status: 'bloccata' })] });
    expect(h.tone).toBe('danger');
    expect(h.reasons).toHaveLength(3);
  });
});
