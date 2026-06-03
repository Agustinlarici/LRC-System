import { join } from 'path';
import { pathToFileURL } from 'url';
import { db } from '../../db/client.js';
import { getShipments, getShipmentLines } from './dynamics-client.js';
import { writeEdiFile } from '../../lib/smb-writer.js';
import { logger } from '../../lib/logger.js';

const GENERATORS_DIR = join(process.cwd(), 'edi_generators');
const REQUIRES_CONTRACT = new Set(['AVIEXP_FERRARI', 'DESADV_AUDI']);

async function nextSequence(year: number): Promise<number> {
  const [row] = await db`
    INSERT INTO edi_sequence (year, last_sequence) VALUES (${year}, 1)
    ON CONFLICT (year) DO UPDATE SET last_sequence = edi_sequence.last_sequence + 1
    RETURNING last_sequence
  `;
  return row.last_sequence as number;
}

export async function autoGenerateEdi(): Promise<void> {
  const clients = await db`SELECT * FROM edi_clients WHERE auto_generate = true`;
  if (clients.length === 0) return;

  logger.info(`[EDI Auto] ${clients.length} client/i con auto_generate attivo`);

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());

  for (const client of clients) {
    const account = client.customer_account as string;
    try {
      const shipments = await getShipments([account], today, today);
      if (shipments.length === 0) continue;

      const ids = shipments.map(s => s.shipment_id);
      const sent = await db`
        SELECT DISTINCT shipment_id FROM edi_history
        WHERE customer_account = ${account}
          AND status = 'sent'
          AND generated_at::date = CURRENT_DATE
          AND shipment_id = ANY(${ids})
      `;
      const sentIds = new Set(sent.map(r => r.shipment_id as string));
      const pending = shipments.filter(s => !sentIds.has(s.shipment_id));

      logger.info(`[EDI Auto] ${account}: ${pending.length} spedizioni da generare`);

      const genPath = pathToFileURL(join(GENERATORS_DIR, `${client.edi_type as string}.js`)).href;
      const generatorMod = await import(genPath) as { generate: (s: unknown, c: unknown, seq: number) => string };

      for (const shipment of pending) {
        try {
          const lines = await getShipmentLines(shipment.shipment_id);

          if (REQUIRES_CONTRACT.has(client.edi_type as string)) {
            const missing = lines.filter(l => !l.contract_number);
            if (missing.length > 0) {
              logger.warn(`[EDI Auto] ${shipment.shipment_id}: ${missing.length} riga/e senza contratto — saltata`);
              continue;
            }
          }

          const year     = new Date().getFullYear();
          const sequence = await nextSequence(year);

          const now = new Date();
          const ts  = [
            now.getFullYear(),
            String(now.getMonth() + 1).padStart(2, '0'),
            String(now.getDate()).padStart(2, '0'),
            '_',
            String(now.getHours()).padStart(2, '0'),
            String(now.getMinutes()).padStart(2, '0'),
            String(now.getSeconds()).padStart(2, '0'),
          ].join('');
          const filename = `${client.edi_type as string}_${client.supplier_code as string}_${String(sequence).padStart(11, '0')}_${ts}.txt`;

          const body = {
            shipment_id:      shipment.shipment_id,
            customer_account: shipment.customer_account,
            document_number:  shipment.document_number,
            document_date:    shipment.document_date,
            is_extra_cee:     shipment.is_extra_cee,
            lines,
          };

          const fileContent = generatorMod.generate(body, client, sequence);

          await writeEdiFile(client.output_folder as string, filename, fileContent);

          await db`
            INSERT INTO edi_history
              (shipment_id, customer_account, edi_type, filename, status, file_content, is_regeneration)
            VALUES
              (${shipment.shipment_id}, ${account}, ${client.edi_type as string},
               ${filename}, 'sent', ${fileContent}, false)
          `;

          logger.info(`[EDI Auto] Generato: ${filename}`);
        } catch (e) {
          logger.error(`[EDI Auto] Errore ${shipment.shipment_id}: ${e instanceof Error ? e.message : e}`);
        }
      }
    } catch (e) {
      logger.error(`[EDI Auto] Errore cliente ${account}: ${e instanceof Error ? e.message : e}`);
    }
  }
}
