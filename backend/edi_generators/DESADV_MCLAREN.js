/**
 * Generatore EDI DESADV D96A — McLaren Automotive
 * Formato EDIFACT (segmenti separati da '+', terminatori '\'')
 *
 * @param {object} shipment  Dati della spedizione da Dynamics:
 *   { shipment_id, document_number, document_date, shipment_date, is_extra_cee,
 *     lines: [{ article_code, description, quantity, unit_of_measure, contract_number }] }
 *   contract_number → RFF+ON (ordine d'acquisto McLaren)
 *   document_number → RFF+AAU (despatch note number)
 *
 * @param {object} client    Configurazione cliente EDI (da edi_clients):
 *   Campi usati:
 *   - sdt_ferrari_supplier_code : codice fornitore McLaren (9 cifre, usato in UNB e NAD+SE)
 *   - csg_supply_point          : codice consegnatario warehouse (NAD+CN, es. '9000')
 *   - csg_address_1             : codice location/impianto (LOC+159, es. 'UPL38')
 *   - cdt_company_name          : data/ora consegna prevista (DTM+132, formato CCYYMMDDHHMM)
 *
 * @param {number} sequence  Sequenza progressiva dell'anno (già incrementata dal backend).
 *
 * @returns {string}  Contenuto del file come stringa (righe terminanti con '\n').
 */

function fmtDate8(date) {
  const d = date instanceof Date ? date : new Date(date);
  const yyyy = d.getUTCFullYear();
  const mm   = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd   = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function fmtDate6(date) {
  const d = date instanceof Date ? date : new Date(date);
  const yy = String(d.getUTCFullYear()).slice(-2);
  const mm  = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd  = String(d.getUTCDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

function fmtTime4(date) {
  const d = date instanceof Date ? date : new Date(date);
  return String(d.getUTCHours()).padStart(2, '0') + String(d.getUTCMinutes()).padStart(2, '0');
}

/** Formatta il riferimento interscambio: 7 cifre con zeri iniziali. */
function fmtRef(seq) {
  return String(seq).padStart(7, '0');
}

export function generate(shipment, client, sequence) {
  const now = new Date();

  // Codice fornitore McLaren: 9 cifre (usato in UNB mittente e NAD+SE)
  const supplierCode   = String(client.supplier_code || '').padStart(9, '0').slice(0, 9);
  // Codice consegnatario McLaren warehouse (NAD+CN)
  const consigneeCode  = String(client.csg_supply_point || '9000');
  // Codice impianto/location (LOC+159)
  const locationCode   = String(client.csg_address_1 || '');
  // Data/ora consegna prevista CCYYMMDDHHMM (DTM+132) — se fornita nel campo cdt_company_name
  const deliveryDtRaw  = String(client.cdt_company_name || '').replace(/\D/g, '');
  const deliveryDt12   = deliveryDtRaw.length >= 12 ? deliveryDtRaw.slice(0, 12) : '';

  const interchangeRef = fmtRef(sequence);  // riferimento interscambio UNB / UNZ
  const msgRef         = String(sequence).padStart(5, '0'); // riferimento messaggio UNH / UNT

  const txDate6  = fmtDate6(now);
  const txTime4  = fmtTime4(now);
  const msgDate8 = shipment.document_date ? fmtDate8(new Date(shipment.document_date)) : fmtDate8(now);

  // Numero avviso spedizione (ASN reference) = document_number
  const asnRef = String(shipment.document_number || shipment.shipment_id || '');

  const segs = [];

  // ── UNA ───────────────────────────────────────────────────────────────────────
  // Separatori standard EDIFACT: componente ':', dato '+', decimale '.', rilascio '?', spazio ' ', terminatore '\''
  segs.push("UNA:+.? '");

  // ── UNB — Intestazione interscambio ──────────────────────────────────────────
  // Sintassi UNOA:2 (livello A, versione 2 — come da spec McLaren Appendix A usa :1 ma spec testuale usa :2)
  // Mittente: codice fornitore. Destinatario: MCLAREN:ZZZ:000999999
  segs.push(`UNB+UNOA:2+${supplierCode}+MCLAREN:ZZZ:000999999+${txDate6}:${txTime4}+${interchangeRef}++DESADV'`);

  // ── UNH — Intestazione messaggio ─────────────────────────────────────────────
  segs.push(`UNH+${msgRef}+DESADV:D:96A:UN:A04031'`);

  // ── BGM — Inizio messaggio ────────────────────────────────────────────────────
  // 351 = Despatch Advice; qualificatore::10 = "free form"; 9 = original
  segs.push(`BGM+351::10+${asnRef}+9'`);

  // ── DTM+137 — Data messaggio ──────────────────────────────────────────────────
  segs.push(`DTM+137:${msgDate8}:102'`);

  // ── DTM+132 — Data/ora consegna prevista ──────────────────────────────────────
  if (deliveryDt12) {
    segs.push(`DTM+132:${deliveryDt12}:203'`);
  }

  // ── NAD+SE — Mittente/Fornitore ───────────────────────────────────────────────
  segs.push(`NAD+SE+${supplierCode}'`);

  // ── NAD+CN — Consegnatario ────────────────────────────────────────────────────
  segs.push(`NAD+CN+${consigneeCode}'`);

  // ── LOC+159 — Punto di consegna ───────────────────────────────────────────────
  if (locationCode) {
    segs.push(`LOC+159+${locationCode}'`);
  }

  // ── Loop righe ────────────────────────────────────────────────────────────────
  for (let i = 0; i < shipment.lines.length; i++) {
    const line     = shipment.lines[i];
    const lineNo   = i + 1;
    const partNo   = String(line.article_code || '');
    const qty      = Number(line.quantity || 0);
    // contract_number = Purchase Order number (RFF+ON)
    const orderNo  = String(line.contract_number || '');
    // document_number (spedizione) = Despatch Note number (RFF+AAU)
    const despNote = String(shipment.document_number || '');

    // CPS — livello di packaging (uno per articolo)
    segs.push(`CPS+${lineNo}'`);

    // PAC — numero colli (1 per riga, usa quantità come unità)
    segs.push(`PAC+1'`);

    // PCI — marcatura (15 = barcode su etichetta)
    segs.push(`PCI+15'`);

    // LIN — linea articolo: IN = Internal article number (codice McLaren)
    segs.push(`LIN+${lineNo}++${partNo}:IN'`);

    // QTY+12 — quantità spedita (PCE = pezzi)
    const uom = String(line.unit_of_measure || 'PCE').toUpperCase().slice(0, 3);
    segs.push(`QTY+12:${qty}:${uom}'`);

    // RFF+ON — numero ordine d'acquisto McLaren
    if (orderNo) {
      segs.push(`RFF+ON:${orderNo}'`);
    }

    // RFF+AAU — numero avviso spedizione/documento
    if (despNote) {
      segs.push(`RFF+AAU:${despNote}'`);
    }
  }

  // ── UNT — Trailer messaggio ───────────────────────────────────────────────────
  // Conta tutti i segmenti dal UNH al UNT incluso (escluso UNA e UNB)
  // Il conteggio comprende UNH + tutti i segmenti del corpo + UNT stesso
  const bodySegCount = segs.length - 2; // escludi UNA e UNB
  segs.push(`UNT+${bodySegCount + 1}+${msgRef}'`); // +1 per UNT stesso

  // ── UNZ — Trailer interscambio ────────────────────────────────────────────────
  segs.push(`UNZ+1+${interchangeRef}'`);

  // EDIFACT: ogni segmento su riga separata
  return segs.join('\n') + '\n';
}
