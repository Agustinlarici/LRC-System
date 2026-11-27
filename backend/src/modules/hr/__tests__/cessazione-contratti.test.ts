import { describe, it, expect, beforeEach, vi } from 'vitest';

// db simulato: registra le query (testo + valori) e risponde con quanto impostato in `stato`.
const h = vi.hoisted(() => {
  process.env.JWT_SECRET = 'test';   // lib/auth.js (importato da osti.js e contracts.js) lo richiede all'import
  return { calls: [] as { text: string; values: unknown[] }[], rows: [] as unknown[] };
});
vi.mock('../../../db/client.js', () => {
  // db({...}) (helper di postgres.js) → oggetto riconoscibile; db`...` → registra la query
  const db: any = (a: any, ...v: unknown[]) => {
    if (!Array.isArray(a)) return { __set: a };
    const text = a.join('?');
    h.calls.push({ text, values: v });
    return Promise.resolve(text.trim().startsWith('SELECT') ? h.rows : []);
  };
  return { db };
});
vi.mock('../../../lib/logger.js', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { applyEmployeeUpdate, cessaScaduti } from '../employee-update.js';
import { buildPlan, contrattiOf } from '../osti-sync.js';
import { registraContratto } from '../contracts.js';

const PASSATA = '2000-01-31';
const FUTURA = '2999-01-31';
const actor = { id: null, display_name: 'test' };

const updateSet = () => (h.calls.find(c => c.text.includes('UPDATE hr_employee SET'))!.values[0] as { __set: Record<string, unknown> }).__set;
const eventi = () => h.calls.filter(c => c.text.includes('INSERT INTO hr_employee_event')).map(c => (c.values[0] as { __set: Record<string, unknown> }).__set);

beforeEach(() => { h.calls.length = 0; h.rows = []; });

describe('data di cessazione trascorsa → cessato', () => {
  it('modifica della scheda con data passata: stato cessato e evento alla data di cessazione', async () => {
    await applyEmployeeUpdate(1, { stato: 'attivo' }, { stato: 'attivo', data_cessazione: PASSATA }, { silent: false, actor });
    expect(updateSet()).toMatchObject({ stato: 'cessato', data_cessazione: PASSATA });
    expect(eventi()).toEqual([expect.objectContaining({ event_type: 'cessazione', event_date: PASSATA, from_value: 'attivo', to_value: 'cessato' })]);
  });

  it('data futura (scadenza del contratto): resta attivo e nessun evento', async () => {
    await applyEmployeeUpdate(1, { stato: 'attivo' }, { data_cessazione: FUTURA }, { silent: false, actor });
    expect(updateSet().stato).toBeUndefined();
    expect(eventi()).toEqual([]);
  });

  it('già cessato che riceve una data passata: nessun secondo evento di cessazione', async () => {
    await applyEmployeeUpdate(1, { stato: 'cessato' }, { data_cessazione: PASSATA }, { silent: false, actor });
    expect(eventi()).toEqual([]);
  });

  it('stato cessato scelto a mano con data passata: un solo evento', async () => {
    await applyEmployeeUpdate(1, { stato: 'attivo' }, { stato: 'cessato', data_cessazione: PASSATA }, { silent: false, actor });
    expect(eventi()).toHaveLength(1);
  });

  it('riattivazione (cessato → attivo) con la vecchia data passata: la data si toglie, resta attivo', async () => {
    await applyEmployeeUpdate(1, { stato: 'cessato' }, { stato: 'attivo', data_cessazione: PASSATA }, { silent: false, actor });
    expect(updateSet()).toMatchObject({ stato: 'attivo', data_cessazione: null });
  });

  it('cessaScaduti chiude chi ha la data passata, con la data originale (non oggi)', async () => {
    h.rows = [{ id: 7, stato: 'attivo', data_cessazione: PASSATA }];
    expect(await cessaScaduti()).toBe(1);
    expect(updateSet()).toMatchObject({ stato: 'cessato', data_cessazione: PASSATA });
    expect(eventi()).toEqual([expect.objectContaining({ employee_id: 7, event_type: 'cessazione', event_date: PASSATA })]);
  });
});

describe('sync Osti: piano di una scheda', () => {
  const ctx = {
    today: '2026-11-27',
    deptByName: new Map(), deptName: new Map(), plantByName: new Map(), plantName: new Map(),
    companyByName: new Map(), companyName: new Map(),
    matricolaOwner: new Map(), matricolaOf: new Map(), claimed: new Set<string>(),
  };
  const emp = (o: Record<string, unknown>) => ({ id: 1, nome: 'Mario', cognome: 'Rossi', stato: 'attivo', matricola: null, nome_osti: 'Rossi Mario', reparto_id: null, contract_company_id: null, plant_ids: null, ...o });
  const riga = (o: Record<string, string>) => ({ dip_nome: 'Rossi Mario', dip_assunto: '01/01/2025', dip_licenziato: '', ...o });

  it('riga in corso e data di cessazione vecchia nella scheda: la data si toglie (altrimenti il job lo rimetterebbe cessato)', () => {
    const { plan } = buildPlan(emp({ data_cessazione: '2025-12-31' }) as never, riga({}) as never, { ...ctx, claimed: new Set() });
    expect(plan?.change.data_cessazione).toBeNull();
  });

  it('riga in corso e data di cessazione futura: non si tocca', () => {
    const { plan } = buildPlan(emp({ data_cessazione: '2999-01-01' }) as never, riga({}) as never, { ...ctx, claimed: new Set() });
    expect(plan?.change.data_cessazione).toBeUndefined();
  });

  it('riga chiusa nel passato: la scheda diventa cessata', () => {
    const { plan } = buildPlan(emp({}) as never, riga({ dip_licenziato: '31/12/2025' }) as never, { ...ctx, claimed: new Set() });
    expect(plan).toMatchObject({ cessa: true, change: { stato: 'cessato', data_cessazione: '2025-12-31' } });
  });
});

describe('sync Osti: contratti', () => {
  it('una sola riga in Osti = un contratto (prima serviva più di una riga)', () => {
    const c = contrattiOf([{ dip_nome: 'Rossi Mario', dip_assunto: '01/01/2025', dip_licenziato: '', ditta: 'STR', dip_matricola: '0012' }] as never);
    expect(c).toEqual([expect.objectContaining({ inizio: '2025-01-01', fine: null, tipo: 'STR', matricola: '0012' })]);
  });

  it('più righe = più contratti, in ordine di inizio; la stessa coppia di date non si ripete', () => {
    const c = contrattiOf([
      { dip_assunto: '01/06/2025', dip_licenziato: '', ditta: 'STR' },
      { dip_assunto: '01/01/2024', dip_licenziato: '31/12/2024', ditta: 'ADECCO' },
      { dip_assunto: '01/01/2024', dip_licenziato: '31/12/2024', ditta: 'ADECCO' },
    ] as never);
    expect(c.map(x => [x.inizio, x.fine, x.tipo])).toEqual([['2024-01-01', '2024-12-31', 'INTERINALE'], ['2025-06-01', null, 'STR']]);
  });
});

describe('registraContratto', () => {
  // tx simulato: risponde per tipo di query
  const mkTx = (r: { update?: unknown[]; insert?: unknown[] }) => {
    const log: string[] = [];
    const tx: any = (a: any) => {
      const text = a.join('?');
      log.push(text);
      if (text.includes('UPDATE hr_employee_contract SET data_fine')) return Promise.resolve(r.update ?? []);
      if (text.includes('INSERT INTO hr_employee_contract')) return Promise.resolve(r.insert ?? []);
      return Promise.resolve([]);
    };
    return { tx, log };
  };
  const has = (log: string[], frag: string) => log.some(t => t.includes(frag));
  const user = { id: null, display_name: 'test' };
  const oggi = '2026-11-27';

  it('contratto nuovo e già finito: assunzione e cessazione (senza doppioni)', async () => {
    const { tx, log } = mkTx({ insert: [{ id: 1 }] });
    const r = await registraContratto(tx, 1, { matricola: null, qualifica: null, tipo: 'STR', inizio: '2024-01-01', fine: '2024-12-31' }, user, oggi, 'Contratto Osti');
    expect(r).toBe(true);
    expect(log.filter(t => t.includes('INSERT INTO hr_employee_event') && t.includes('NOT EXISTS'))).toHaveLength(2);
  });

  it('contratto aperto che Osti ora chiude: si aggiorna la riga (nessun secondo contratto) e si completa l\'evento', async () => {
    const { tx, log } = mkTx({ update: [{ id: 5 }], insert: [] });   // l'INSERT va in conflitto con la riga appena chiusa
    const r = await registraContratto(tx, 1, { matricola: null, qualifica: null, tipo: 'STR', inizio: '2024-01-01', fine: '2024-12-31' }, user, oggi, 'Contratto Osti');
    expect(r).toBe(true);
    expect(has(log, 'UPDATE hr_employee_event SET end_date')).toBe(true);
    expect(has(log, 'DELETE FROM hr_employee_contract')).toBe(true);   // tolto l'eventuale doppione aperto
  });

  it('contratto già presente e invariato: false, nessun evento', async () => {
    const { tx, log } = mkTx({});
    const r = await registraContratto(tx, 1, { matricola: null, qualifica: null, tipo: null, inizio: '2024-01-01', fine: '2024-12-31' }, user, oggi, 'Contratto Osti');
    expect(r).toBe(false);
    expect(has(log, 'INSERT INTO hr_employee_event')).toBe(false);
  });

  it('contratto aperto invariato: non cerca di chiuderlo e non crea eventi', async () => {
    const { tx, log } = mkTx({});
    const r = await registraContratto(tx, 1, { matricola: null, qualifica: null, tipo: null, inizio: '2025-01-01', fine: null }, user, oggi, 'Contratto Osti');
    expect(r).toBe(false);
    expect(has(log, 'SET data_fine')).toBe(false);
    expect(has(log, 'INSERT INTO hr_employee_event')).toBe(false);
  });
});
