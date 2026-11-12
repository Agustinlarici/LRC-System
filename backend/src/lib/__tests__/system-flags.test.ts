import { describe, it, expect } from 'vitest';
import { closeBucciWhenSyncOpens, IKNOW_SYNC_FLAGS } from '../system-flags.js';

describe('closeBucciWhenSyncOpens', () => {
  it.each(IKNOW_SYNC_FLAGS)('attivare %s spegne anche Bucci', (flag) => {
    expect(closeBucciWhenSyncOpens({ [flag]: true })).toEqual({ [flag]: true, iknow_bucci_enabled: false });
  });

  it('spegnere una sincronizzazione non tocca Bucci', () => {
    expect(closeBucciWhenSyncOpens({ iknow_andon_enabled: false })).toEqual({ iknow_andon_enabled: false });
  });

  it('accendere Bucci da solo non tocca nulla', () => {
    expect(closeBucciWhenSyncOpens({ iknow_bucci_enabled: true })).toEqual({ iknow_bucci_enabled: true });
  });

  it('il toggle generale non chiude Bucci', () => {
    expect(closeBucciWhenSyncOpens({ iknow_enabled: true })).toEqual({ iknow_enabled: true });
  });

  it('se la stessa modifica accende Bucci espressamente, lo lascia acceso', () => {
    const input = { iknow_andon_enabled: true, iknow_bucci_enabled: true };
    expect(closeBucciWhenSyncOpens(input)).toEqual(input);
  });

  it('non modifica l\'oggetto ricevuto', () => {
    const input = { iknow_nightly_enabled: true };
    closeBucciWhenSyncOpens(input);
    expect(input).toEqual({ iknow_nightly_enabled: true });
  });
});
