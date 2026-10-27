// Genera i pacchetti di prova usati dai test di compatibilità TypeScript <-> Python (dati inventati).
//   npx tsx src/modules/ferrari/__tests__/gen-fixtures.ts <cartella-di-uscita>
// Il segreto di prova NON è un segreto: serve solo a verificare le firme nei test.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildToAi, buildKnowledge } from '../bundle.js';
import { parseScheda } from '../parser.js';
import { schedaPersonalizzata, schedaSemplice, toXlsBuffer } from './fixtures.js';

const SECRET = 'segreto-di-prova';
const out = process.argv[2];
if (!out) throw new Error('indicare la cartella di uscita');
mkdirSync(out, { recursive: true });

const k = {
  versione: 4,
  codici: [{ codice: 'CEL2', modello: null, significato: 'Vano motore in carbonio', categoria: 'Carbonio' }],
  componenti: [
    { pattern: 'blu prova', tipo: 'COLORE', valore: 'BLU PROVA', modello: null },
    { pattern: 'ultrasuede', tipo: 'MATERIALE', valore: 'ULTRASUEDE', modello: 'F999XX' },
    { pattern: 'vettura', tipo: 'NEUTRO', valore: '-', modello: null },
  ],
};
const esempi = [{ testo: 'RIVESTITO IN BLU PROVA', pattern: 'blu prova', tipo: 'COLORE', valore: 'BLU PROVA', modello: null }];

const schede = [
  { dbId: 1, canonico: parseScheda(toXlsBuffer(schedaSemplice()), 'semplice.xls') },
  { dbId: 2, canonico: parseScheda(toXlsBuffer(schedaPersonalizzata({ commessa: 100002 })), 'personalizzata.xls') },
];

writeFileSync(join(out, 'to-ai.zip'), buildToAi({ secret: SECRET, schede, conoscenza: k, esempi }).zip);
writeFileSync(join(out, 'knowledge.zip'), buildKnowledge({ secret: SECRET, conoscenza: { ...k, versione: 5 }, esempi }).zip);
console.log('fixture scritte in', out);
