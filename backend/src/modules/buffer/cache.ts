import { db } from '../../db/client.js';
import { queryBufferAll, type BufferItem, type BufferCombo } from './mysql-client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BufferCache {
  items:     BufferItem[];
  updatedAt: Date;
}

const cache = new Map<number, BufferCache>();

export function getBufferCache(lineaId: number): BufferCache | null {
  return cache.get(lineaId) ?? null;
}

// ─── Refresh ──────────────────────────────────────────────────────────────────

async function getActiveLinee() {
  return db`
    SELECT
      bl.id,
      COALESCE(
        json_agg(DISTINCT blf.fase) FILTER (WHERE blf.id IS NOT NULL),
        '[]'
      ) AS fasi,
      COALESCE(
        json_agg(json_build_object('modello', blc.modello, 'componente', blc.componente))
          FILTER (WHERE blc.id IS NOT NULL),
        '[]'
      ) AS combos
    FROM buffer_linea bl
    LEFT JOIN buffer_linea_fase  blf ON blf.linea_id = bl.id
    LEFT JOIN buffer_linea_combo blc ON blc.linea_id = bl.id
    WHERE bl.attivo = true
    GROUP BY bl.id
  `;
}

async function runFullRefresh() {
  try {
    const linee = await getActiveLinee();
    if (linee.length === 0) {
      process.stdout.write('[BufferCache] Nessun buffer attivo\n');
      return;
    }
    const results = await queryBufferAll(linee.map(l => ({
      id:     l.id     as number,
      fasi:   l.fasi   as string[],
      combos: l.combos as BufferCombo[],
    })));
    for (const [lineaId, items] of results) {
      cache.set(lineaId, { items, updatedAt: new Date() });
    }
    process.stdout.write(`[BufferCache] Refresh completato — ${linee.length} buffer\n`);
  } catch (err) {
    process.stderr.write(`[BufferCache] Errore refresh globale: ${err}\n`);
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────

export { runFullRefresh as bufferFullRefresh };

export async function startBufferCache(): Promise<void> {
  await runFullRefresh();
  console.log('Buffer cache avviata');
}
