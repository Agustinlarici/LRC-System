/**
 * Generatore EDI DESADV VDA 4987 T2 — Gruppo Volkswagen / AUDI
 * Standard: UN/EDIFACT DESADV:D:07A:UN:GAVF24 | VDA 2.4 / VW 3.3
 * Processo: LAB-ED (call-off con data di consegna — standard forniture serie)
 *
 * Mapping campi cliente (da edi_clients):
 *   cdt_vat                → Odette-ID Mittente (14 char, es. 0940IT0123456789)
 *   csg_establishment_code → Odette-ID Destinatario Audi/VW (14 char, es. 4950VW00000INGOL)
 *   supplier_code          → Codice fornitore (max 9 cifre, NAD+SF, qualif. 92)
 *   csg_supply_point       → Codice impianto destinatario (an..5, NAD+ST / LOC+11)
 *   csg_address_1          → Codice Incoterms (es. FCA, EXW, DDP) — TOD
 *   csg_company_name       → Nome stabilimento (solo display, non inserito nel messaggio)
 *   cdt_company_name       → (non usato in questo generatore)
 *
 * Mapping campi spedizione:
 *   document_number        → Numero avviso spedizione (BGM / RFF+AAU) — n..8
 *   lines[].contract_number → Numero ordine d'acquisto Audi (RFF+ON, M/R per VDA 4987)
 *   lines[].article_code   → Codice parte cliente (LIN, qualif. IN, an..22)
 *   lines[].quantity       → Quantità spedita (QTY+12)
 *   lines[].unit_of_measure → Unità di misura (es. PCE, MTR, KGM)
 *   lines[].description    → Descrizione articolo (IMD)
 *
 * @param {object} shipment  Dati della spedizione (dal frontend/backend routes.ts)
 * @param {object} client    Configurazione cliente EDI (da edi_clients DB)
 * @param {number} sequence  Sequenza progressiva annuale (già incrementata)
 * @returns {string}         Contenuto file EDIFACT (segmenti separati da \n)
 */

// Caratteri speciali EDIFACT che richiedono escape con '?' come release character
function edifactEscape(s) {
  return String(s ?? '').replace(/[?'+:]/g, c => '?' + c);
}

function fmtDate8(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getUTCFullYear()}${String(dt.getUTCMonth()+1).padStart(2,'0')}${String(dt.getUTCDate()).padStart(2,'0')}`;
}

function fmtDateTime12(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${fmtDate8(dt)}${String(dt.getUTCHours()).padStart(2,'0')}${String(dt.getUTCMinutes()).padStart(2,'0')}`;
}

function fmtDate6(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${String(dt.getUTCFullYear()).slice(-2)}${String(dt.getUTCMonth()+1).padStart(2,'0')}${String(dt.getUTCDate()).padStart(2,'0')}`;
}

function fmtTime4(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${String(dt.getUTCHours()).padStart(2,'0')}${String(dt.getUTCMinutes()).padStart(2,'0')}`;
}

export function generate(shipment, client, sequence) {
  const now = new Date();

  // Odette-ID mittente e destinatario (14 char ciascuno, DE 0004/0010 in UNB)
  const senderOdette   = String(client.cdt_vat || '').trim();
  const receiverOdette = String(client.csg_establishment_code || '').trim();

  // Codice fornitore (NAD+SF, qualificatore 92 = accordo tra partner)
  const supplierCode = String(client.supplier_code || '').padStart(9, '0').slice(0, 9);

  // Codice impianto destinatario (NAD+ST, LOC+11 — an..5 per VDA 4987 §SG20)
  const plantCode = String(client.csg_supply_point || '').trim().slice(0, 5);

  // Incoterms (TOD — es. FCA, EXW, DDP, CIF)
  const incoterms = String(client.csg_address_1 || 'FCA').trim().toUpperCase().slice(0, 3);

  // Riferimento interscambio UNB/UNZ: max 8 cifre per VDA 4987 (CRN ≤8)
  const intRef = String(sequence).padStart(8, '0').slice(0, 8);
  const msgRef = String(sequence).padStart(5, '0');

  // Numero avviso spedizione (BGM / RFF+AAU): max 8 cifre per VDA 4987
  const asnRef = String(shipment.document_number || shipment.shipment_id || '').slice(0, 8);

  // Date
  const txDate6 = fmtDate6(now);
  const txTime4 = fmtTime4(now);
  const msgDt12 = fmtDateTime12(shipment.document_date ? new Date(shipment.document_date) : now);
  const despDate = fmtDate8(shipment.document_date ? new Date(shipment.document_date) : now);

  const segs = [];

  // ── UNA — Service string ─────────────────────────────────────────────────────
  segs.push("UNA:+.? '");

  // ── UNB — Intestazione interscambio ─────────────────────────────────────────
  // UNOC:3 = charset C (ISO 8859-1), versione 3 — obbligatorio per VDA 4987
  segs.push(`UNB+UNOC:3+${senderOdette}:14+${receiverOdette}:14+${txDate6}:${txTime4}+${intRef}++++DESADV'`);

  // ── UNH — Intestazione messaggio ─────────────────────────────────────────────
  segs.push(`UNH+${msgRef}+DESADV:D:07A:UN:GAVF24'`);

  // ── BGM — Avviso di spedizione anticipato ────────────────────────────────────
  // C002: 351 (despatch advice) ::: LAB-ED (processo call-off con data consegna)
  // C106: numero avviso spedizione | 1225: 9 = messaggio originale
  segs.push(`BGM+351:::LAB-ED+${asnRef}+9'`);

  // ── DTM+137 — Data/ora creazione messaggio (formato 203 = CCYYMMDDHHMM) ──────
  segs.push(`DTM+137:${msgDt12}:203'`);

  // ── DTM+11 — Data di spedizione effettiva (formato 102 = CCYYMMDD) ───────────
  segs.push(`DTM+11:${despDate}:102'`);

  // ── MEA+AAX+AAD — Peso lordo consegna in KGM ─────────────────────────────────
  // Peso non disponibile da Dynamics — inserire 0; da aggiornare se disponibile
  segs.push(`MEA+AAX+AAD+KGM:0'`);

  // ── MEA+AAE — Numero di unità di carico ──────────────────────────────────────
  segs.push(`MEA+AAE+SU+1'`);

  // ── SG1/RFF+CRN — Numero consegna (≤8 cifre, unico nell'anno) ────────────────
  segs.push(`RFF+CRN:${intRef}'`);

  // ── SG2/NAD+SF — Mittente/Fornitore (ship-from) ──────────────────────────────
  segs.push(`NAD+SF+${supplierCode}::92'`);

  // ── SG2/NAD+ST — Destinatario stabilimento Audi (ship-to) ────────────────────
  if (plantCode) {
    segs.push(`NAD+ST+${plantCode}::92'`);
  }

  // ── SG5/TOD — Condizioni di resa (Incoterms) ─────────────────────────────────
  segs.push(`TOD+6++${incoterms}'`);

  // ── SG6/TDT+12 — Trasporto (modo 30 = strada) ────────────────────────────────
  segs.push(`TDT+12++30'`);

  // ── SG10/CPS+1 — Gruppo imballaggio esterno (livello 1) ──────────────────────
  segs.push(`CPS+1'`);

  // ── SG11/PAC — Unità di imballo (tipo 35 = imballaggio principale) ────────────
  segs.push(`PAC+${shipment.lines.length}++35'`);

  // ── SG17 — Righe articolo ─────────────────────────────────────────────────────
  for (let i = 0; i < shipment.lines.length; i++) {
    const line   = shipment.lines[i];
    const lineNo = i + 1;
    const partNo = edifactEscape(String(line.article_code || '').slice(0, 22));
    const qty    = Number(line.quantity || 0);
    const uom    = String(line.unit_of_measure || 'PCE').toUpperCase().slice(0, 3);
    const desc   = edifactEscape(String(line.description || '').slice(0, 35));
    const poNo   = edifactEscape(String(line.contract_number || ''));
    const docNo  = edifactEscape(asnRef);

    // LIN — riga articolo: qualificatore IN = codice articolo cliente
    segs.push(`LIN+${lineNo}++${partNo}:IN'`);

    // IMD+F — descrizione + uso 11 (produzione di serie)
    if (desc) {
      segs.push(`IMD+F++:::${desc}:EN'`);
    }

    // QTY+12 — quantità totale spedita
    segs.push(`QTY+12:${qty}:${uom}'`);

    // SG18/RFF+AAU — numero avviso di spedizione + posizione riga
    segs.push(`RFF+AAU:${docNo}:${lineNo}'`);

    // SG18/RFF+ON — numero ordine d'acquisto Audi (M/R per VDA 4987)
    if (poNo) {
      segs.push(`RFF+ON:${poNo}'`);
    }

    // SG20/LOC+11 — punto di scarico (an..5 per VDA 4987)
    if (plantCode) {
      segs.push(`LOC+11+${plantCode}'`);
    }
  }

  // ── UNT — Trailer messaggio ───────────────────────────────────────────────────
  // Conta dal UNH fino al UNT incluso (esclude UNA e UNB)
  const bodySegCount = segs.length - 2;
  segs.push(`UNT+${bodySegCount + 1}+${msgRef}'`);

  // ── UNZ — Trailer interscambio ────────────────────────────────────────────────
  segs.push(`UNZ+1+${intRef}'`);

  return segs.join('\n') + '\n';
}
