// Schede Ferrari SINTETICHE (dati inventati, stessa forma delle schede reali).
// Servono ai test: le schede vere non entrano nel repository.

import * as XLSX from 'xlsx';

type Riga = (string | number | null)[];

const pad = (s: string, n: number) => s.padEnd(n, ' ');
const opz = (codice: string, descr: string, valore: string | number, nota?: string): Riga =>
  [pad(codice, 16), pad(descr, 30), typeof valore === 'string' ? pad(valore, 30) : valore, nota ?? null];
const sez = (nome: string): Riga => [nome];
const txt = (testo: string): Riga => [testo];

export function testata(opts: { commessa?: number; modello?: string; mercato?: string; sigla?: string; paese?: string; variante?: number } = {}): Riga[] {
  const commessa = opts.commessa ?? 100001;
  const modello = opts.modello ?? 'F999XX';
  const mercato = opts.mercato ?? '27';
  const sigla = opts.sigla ?? 'CHI';
  const paese = opts.paese ?? 'CINA';
  return [
    [pad('COMMESSA', 16), commessa],
    [pad('VARIANTE', 16), opts.variante ?? 123456789, '   0    26.10.2026 12:58'],
    [pad('TIPO E MATRICOLA', 16), pad(`${modello} - ${modello}AB850/${mercato} ${sigla} MY27`, 30),
      `         9990000${mercato}                               100001`],
    [pad('DESTINAZIONE', 16), pad(paese, 30), `MRKT${' '.repeat(24)}${sigla} ${paese}${' '.repeat(27)}${mercato}`],
    [pad('NUMERO DI TELAIO', 16), 110],
  ];
}

/** Scheda semplice: nessun testo libero. */
export function schedaSemplice(opts: Parameters<typeof testata>[0] = {}): Riga[] {
  return [
    ...testata(opts),
    sez('ALLESTIMENTO'),
    sez('ESTERNI'),
    opz('EXTC', 'Esterni', 'EXTRACAMPIONARIO-NOT STANDARD'),
    opz('PNCC', 'COLORI CLASSICI', 'ROSSO TEST'),
    opz('CEL2', 'ALLEST.VANO MOTORE IN CARBONIO', 'SI'),
    opz('TYBR', 'PNEUMATICI MARCA X', 'SI', 'CLIENTE'),
    opz('BOLN', 'CIRCLES NUMBERS', 50, '*** ATTENZIONE OPT BOLN, VERIFICARE IL NUMERO RICHIESTO ***'),
    sez('CERCHI'),
    opz('RSFD', 'CERCHI 20" FORGIATI DIAMANTATI', 'SI'),
    sez('INTERNI'),
    opz('INTC', 'Interni', 'ALCANTARA NERA 9440'),
    sez('NO_TICKET_REQUIRED'),
  ];
}

/** Scheda con testo libero: righe spezzate a ~80 caratteri, due blocchi LATO, immagini, segnaposto. */
export function schedaPersonalizzata(opts: Parameters<typeof testata>[0] = {}): Riga[] {
  return [
    ...testata(opts),
    sez('ALLESTIMENTO'),
    sez('ESTERNI'),
    opz('EXTC', 'Esterni', 'EXTRACAMPIONARIO-NOT STANDARD'),
    opz('PNT1', 'VERNICI SU CAMPIONE 2 STRATI', 'EXTRACAMPIONARIO-NOT STANDARD'),
    txt('VERNICIARE VETTURA IN COLORE BLU PROVA LUCIDO COD.VERN XYZ.*0229. VEDERE'),
    txt('IMMAGINI.'),
    opz('CEL2', 'ALLEST.VANO MOTORE IN CARBONIO', 'SI'),
    opz('LLOG', 'SCUDETTO LASERIZZATO', 'SI'),
    txt('SCUDETTO LASERIZZATO COME DA IMMAGINE.'),
    sez('INTERNI'),
    opz('INTC', 'Interni', 'ALCANTARA NERA 9440'),
    opz('EMPH', 'CAVALL. CUCITI SU POGGIATESTA', 'EXTRACAMPIONARIO-NOT STANDARD'),
    txt('LATO GUIDATORE: CAVALLINO RICAMATO IN FILO MADEIRA POLYNEON 1810. VEDERE'),
    txt('IMMAGINI.'),
    txt('LATO PASSEGGERO: CAVALLINO RICAMATO IN FILO MADEIRA POLYNEON 1800. VEDERE'),
    txt('IMMAGINI.'),
    sez('INTERNI'),
    opz('STC1', 'TUTTE LE CUCITURE IN COLORE', 'EXTRACAMPIONARIO-NOT STANDARD'),
    txt('CUCITURE TONO SU TONO CON FILO 816 SU ULTRASUEDE BLU PROVA   FILO 4000 SU'),
    txt('ALCANTARA NERA   ECCETTO CUCITURE NELLA ZONA INTERNA DEL VOLANTE IN FILO 411.'),
    txt('VEDERE IMMAGINI.'),
    sez('EQUIPAGGIAMENTI'),
    opz('DEDI', 'TARGHETTA DEDICA IN ARGENTO', 'SI'),
    txt('TARGHETTA DEDICA IN FIBRA DI CARBONIO NERA OPACA. SCRITTA SOTTO IL RIGHINO ZZZZ'),
    txt('IN ARGENTO OPACO.'),
    opz('NDSP', 'NOTA SULLA DISPOSIZIONE', 'SI'),
    txt('VETTURA TAILOR MADE'),
    opz('TAIL', 'TAILOR MADE', 'SI'),
    sez('NO_TICKET_REQUIRED'),
  ];
}

export function toXlsBuffer(rows: Riga[], bookType: 'biff8' | 'xlsx' = 'biff8'): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '100001_002_0000000001');
  return XLSX.write(wb, { type: 'buffer', bookType }) as Buffer;
}
