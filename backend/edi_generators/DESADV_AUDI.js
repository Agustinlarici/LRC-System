/**
 * Generatore EDI DESADV VDA 4987 T2 Global — Gruppo Volkswagen / AUDI
 * Standard: UN/EDIFACT DESADV:D:20B:UN:GAVF30 | VDA 3.0 / VW 4.0 (come il validatore GEFEG di VW)
 * Processo: LAB-ED (call-off con data di consegna — standard forniture serie)
 *
 * La struttura segue il messaggio d'esempio validato con GEFEG.FX: un pallet (CPS livello 3)
 * che contiene una scatola (CPS livello 1) per ogni riga articolo. I dati che il sistema non
 * conosce (etichette GIN/PCI, COD+NO, tara per imballo) NON sono inventati: se mancano, il
 * segmento viene omesso e sarà GEFEG a segnalarlo.
 *
 * Campi cliente (edi_clients):
 *   supplier_code          → codice fornitore (NAD+SE/SF, qualificatore 92), senza zeri aggiunti
 *   cdt_vat                → ID mittente in UNB (se non c'è params.unb_sender)
 *   cdt_company_name, cdt_address_1..4 → mittente: ragione sociale, via, città, CAP, paese
 *   csg_establishment_code → ID destinatario in UNB (se non c'è params.unb_recipient)
 *   csg_company_name       → nome destinatario (NAD+ST)
 *   csg_supply_point       → codice impianto destinatario (NAD+ST, an..5)
 *   csg_address_1          → Incoterms (TOD), default FCA
 *
 * Parametri (edi_clients.edi_params, tutti stringhe):
 *   unb_sender, unb_recipient       composti UNB così come vanno scritti (es. "763473:AA",
 *                                   "O0013000001VW      KEY::LAFES")
 *   test_flag                       "1" → indicatore di test in UNB (0035)
 *   supplier_duns                   DUNS del fornitore (RFF+ANK di NAD+SE e NAD+SF)
 *   buyer_code/name/street/city/zip/country        NAD+BY
 *   shipto_street/city/zip/country                 NAD+ST (il codice è csg_supply_point)
 *   unloading_code                  codice punto di scarico (LOC+11/LOC+7), default csg_supply_point
 *   unloading_address               testo LOC+11 (3224): Nome;Via1;Via2;Distretto;CAP;Città;Paese
 *   fw_code/name/street/city/zip/country/duns      NAD+FW (spedizioniere)
 *   transport_id                    targa/identificativo mezzo (TDT)
 *   pallet_code, pallet_stack       imballo principale (es. 0007PAL) e impilabilità (QTY+171)
 *   box_code                        imballo interno di ogni riga (es. 0009SCH)
 *   origin_country                  paese d'origine (ALI), default paese del mittente o IT
 *
 * Dati della spedizione:
 *   gross_weight, net_weight, tare_weight (kg) → MEA+AAX+AAD / AAL / T
 *   lines[].contract_number → RFF+ON (ordine d'acquisto Audi)
 *   lines[].article_code    → LIN, qualificatore IN (con lo spazio iniziale richiesto da VW)
 *
 * @param {object} shipment  Dati della spedizione (dal frontend/backend routes.ts)
 * @param {object} client    Configurazione cliente EDI (da edi_clients DB)
 * @param {number} sequence  Sequenza progressiva annuale (già incrementata)
 * @returns {string}         Contenuto file EDIFACT (un segmento per riga)
 */

// Caratteri speciali EDIFACT che richiedono escape con '?' come release character
function esc(s) {
  return String(s ?? '').replace(/[?'+:]/g, c => '?' + c);
}

// Valore di testo: tagliato alla lunghezza massima e con escape
function txt(s, max) {
  return esc(String(s ?? '').trim().slice(0, max));
}

function fmtDate8(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getUTCFullYear()}${String(dt.getUTCMonth()+1).padStart(2,'0')}${String(dt.getUTCDate()).padStart(2,'0')}`;
}

function fmtTime4(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${String(dt.getUTCHours()).padStart(2,'0')}${String(dt.getUTCMinutes()).padStart(2,'0')}`;
}

// Unità di misura ammesse da VW: C62, PCE, SET, MTR, CMT, MMT, MTK, LEF, MTQ, LTR, PR, RO, TNE, KGM, GRM, KMT
const UOM_MAP = { NUMERO: 'PCE', NUM: 'PCE', NR: 'PCE', PZ: 'PCE', PCS: 'PCE', PEZZI: 'PCE' };
function uom(raw) {
  const u = String(raw || 'PCE').trim().toUpperCase();
  return UOM_MAP[u] ?? u.slice(0, 3);
}

// Peso in kg: numero positivo con punto decimale, altrimenti null (segmento omesso)
function kg(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? String(Math.round(n * 1000) / 1000) : null;
}

export function generate(shipment, client, sequence) {
  const now = new Date();
  const p = (client.edi_params && typeof client.edi_params === 'object') ? client.edi_params : {};
  const prm = k => String(p[k] ?? '').trim();

  const supplierCode = String(client.supplier_code || '').trim();
  const plantCode    = String(client.csg_supply_point || '').trim().slice(0, 5);
  const unloadCode   = (prm('unloading_code') || plantCode).slice(0, 3);
  const incoterms    = String(client.csg_address_1 || 'FCA').trim().toUpperCase().slice(0, 3);
  const originCountry = (prm('origin_country') || String(client.cdt_address_4 || '').trim() || 'IT').slice(0, 3);

  // Riferimenti: CRN/BGM = anno (2 cifre) + sequenza (6 cifre) = 8 cifre, unico nell'anno;
  // UNB/UNZ = sequenza a 6 cifre; RFF+AAU (n..8) = sequenza senza zeri iniziali.
  const seq6     = String(sequence).padStart(6, '0').slice(-6);
  const asnRef   = `${String(now.getUTCFullYear()).slice(-2)}${seq6}`;
  const unbRef   = seq6;
  const msgRef   = `EDDT-${seq6}`;
  const delivNo  = String(Number(sequence));

  const sender    = prm('unb_sender')    || String(client.cdt_vat || '').trim();
  const recipient = prm('unb_recipient') || String(client.csg_establishment_code || '').trim();

  const today   = fmtDate8(now);
  const despDt  = shipment.document_date ? new Date(shipment.document_date) : now;
  const despDate = fmtDate8(despDt);

  const segs = [];

  // NAD con indirizzo: codice parte (qualificatore 92) + nome, via, città, CAP, paese
  const nad = (qual, code, name, street, city, zip, country) =>
    `NAD+${qual}+${txt(code, 17)}::92++${txt(name, 35)}+${txt(street, 35)}+${txt(city, 35)}++${txt(zip, 9)}+${txt(country, 3)}'`;

  // ── Busta ────────────────────────────────────────────────────────────────────
  segs.push("UNA:+.? '");
  // Sintassi UNOC:X, data a 8 cifre, nessun 0031; flag di test (0035) se richiesto
  const testFlag = prm('test_flag') === '1' ? '++++++1' : '';
  segs.push(`UNB+UNOC:X+${sender}+${recipient}+${today}:${fmtTime4(now)}+${unbRef}${testFlag}'`);
  segs.push(`UNH+${msgRef}+DESADV:D:20B:UN:GAVF30'`);

  // ── Testata ──────────────────────────────────────────────────────────────────
  segs.push(`BGM+351:::LAB-ED+${asnRef}+9'`);
  segs.push(`DTM+137:${today}:102'`);
  segs.push(`DTM+11:${despDate}:102'`);
  segs.push(`DTM+132:${despDate}:102'`);

  // Pesi della consegna (valori > 0): lordo, netto, tara; AAE = unità di carico (1 pallet)
  const gross = kg(shipment.gross_weight);
  const net   = kg(shipment.net_weight);
  const tare  = kg(shipment.tare_weight);
  if (gross) segs.push(`MEA+AAX+AAD+KGM:${gross}'`);
  if (net)   segs.push(`MEA+AAX+AAL+KGM:${net}'`);
  if (tare)  segs.push(`MEA+AAX+T+KGM:${tare}'`);
  segs.push(`MEA+AAE++PCE:1'`);

  segs.push(`RFF+CRN:${asnRef}'`);

  // ── Parti ────────────────────────────────────────────────────────────────────
  if (prm('buyer_code')) {
    segs.push(nad('BY', prm('buyer_code'), prm('buyer_name'), prm('buyer_street'), prm('buyer_city'), prm('buyer_zip'), prm('buyer_country')));
  }
  const supplierNad = q => nad(q, supplierCode, client.cdt_company_name, client.cdt_address_1, client.cdt_address_2, client.cdt_address_3, client.cdt_address_4);
  const duns = prm('supplier_duns');
  segs.push(supplierNad('SE'));
  if (duns) segs.push(`RFF+ANK:${esc(duns)}'`);
  segs.push(supplierNad('SF'));
  if (duns) segs.push(`RFF+ANK:${esc(duns)}'`);

  if (plantCode) {
    segs.push(nad('ST', plantCode, client.csg_company_name, prm('shipto_street'), prm('shipto_city'), prm('shipto_zip'), prm('shipto_country')));
    // LOC+11: punto di scarico; 3224 = indirizzo (Nome;Via1;Via2;Distretto;CAP;Città;Paese) dal LOC+7 del call-off
    segs.push(`LOC+11+${txt(unloadCode, 3)}::92:${txt(prm('unloading_address'), 256)}'`);
  }

  if (prm('fw_name')) {
    segs.push(nad('FW', prm('fw_code') || '7', prm('fw_name'), prm('fw_street'), prm('fw_city'), prm('fw_zip'), prm('fw_country')));
    if (prm('fw_duns')) segs.push(`RFF+ANK:${esc(prm('fw_duns'))}'`);
  }

  // ── Condizioni di resa e trasporto ───────────────────────────────────────────
  segs.push(`TOD+6++${esc(incoterms)}'`);
  segs.push(prm('transport_id') ? `TDT+12++30+++++${txt(prm('transport_id'), 17)}'` : `TDT+12++30'`);

  // ── Gerarchia imballi: pallet (livello 3) ────────────────────────────────────
  segs.push(`CPS+1++3'`);
  segs.push(prm('pallet_code') ? `PAC+1+:35:AAA+${txt(prm('pallet_code'), 17)}::92'` : `PAC+1+:35:AAA'`);
  if (prm('pallet_stack')) segs.push(`QTY+171:${txt(prm('pallet_stack'), 3)}:C62'`);
  segs.push(`QTY+189:1:PCE'`);

  // ── Una scatola (livello 1) per ogni riga articolo ───────────────────────────
  let cps = 1;
  const lines = shipment.lines || [];
  for (let i = 0; i < lines.length; i++) {
    const line   = lines[i];
    const lineNo = i + 1;
    const unit   = uom(line.unit_of_measure);
    const qty    = Number(line.quantity || 0);
    const desc   = txt(line.description, 35);
    const poNo   = txt(line.contract_number, 35);

    cps += 1;
    segs.push(`CPS+${cps}++1'`);
    segs.push(prm('box_code') ? `PAC+1+:35:AAC+${txt(prm('box_code'), 17)}::92'` : `PAC+1+:35:AAC'`);
    // QTY+52 (pezzi per scatola) × 1 scatola = QTY+12
    segs.push(`QTY+52:${qty}:${unit}'`);

    // LIN senza numero di riga; il codice cliente inizia con uno spazio (VW), mai fare trim
    segs.push(`LIN+++ ${txt(line.article_code, 22)}:IN'`);
    // IMD: 11 = produzione di serie, descrizione nel 7008
    segs.push(`IMD+++11::272:${desc}'`);
    segs.push(`QTY+12:${qty}:${unit}'`);
    segs.push(`ALI+${txt(originCountry, 3)}+N'`);
    segs.push(`RFF+AAU:${delivNo}:${lineNo}'`);
    if (poNo) segs.push(`RFF+ON:${poNo}'`);
    if (unloadCode) segs.push(`LOC+7+${txt(unloadCode, 3)}::92'`);
  }

  // ── UNT / UNZ ────────────────────────────────────────────────────────────────
  // UNT conta da UNH fino a UNT incluso (esclude UNA e UNB)
  const bodySegCount = segs.length - 2;
  segs.push(`UNT+${bodySegCount + 1}+${msgRef}'`);
  segs.push(`UNZ+1+${unbRef}'`);

  // Un segmento per riga (leggibile). GEFEG lo segnala come avviso UNA 00001:000,
  // ma VW ha confermato che va bene così.
  return segs.join('\n') + '\n';
}
