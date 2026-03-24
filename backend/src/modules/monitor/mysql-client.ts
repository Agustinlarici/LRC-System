import mysql from 'mysql2/promise';

let pool: mysql.Pool | null = null;

export function getWebthronPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host:             process.env.WEBTHRON_HOST ?? '192.168.1.12',
      port:             parseInt(process.env.WEBTHRON_PORT ?? '3306'),
      database:         process.env.WEBTHRON_DB ?? 'WebThron',
      user:             process.env.WEBTHRON_USER ?? '',
      password:         process.env.WEBTHRON_PASS ?? '',
      waitForConnections: true,
      connectionLimit:  5,
      queueLimit:       0,
      timezone:         process.env.WEBTHRON_TZ ?? '+01:00',
      connectTimeout:   5000,
    });
  }
  return pool;
}

export type Combo = { modello: string; componente: string };

/**
 * Esegue la query sul DB WebThron (solo SELECT — mai DELETE).
 * Filtra per Fase + uno o più pari Modello/Componente.
 */
export async function queryWebthron(fase: string, combos: Combo[]) {
  if (combos.length === 0) return [];

  const comboConditions = combos
    .map(() => `(ikExtra43Tab.stringa = ? AND ikExtra45Tab.stringa = ?)`)
    .join(' OR ');

  const comboParams = combos.flatMap(c => [c.modello, c.componente]);

  const sql = `
    SELECT
      ubi.datain           AS Data_Inserimento,
      ikExtra62Tab.stringa AS Fase,
      ikExtra43Tab.stringa AS Modello,
      ikExtra45Tab.stringa AS Componente
    FROM
      ubidocum AS ubi
    LEFT JOIN ikExtra AS Extra62  ON ubi.iddocu = Extra62.iddocu  AND Extra62.idcampo = 62  AND Extra62.idcomm = 0 AND Extra62.seq = 0
    LEFT JOIN ikExtra AS Extra43  ON ubi.iddocu = Extra43.iddocu  AND Extra43.idcampo = 43  AND Extra43.idcomm = 0 AND Extra43.seq = 0
    LEFT JOIN ikExtra AS Extra45  ON ubi.iddocu = Extra45.iddocu  AND Extra45.idcampo = 45  AND Extra45.idcomm = 0 AND Extra45.seq = 0
    LEFT JOIN ikExtraTab AS ikExtra62Tab ON ikExtra62Tab.id = Extra62.stringa
    LEFT JOIN ikExtraTab AS ikExtra43Tab ON ikExtra43Tab.id = Extra43.stringa
    LEFT JOIN ikExtraTab AS ikExtra45Tab ON ikExtra45Tab.id = Extra45.stringa
    WHERE
      ubi.tipdoc IN ('0480','5004')
      AND DATE(ubi.datain) = CURDATE()
      AND ikExtra62Tab.stringa = ?
      AND (${comboConditions})
    ORDER BY ubi.datain DESC
    LIMIT 15000
  `;

  const [rows] = await getWebthronPool().execute({ sql, timeout: 5 * 60 * 1000 }, [fase, ...comboParams]);
  return rows as Array<{ Data_Inserimento: Date; Fase: string; Modello: string; Componente: string }>;
}
