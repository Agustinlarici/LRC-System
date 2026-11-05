import { describe, expect, it } from 'vitest';
import { firma, FINESTRA_S, intestazioniFirmate, stringaDaFirmare, verificaFirma } from '../firma.js';

const S = 'segreto-di-prova';
const corpo = Buffer.from('{"a":1}');
const T = 1_800_000_000_000;

describe('firma HMAC delle richieste', () => {
  it('e\' deterministica e dipende da tutti i campi', () => {
    const d = { metodo: 'POST', percorso: '/v1/analisi', time: 1800000000, nonce: 'n1', corpo };
    expect(firma(S, d)).toBe(firma(S, { ...d }));
    for (const v of [{ metodo: 'PUT' }, { percorso: '/v1/sigle' }, { time: 1800000001 }, { nonce: 'n2' }, { corpo: Buffer.from('{"a":2}') }]) {
      expect(firma(S, { ...d, ...v })).not.toBe(firma(S, d));
    }
    expect(firma('altro', d)).not.toBe(firma(S, d));
    expect(stringaDaFirmare(d).split('\n')).toHaveLength(5);
  });

  it('una richiesta firmata si verifica; metodo e percorso contano', () => {
    const h = intestazioniFirmate(S, 'post', '/v1/analisi', corpo, () => T, () => 'nonce-1');
    const dalFilo = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));
    expect(verificaFirma(S, { metodo: 'POST', percorso: '/v1/analisi', corpo }, dalFilo, () => T)).toEqual({ ok: true });
    expect(verificaFirma(S, { metodo: 'GET', percorso: '/v1/analisi', corpo }, dalFilo, () => T)).toMatchObject({ ok: false, motivo: 'firma' });
    expect(verificaFirma(S, { metodo: 'POST', percorso: '/v1/sigle', corpo }, dalFilo, () => T)).toMatchObject({ ok: false, motivo: 'firma' });
    expect(verificaFirma(S, { metodo: 'POST', percorso: '/v1/analisi', corpo: Buffer.from('x') }, dalFilo, () => T)).toMatchObject({ ok: false, motivo: 'firma' });
    expect(verificaFirma('sbagliato', { metodo: 'POST', percorso: '/v1/analisi', corpo }, dalFilo, () => T)).toMatchObject({ ok: false, motivo: 'firma' });
  });

  it('rifiuta ora fuori finestra e intestazioni mancanti o malformate', () => {
    const h = intestazioniFirmate(S, 'GET', '/v1/salute', '', () => T, () => 'n');
    const dalFilo = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));
    const d = { metodo: 'GET', percorso: '/v1/salute', corpo: '' };
    expect(verificaFirma(S, d, dalFilo, () => T + (FINESTRA_S - 1) * 1000)).toEqual({ ok: true });
    expect(verificaFirma(S, d, dalFilo, () => T + (FINESTRA_S + 1) * 1000)).toMatchObject({ motivo: 'tempo' });
    expect(verificaFirma(S, d, dalFilo, () => T - (FINESTRA_S + 1) * 1000)).toMatchObject({ motivo: 'tempo' });
    expect(verificaFirma(S, d, {}, () => T)).toMatchObject({ motivo: 'intestazioni' });
    expect(verificaFirma(S, d, { ...dalFilo, 'x-ferrari-signature': 'zz' }, () => T)).toMatchObject({ ok: false });
    expect(verificaFirma(S, d, { ...dalFilo, 'x-ferrari-time': 'abc' }, () => T)).toMatchObject({ motivo: 'intestazioni' });
  });
});
