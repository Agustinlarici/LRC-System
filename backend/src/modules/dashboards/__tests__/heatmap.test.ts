import { describe, it, expect, vi } from 'vitest';
import {
  computeCellOee,
  computeHourlyCells,
  romeOffsetForDate,
  type HeatmapWebthronRow,
} from '../heatmap.js';

// Mock all external dependencies — heatmap.ts computation is pure once these are mocked
vi.mock('../../../db/client.js', () => ({ db: vi.fn() }));
vi.mock('../../monitor/mysql-client.js', () => ({ getWebthronPool: vi.fn() }));
vi.mock('../../monitor/executive-cache.js', () => ({
  getDeliberaFasi: vi.fn(() => []),
  isConforming: vi.fn((e: string | null) => e === 'OK' || e === 'Accettato'),
}));
vi.mock('../../../lib/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRow(
  fase: string,
  modello: string,
  componente: string,
  data_inserimento: Date,
  overrides: Partial<HeatmapWebthronRow> = {}
): HeatmapWebthronRow {
  return {
    fase,
    modello,
    componente,
    cod_seriale: `SN-${Math.random().toString(36).slice(2, 8)}`,
    esito_delibera: null,
    data_inserimento,
    ...overrides,
  };
}

const DATE = '2025-06-15'; // summer — Rome is +02:00
const FASE = 'FASE_A';
const MOD  = 'Modello1';
const COMP = 'Componente1';
const COMBOS = [{ modello: MOD, componente: COMP }];

// Helper to create a UTC Date that corresponds to a given Rome local time.
// offset from romeOffsetForDate is e.g. "02:00" meaning UTC+2 (Rome summer).
// UTC = local_time - offset  (e.g. 08:00 Rome = 06:00 UTC when offset is +02:00)
function romeTime(dateStr: string, hh: number, mm: number, ss = 0): Date {
  const offset = romeOffsetForDate(dateStr);
  const isNeg  = offset.startsWith('-');
  const [oh, om] = offset.replace('-', '').split(':').map(Number);
  // If Rome is UTC+oh:om, then UTC = local - oh:om
  const totalUtcMin = hh * 60 + mm - (isNeg ? -(oh * 60 + om) : oh * 60 + om);
  const utcH = Math.floor(totalUtcMin / 60);
  const utcM = totalUtcMin % 60;
  return new Date(`${dateStr}T${String(utcH).padStart(2,'0')}:${String(utcM).padStart(2,'0')}:${String(ss).padStart(2,'0')}Z`);
}

// ─── romeOffsetForDate ─────────────────────────────────────────────────────────

describe('romeOffsetForDate', () => {
  it('returns +02:00 for summer date', () => {
    expect(romeOffsetForDate('2025-06-15')).toBe('02:00');
  });

  it('returns +01:00 for winter date', () => {
    expect(romeOffsetForDate('2025-01-15')).toBe('01:00');
  });
});

// ─── computeCellOee ───────────────────────────────────────────────────────────

describe('computeCellOee', () => {
  it('Test 1: no shift configured → has_data=false, oee=0', () => {
    const pgDay = {
      minuti_turno: 0,
      minuti_pausa: 0,
      pezzi_pianificati: 0,
      turno_inizio: null,
    };
    const result = computeCellOee(1, FASE, COMBOS, pgDay, [], DATE, []);
    expect(result.has_data).toBe(false);
    expect(result.oee).toBe(0);
    expect(result.disponibilita).toBe(0);
    expect(result.performance).toBe(0);
  });

  it('Test 2: shift configured, production matches planned → oee=100, disponibilita≈100, performance=100', () => {
    // 60 min net (10min pausa from 60min turno), 30 planned pieces => cycleTime = 60*60/30 = 120s
    const pgDay = {
      minuti_turno:      60,
      minuti_pausa:      0,
      pezzi_pianificati: 30,
      turno_inizio:      '08:00',
    };
    // Create 30 rows evenly spaced every 2 min starting exactly at turno_inizio
    const rows: HeatmapWebthronRow[] = Array.from({ length: 30 }, (_, i) =>
      makeRow(FASE, MOD, COMP, romeTime(DATE, 8, i * 2, 0))
    );
    const result = computeCellOee(1, FASE, COMBOS, pgDay, rows, DATE, []);
    expect(result.has_data).toBe(true);
    expect(result.pezzi_reali).toBe(30);
    expect(result.performance).toBe(100);
    // No gaps > cycleTime → minuti_fermo = 0 → disponibilita = 100
    expect(result.disponibilita).toBe(100);
    expect(result.oee).toBe(100);
  });

  it('Test 3: shift configured, half the pieces → performance≈50', () => {
    const pgDay = {
      minuti_turno:      60,
      minuti_pausa:      0,
      pezzi_pianificati: 30,
      turno_inizio:      '08:00',
    };
    // Only 15 rows
    const rows: HeatmapWebthronRow[] = Array.from({ length: 15 }, (_, i) =>
      makeRow(FASE, MOD, COMP, romeTime(DATE, 8, i * 2, 0))
    );
    const result = computeCellOee(1, FASE, COMBOS, pgDay, rows, DATE, []);
    expect(result.performance).toBe(50);
    expect(result.oee).toBeLessThanOrEqual(50);
  });

  it('Test 4: gap detected → minuti_fermo > 0, disponibilita < 100', () => {
    // cycleTime = 60*60/30 = 120s
    const pgDay = {
      minuti_turno:      60,
      minuti_pausa:      0,
      pezzi_pianificati: 30,
      turno_inizio:      '08:00',
    };
    // 1 piece at 08:00, then a big gap (20 min), then more pieces
    const rows: HeatmapWebthronRow[] = [
      makeRow(FASE, MOD, COMP, romeTime(DATE, 8, 0, 0)),
      // 20 min gap > 2 min cycleTime
      ...Array.from({ length: 10 }, (_, i) =>
        makeRow(FASE, MOD, COMP, romeTime(DATE, 8, 20 + i * 2, 0))
      ),
    ];
    const result = computeCellOee(1, FASE, COMBOS, pgDay, rows, DATE, []);
    expect(result.minuti_fermo).toBeGreaterThan(0);
    expect(result.disponibilita).toBeLessThan(100);
    expect(result.fermi_count).toBeGreaterThan(0);
  });

  it('Test 5: shift with delibera → qualita < 100 when non-conforming pieces exist', () => {
    const pgDay = {
      minuti_turno:      60,
      minuti_pausa:      0,
      pezzi_pianificati: 10,
      turno_inizio:      '08:00',
    };
    const DELIBERA_FASE = 'DELIBERA';

    // 10 production rows with known serials
    const prodRows: HeatmapWebthronRow[] = Array.from({ length: 10 }, (_, i) =>
      makeRow(FASE, MOD, COMP, romeTime(DATE, 8, i * 5, 0), { cod_seriale: `SN${i}` })
    );

    // 10 delibera rows: 5 OK, 5 KO
    const deliberaRows: HeatmapWebthronRow[] = Array.from({ length: 10 }, (_, i) =>
      makeRow(DELIBERA_FASE, MOD, COMP, romeTime(DATE, 9, i * 5, 0), {
        cod_seriale:    `SN${i}`,
        esito_delibera: i < 5 ? 'OK' : 'KO',
      })
    );

    const allRows = [...prodRows, ...deliberaRows];
    const result = computeCellOee(1, FASE, COMBOS, pgDay, allRows, DATE, [DELIBERA_FASE]);

    expect(result.pezzi_deliberati).toBe(10);
    // 5 conforming out of 10 → qualita = 50
    expect(result.qualita).toBe(50);
    expect(result.oee).toBeLessThan(100);
  });
});

// ─── computeHourlyCells ───────────────────────────────────────────────────────

describe('computeHourlyCells', () => {
  it('Test 1: no shift → returns empty array', () => {
    const pgDay = {
      minuti_turno:      0,
      minuti_pausa:      0,
      pezzi_pianificati: 0,
      turno_inizio:      null,
      turno_fine:        null,
    };
    const cells = computeHourlyCells(1, FASE, COMBOS, pgDay, [], DATE);
    expect(cells).toHaveLength(0);
  });

  it('Test 2: shift 06:00-22:00, production in block 06-10 → block has data', () => {
    const pgDay = {
      minuti_turno:      960,
      minuti_pausa:      0,
      pezzi_pianificati: 240,
      turno_inizio:      '06:00',
      turno_fine:        '22:00',
    };
    // 10 pieces in the 06-10 block
    const rows: HeatmapWebthronRow[] = Array.from({ length: 10 }, (_, i) =>
      makeRow(FASE, MOD, COMP, romeTime(DATE, 6, i * 20, 0))
    );
    const cells = computeHourlyCells(1, FASE, COMBOS, pgDay, rows, DATE);
    // There should be 4 blocks (06-10, 10-14, 14-18, 18-22)
    expect(cells.length).toBe(4);
    const block06 = cells.find(c => c.ora === 6);
    expect(block06).toBeDefined();
    expect(block06!.pezzi_reali).toBe(10);
    expect(block06!.has_data).toBe(true);
  });

  it('Test 3: gap in block 10-14 → that block has minuti_fermo > 0', () => {
    const pgDay = {
      minuti_turno:      960,
      minuti_pausa:      0,
      pezzi_pianificati: 240,
      turno_inizio:      '06:00',
      turno_fine:        '22:00',
    };
    // Put 1 piece at 10:00 then a 60-min gap then more pieces — cycleTime = 960*60/240 = 240s = 4 min
    const rows: HeatmapWebthronRow[] = [
      makeRow(FASE, MOD, COMP, romeTime(DATE, 10, 0, 0)),
      // 60 min gap >> 4 min cycle
      ...Array.from({ length: 5 }, (_, i) =>
        makeRow(FASE, MOD, COMP, romeTime(DATE, 11, i * 4, 0))
      ),
    ];
    const cells = computeHourlyCells(1, FASE, COMBOS, pgDay, rows, DATE);
    const block10 = cells.find(c => c.ora === 10);
    expect(block10).toBeDefined();
    expect(block10!.minuti_fermo).toBeGreaterThan(0);
    expect(block10!.disponibilita).toBeLessThan(100);
  });

  it('Test 4: no production in working block → minuti_fermo equals effMin (full block fermo)', () => {
    const pgDay = {
      minuti_turno:      960,
      minuti_pausa:      0,
      pezzi_pianificati: 240,
      turno_inizio:      '06:00',
      turno_fine:        '22:00',
    };
    // Production only in 06-10 block, nothing in 10-14
    const rows: HeatmapWebthronRow[] = Array.from({ length: 5 }, (_, i) =>
      makeRow(FASE, MOD, COMP, romeTime(DATE, 6, i * 30, 0))
    );
    const cells = computeHourlyCells(1, FASE, COMBOS, pgDay, rows, DATE);
    const block10 = cells.find(c => c.ora === 10);
    expect(block10).toBeDefined();
    // No production in 10-14 → entire 240 min should be fermo
    expect(block10!.pezzi_reali).toBe(0);
    expect(block10!.minuti_fermo).toBe(block10!.pezzi_attesi > 0 ? Math.round(240) : 0);
    // More specific: effMin for a fully-covered block is 240 min
    expect(block10!.minuti_fermo).toBe(240);
  });
});
