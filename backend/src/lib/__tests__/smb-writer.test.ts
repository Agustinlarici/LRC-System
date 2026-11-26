import { describe, expect, it } from 'vitest';
import { cartellaOutputAccessibile } from '../smb-writer.js';

const BS = String.fromCharCode(92);

describe('cartellaOutputAccessibile', () => {
  it('un percorso UNC è accettato senza controllo locale (sia in creazione sia in modifica)', async () => {
    const unc = ['', '', 'server.example', 'share', 'cartella'].join(BS);
    expect(unc.startsWith(BS + BS)).toBe(true);
    expect(await cartellaOutputAccessibile(unc)).toBe(true);
    expect(await cartellaOutputAccessibile('//server.example/share/cartella')).toBe(true);
  });
  it('una cartella locale inesistente non è accessibile', async () => {
    expect(await cartellaOutputAccessibile('/percorso/che/non/esiste/mai')).toBe(false);
  });
});
