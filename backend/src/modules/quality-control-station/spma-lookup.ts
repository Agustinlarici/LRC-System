// Modello e linea di una commessa, dalla tabella che aggiorna l'import SPMA (/spma/import → spma_commessa).
// Si cerca per codice esatto; se manca, ignorando gli zeri iniziali ("000123" = "123"), perché iKnow e il file
// SPMA non sempre scrivono la commessa allo stesso modo. Sola lettura.
import { db } from '../../db/client.js';

export type SpmaInfo = { modello: string | null; linea: string | null };

export async function spmaInfo(commessa: string): Promise<SpmaInfo> {
  const [r] = await db`
    SELECT c.model_code, l.name AS linea
    FROM spma_commessa c LEFT JOIN spma_line l ON l.id = c.line_id
    WHERE c.commessa_code = ${commessa}
       OR (ltrim(${commessa}, '0') <> '' AND ltrim(c.commessa_code, '0') = ltrim(${commessa}, '0'))
    ORDER BY (c.commessa_code = ${commessa}) DESC, c.id
    LIMIT 1
  `;
  const modello = (r?.model_code as string | undefined)?.trim();
  return { modello: modello && modello !== '-' ? modello : null, linea: (r?.linea as string | null) ?? null };
}
