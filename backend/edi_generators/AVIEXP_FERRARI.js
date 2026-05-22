/**
 * Generatore EDI AVIEXP v.3 subset ESTESO — Ferrari S.p.A.
 * Specifica ODETTE AVIEXP a campi di lunghezza fissa (512 char per riga).
 *
 * @param {object} shipment  Dati della spedizione da Dynamics:
 *   { shipment_id, document_number, document_date, is_extra_cee, lines: [...] }
 *   Ogni riga: { article_code, description, quantity, unit_of_measure, contract_number }
 *
 * @param {object} client    Configurazione cliente EDI (da edi_clients):
 *   { sdt_ferrari_supplier_code, cdt_vat, cdt_company_name, cdt_address_1..4,
 *     sdt_vat, csg_establishment_code, csg_company_name, csg_address_1, csg_supply_point }
 *
 * @param {number} sequence  Sequenza progressiva dell'anno (già incrementata).
 *
 * @returns {string}  Contenuto del file come stringa (righe \r\n).
 */

const RECORD_LENGTH = 512;

/**
 * Costruisce un record di lunghezza fissa posizionando i valori alle posizioni indicate (1-indexed).
 */
function buildRecord(fields) {
  const buf = new Array(RECORD_LENGTH).fill(' ');
  for (const { pos: [start, end], value } of fields) {
    const len = end - start + 1;
    const s = String(value ?? '').slice(0, len);
    for (let i = 0; i < s.length; i++) {
      buf[start - 1 + i] = s[i];
    }
  }
  return buf.join('');
}

function fmtDateAAMMGG(date) {
  const d = date instanceof Date ? date : new Date(date);
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

function fmtHHMM(date) {
  const d = date instanceof Date ? date : new Date(date);
  return String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
}

/**
 * Quantità: 10 char — 8 interi + 2 decimali, senza separatore, con zeri iniziali.
 * Es: 12.5 → "0000001250"
 */
function fmtQuantity(qty) {
  const centesimi = Math.round(Math.abs(Number(qty) || 0) * 100);
  return String(centesimi).padStart(10, '0');
}

export function generate(shipment, client, sequence) {
  const now = new Date();

  // Numero avviso: codice fornitore (6 dig.) + sequenza anno (11 dig.)
  const supplierCode = String(client.sdt_ferrari_supplier_code || '').padStart(6, '0');
  const seqStr       = String(sequence).padStart(11, '0');
  const noticeNumber = supplierCode + seqStr; // 17 chars

  const dateStr = fmtDateAAMMGG(now);
  const timeStr = fmtHHMM(now);

  const lines = [];

  // ── MID ───────────────────────────────────────────────────────────────────────
  lines.push(buildRecord([
    { pos: [1,   17],  value: noticeNumber },
    { pos: [18,  20],  value: 'MID' },
    { pos: [21,  26],  value: dateStr },
    { pos: [27,  30],  value: timeStr },
    { pos: [66,  100], value: client.cdt_vat },       // ID mittente (35 char)
    { pos: [101, 104], value: 'AA' },
    { pos: [119, 153], value: 'FERRARI' },             // ID destinatario (35 char)
    { pos: [154, 157], value: 'AA' },
  ]));

  // ── CDT (mittente) ────────────────────────────────────────────────────────────
  lines.push(buildRecord([
    { pos: [1,   17],  value: noticeNumber },
    { pos: [18,  20],  value: 'CDT' },
    { pos: [21,  40],  value: client.cdt_vat },
    { pos: [41,  75],  value: client.cdt_company_name },
    { pos: [76,  110], value: client.cdt_address_1 ?? '' },
    { pos: [111, 145], value: client.cdt_address_2 ?? '' },
    { pos: [146, 180], value: client.cdt_address_3 ?? '' },
    { pos: [181, 215], value: client.cdt_address_4 ?? '' },
  ]));

  // ── SDT (venditore/fornitore) ─────────────────────────────────────────────────
  lines.push(buildRecord([
    { pos: [1,   17],  value: noticeNumber },
    { pos: [18,  20],  value: 'SDT' },
    { pos: [21,  40],  value: client.sdt_vat },
    { pos: [216, 232], value: client.sdt_ferrari_supplier_code },
  ]));

  // ── CSG (destinatario Ferrari) ────────────────────────────────────────────────
  lines.push(buildRecord([
    { pos: [1,   17],  value: noticeNumber },
    { pos: [18,  20],  value: 'CSG' },
    { pos: [21,  23],  value: client.csg_establishment_code },
    { pos: [41,  75],  value: client.csg_company_name },
    { pos: [76,  110], value: client.csg_address_1 ?? '' },
    { pos: [425, 441], value: client.csg_supply_point ?? '' },
  ]));

  // ── ARD (una riga per ogni articolo della spedizione) ─────────────────────────
  for (const line of shipment.lines) {
    // Il codice articolo è max 16 char ma il campo va fino a pos 56
    const articleCode    = String(line.article_code ?? '').slice(0, 16);
    // N° contratto Ferrari: 14 char con zeri iniziali
    const contractNumber = String(line.contract_number ?? '').padStart(14, '0').slice(0, 14);

    lines.push(buildRecord([
      { pos: [1,   17],  value: noticeNumber },
      { pos: [18,  20],  value: 'ARD' },
      { pos: [21,  56],  value: articleCode },
      { pos: [91,  125], value: line.description ?? '' },
      { pos: [266, 275], value: fmtQuantity(line.quantity) },
      { pos: [276, 278], value: line.unit_of_measure ?? '' },
      { pos: [279, 295], value: contractNumber },
    ]));
  }

  // ── DAN (documento di trasporto) ──────────────────────────────────────────────
  // tipo: 630 = fattura Italia/CEE, 380 = extra-CEE
  const docType = shipment.is_extra_cee ? '380' : '630';
  const docDate = shipment.document_date
    ? fmtDateAAMMGG(new Date(shipment.document_date))
    : '';

  lines.push(buildRecord([
    { pos: [1,  17],  value: noticeNumber },
    { pos: [18, 20],  value: 'DAN' },
    { pos: [21, 23],  value: docType },
    { pos: [59, 67],  value: String(shipment.document_number ?? '').slice(0, 9) },
    { pos: [76, 81],  value: docDate },
  ]));

  return lines.join('\r\n') + '\r\n';
}
