/**
 * Generatore EDI DESADV D:96A — McLaren Automotive
 * Formato EDIFACT, basato sul DELFOR ricevuto da McLaren e sull'esempio reale fornitore.
 *
 * Mapping campi client (da edi_clients):
 *   supplier_code    → UNB sender ({code}:ZZ) + UNB receiver (MCLAREN:ZZZ:{code})
 *                       + NAD+SE codice fornitore (0-padded a 10 cifre)
 *   cdt_company_name → NAD+SE nome azienda (es. "STR Automotive Spa")
 *   cdt_address_1    → NAD+SE via/indirizzo
 *   cdt_address_2    → NAD+SE città
 *   cdt_address_3    → NAD+SE CAP
 *   cdt_address_4    → NAD+SE paese (es. "IT")
 *   csg_company_name → NAD+BY codice buyer McLaren (es. "9000")
 *   csg_supply_point → NAD+CN codice consegnatario (es. "9010")
 *   csg_address_1    → LOC+159 codice impianto (es. "UPL38")
 *
 * Mapping campi spedizione (shipment):
 *   document_number        → BGM + RFF+AAU (numero avviso spedizione)
 *   lines[].article_code   → LIN (codice parte McLaren)
 *   lines[].quantity       → QTY+12
 *   lines[].unit_of_measure → QTY unità (normalizzata a codici EDIFACT)
 *   lines[].contract_number → RFF+ON (Purchase Order McLaren), SA line number sempre 00010
 */

// Mappa codici unità di misura Business Central → EDIFACT UN/ECE Rec 20
const UOM_MAP = {
  'NUM': 'PCE', 'NR': 'PCE', 'PZ': 'PCE', 'PCS': 'PCE',
  'NUMERO': 'PCE', 'NR.': 'PCE', 'N': 'PCE',
  'KG':  'KGM', 'KGS': 'KGM',
  'M':   'MTR', 'MT':  'MTR',
  'LT':  'LTR', 'L':   'LTR',
};

function toEdifactUom(bc) {
  const u = String(bc ?? '').toUpperCase().trim();
  return UOM_MAP[u] ?? (u.length > 0 ? u : 'PCE');
}

function edifactEsc(s) {
  return String(s ?? '').replace(/[?'+:]/g, c => '?' + c);
}

// Estrae la parte numerica dopo l'ultimo '-' e rimuove gli zeri iniziali
// es. "SPCW26-016544" → "16544"
function extractDocNo(raw) {
  const str = String(raw || '').trim();
  const dashIdx = str.lastIndexOf('-');
  if (dashIdx < 0) return str;
  const suffix = str.slice(dashIdx + 1);
  const num = parseInt(suffix, 10);
  return isNaN(num) ? suffix : String(num);
}

function fmtDateTime14(date) {
  const d = date instanceof Date ? date : new Date(date);
  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, '0'),
    String(d.getUTCDate()).padStart(2, '0'),
    String(d.getUTCHours()).padStart(2, '0'),
    String(d.getUTCMinutes()).padStart(2, '0'),
    String(d.getUTCSeconds()).padStart(2, '0'),
  ].join('');
}

function fmtDate6(date) {
  const d = date instanceof Date ? date : new Date(date);
  return String(d.getUTCFullYear()).slice(-2)
    + String(d.getUTCMonth() + 1).padStart(2, '0')
    + String(d.getUTCDate()).padStart(2, '0');
}

function fmtTime4(date) {
  const d = date instanceof Date ? date : new Date(date);
  return String(d.getUTCHours()).padStart(2, '0')
    + String(d.getUTCMinutes()).padStart(2, '0');
}

export function generate(shipment, client, sequence) {
  const now = new Date();

  // Codice fornitore: 9 cifre per UNB/NAD+SE (pad a 10 con zero iniziale per NAD)
  const supplierCode9  = String(client.supplier_code || '').padStart(9, '0').slice(0, 9);
  const supplierCode10 = '0' + supplierCode9; // 10 cifre per NAD+SE

  // UNB interchange reference
  const intRef = String(sequence).padStart(7, '0');
  const msgRef = String(sequence).padStart(5, '0');

  // Numero avviso spedizione (BGM / RFF+AAU) — solo parte numerica dopo l'ultimo '-'
  const docNo = edifactEsc(extractDocNo(shipment.document_number || shipment.shipment_id || ''));

  // Date
  const txDate6  = fmtDate6(now);
  const txTime4  = fmtTime4(now);
  const msgDt14  = fmtDateTime14(shipment.document_date ? new Date(shipment.document_date) : now);

  // NAD codes
  const buyerCode     = String(client.csg_company_name || '9000').trim();
  const consigneeCode = String(client.csg_supply_point || '').trim();
  const locationCode  = String(client.csg_address_1   || '').trim();

  // NAD+SE — nostra azienda
  const ourName    = edifactEsc(String(client.cdt_company_name || '').trim());
  const ourStreet  = edifactEsc(String(client.cdt_address_1   || '').trim());
  const ourCity    = edifactEsc(String(client.cdt_address_2   || '').trim());
  const ourZip     = edifactEsc(String(client.cdt_address_3   || '').trim());
  const ourCountry = edifactEsc(String(client.cdt_address_4   || '').trim());

  const segs = [];

  // ── UNA ───────────────────────────────────────────────────────────────────────
  segs.push("UNA:+.? '");

  // ── UNB ───────────────────────────────────────────────────────────────────────
  // Sender: {supplierCode}:ZZ  |  Receiver: MCLAREN:ZZZ:{supplierCode}
  segs.push(`UNB+UNOA:2+${supplierCode9}:ZZ+MCLAREN:ZZZ:${supplierCode9}+${txDate6}:${txTime4}+${intRef}'`);

  // ── UNH ───────────────────────────────────────────────────────────────────────
  segs.push(`UNH+${msgRef}+DESADV:D:96A:UN:A01051'`);

  // ── BGM ───────────────────────────────────────────────────────────────────────
  segs.push(`BGM+351+${docNo}'`);

  // ── DTM+137 — Data/ora creazione messaggio ────────────────────────────────────
  segs.push(`DTM+137:${msgDt14}:203'`);

  // ── DTM+132 — Data/ora consegna (uguale alla data documento se non specificata) ─
  segs.push(`DTM+132:${msgDt14}:203'`);

  // ── NAD+BY — Buyer (McLaren) ──────────────────────────────────────────────────
  segs.push(`NAD+BY+${buyerCode}::10++McL Automotive Ltd'`);

  // ── NAD+SE — Seller (noi) ─────────────────────────────────────────────────────
  // Formato: NAD+SE+{code}::10++{name}+{street}+{city}++{zip}+{country}'
  // I componenti finali vuoti vengono soppressi (regola EDIFACT trailing empty)
  const nadSeParts = [
    `NAD+SE+${supplierCode10}::10`,
    '',           // C058 vuoto
    ourName,
    ourStreet,
    ourCity,
    '',           // country subdivision vuoto
    ourZip,
    ourCountry,
  ];
  // Rimuovi elementi vuoti dalla fine
  while (nadSeParts.length > 1 && nadSeParts[nadSeParts.length - 1] === '') {
    nadSeParts.pop();
  }
  segs.push(`${nadSeParts.join('+')}'`);

  // ── NAD+CN — Consegnatario ────────────────────────────────────────────────────
  if (consigneeCode) {
    segs.push(`NAD+CN+${consigneeCode}::10'`);
  }

  // ── LOC+159 — Punto di consegna ───────────────────────────────────────────────
  if (locationCode) {
    segs.push(`LOC+159+${locationCode}'`);
  }

  // ── Loop righe ────────────────────────────────────────────────────────────────
  for (let i = 0; i < shipment.lines.length; i++) {
    const line   = shipment.lines[i];
    const lineNo = i + 1;
    const partNo = edifactEsc(String(line.article_code || ''));
    const qty    = Number(line.quantity || 0);
    const uom    = toEdifactUom(line.unit_of_measure);
    const poNo   = edifactEsc(String(line.contract_number || ''));
    segs.push(`CPS+${lineNo}'`);
    segs.push(`PAC+1'`);
    segs.push(`LIN+${lineNo}++${partNo}:IN+:0+0'`);
    segs.push(`QTY+12:${qty}:${uom}'`);

    if (poNo) {
      segs.push(`RFF+ON:${poNo}:00010'`);
    }
    segs.push(`RFF+AAU:${docNo}'`);
  }

  // ── UNT — conta segmenti da UNH a UNT incluso (escludi UNA e UNB) ─────────────
  const bodySegCount = segs.length - 2; // escludi UNA e UNB
  segs.push(`UNT+${bodySegCount + 1}+${msgRef}'`);

  // ── UNZ ───────────────────────────────────────────────────────────────────────
  segs.push(`UNZ+1+${intRef}'`);

  return segs.join('\n') + '\n';
}
