import { describe, it, expect, vi } from 'vitest';
import { createGuard, isTimeoutError, runWithReaper, WebthronBusyError } from '../webthron-guard.js';

/** Guardia con orologio finto: `sleep` fa avanzare il tempo senza attese reali. */
function makeGuard(over: Partial<Parameters<typeof createGuard>[0]> = {}) {
  let t = 1_000_000;
  const sleeps: number[] = [];
  const onOpen  = vi.fn();
  const onClose = vi.fn();
  const guard = createGuard({
    minGapMs: 200, slowMs: 3000, strikesToOpen: 2, cooldownMs: 300_000, maxQueue: 3,
    now: () => t,
    sleep: async (ms) => { sleeps.push(ms); t += ms; },
    onOpen, onClose,
    ...over,
  });
  return { guard, advance: (ms: number) => { t += ms; }, sleeps, onOpen, onClose };
}

describe('webthron-guard', () => {
  it('esegue le query una alla volta, nell\'ordine di arrivo', async () => {
    const { guard } = makeGuard();
    const log: string[] = [];
    let running = 0;
    let maxRunning = 0;
    const job = (name: string) => async () => {
      running++; maxRunning = Math.max(maxRunning, running);
      log.push(`start ${name}`);
      await Promise.resolve();
      log.push(`end ${name}`);
      running--;
      return name;
    };
    const res = await Promise.all([guard.run(job('a')), guard.run(job('b')), guard.run(job('c'))]);
    expect(res).toEqual(['a', 'b', 'c']);
    expect(maxRunning).toBe(1);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });

  it('rispetta la pausa minima tra due query', async () => {
    const { guard, sleeps } = makeGuard();
    await guard.run(async () => 1);
    await guard.run(async () => 2);
    expect(sleeps.length).toBe(1);
    expect(sleeps[0]).toBeGreaterThan(0);
    expect(sleeps[0]).toBeLessThanOrEqual(200);
  });

  it('rifiuta subito quando la coda è piena', async () => {
    const { guard } = makeGuard({ maxQueue: 2 });
    let unblock!: () => void;
    const gate = new Promise<void>(r => { unblock = r; });
    const p1 = guard.run(() => gate);
    const p2 = guard.run(async () => 2);
    await expect(guard.run(async () => 3)).rejects.toBeInstanceOf(WebthronBusyError);
    unblock();
    await Promise.all([p1, p2]);
  });

  it('apre l\'interruttore dopo due query lente di fila e rifiuta senza eseguire', async () => {
    const { guard, advance, onOpen } = makeGuard();
    const slow = () => async () => { advance(4000); return 'ok'; };
    await guard.run(slow());
    expect(guard.getState().open).toBe(false);
    await guard.run(slow());
    expect(guard.getState().open).toBe(true);
    expect(onOpen).toHaveBeenCalledTimes(1);

    const fn = vi.fn(async () => 'x');
    await expect(guard.run(fn)).rejects.toBeInstanceOf(WebthronBusyError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('una query veloce azzera il conteggio delle lente', async () => {
    const { guard, advance } = makeGuard();
    await guard.run(async () => { advance(4000); });
    await guard.run(async () => 'veloce');
    await guard.run(async () => { advance(4000); });
    expect(guard.getState().open).toBe(false);
  });

  it('conta i timeout come query lente anche se la durata è breve', async () => {
    const { guard } = makeGuard();
    const timeout = Object.assign(new Error('Query execution was interrupted'), { errno: 1969 });
    await expect(guard.run(async () => { throw timeout; })).rejects.toBe(timeout);
    await expect(guard.run(async () => { throw timeout; })).rejects.toBe(timeout);
    expect(guard.getState().open).toBe(true);
  });

  it('un errore normale non apre l\'interruttore', async () => {
    const { guard } = makeGuard();
    const boom = new Error('syntax');
    await expect(guard.run(async () => { throw boom; })).rejects.toBe(boom);
    await expect(guard.run(async () => { throw boom; })).rejects.toBe(boom);
    expect(guard.getState().open).toBe(false);
  });

  it('si richiude da solo dopo il periodo di riposo', async () => {
    const { guard, advance, onClose } = makeGuard({ cooldownMs: 60_000 });
    await guard.run(async () => { advance(4000); });
    await guard.run(async () => { advance(4000); });
    expect(guard.getState().open).toBe(true);

    advance(61_000);
    expect(guard.getState().open).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    await expect(guard.run(async () => 'ok')).resolves.toBe('ok');
  });

  it('gli strumenti di emergenza (bypass) funzionano anche a interruttore aperto', async () => {
    const { guard, advance } = makeGuard();
    await guard.run(async () => { advance(4000); });
    await guard.run(async () => { advance(4000); });
    expect(guard.getState().open).toBe(true);
    await expect(guard.run(async () => 'kill', { bypass: true })).resolves.toBe('kill');
  });
});

describe('runWithReaper', () => {
  it('se la query supera il tempo, chiama onStuck una volta sola', async () => {
    vi.useFakeTimers();
    try {
      const onStuck = vi.fn();
      let done!: () => void;
      const slow = new Promise<string>(r => { done = () => r('ok'); });
      const p = runWithReaper(() => slow, 20_000, onStuck);

      await vi.advanceTimersByTimeAsync(19_999);
      expect(onStuck).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2);
      expect(onStuck).toHaveBeenCalledTimes(1);

      done();
      await expect(p).resolves.toBe('ok');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(onStuck).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('se la query finisce in tempo, il vigilante non interviene', async () => {
    vi.useFakeTimers();
    try {
      const onStuck = vi.fn();
      await expect(runWithReaper(async () => 42, 20_000, onStuck)).resolves.toBe(42);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(onStuck).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('se la query fallisce, ferma il vigilante e rilancia l\'errore', async () => {
    vi.useFakeTimers();
    try {
      const onStuck = vi.fn();
      const boom = new Error('x');
      await expect(runWithReaper(async () => { throw boom; }, 20_000, onStuck)).rejects.toBe(boom);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(onStuck).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('un errore dentro onStuck non rompe nulla', async () => {
    vi.useFakeTimers();
    try {
      let done!: () => void;
      const slow = new Promise<void>(r => { done = r; });
      const p = runWithReaper(() => slow, 1000, async () => { throw new Error('kill fallito'); });
      await vi.advanceTimersByTimeAsync(1500);
      done();
      await expect(p).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('isTimeoutError', () => {
  it('riconosce i timeout di MariaDB e del driver', () => {
    expect(isTimeoutError({ errno: 1969 })).toBe(true);
    expect(isTimeoutError({ code: 'ER_STATEMENT_TIMEOUT' })).toBe(true);
    expect(isTimeoutError({ code: 'PROTOCOL_SEQUENCE_TIMEOUT' })).toBe(true);
    expect(isTimeoutError({ code: 'ER_PARSE_ERROR' })).toBe(false);
    expect(isTimeoutError(null)).toBe(false);
  });
});
