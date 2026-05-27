// ─── Auth ─────────────────────────────────────────────────────────────────────

export type ModuleKey =
  | 'ingresso_merci' | 'packing' | 'monitor' | 'monitor_resumen' | 'buffer'
  | 'mappa' | 'tickets' | 'tickets_it' | 'tickets_admin' | 'impostazioni' | 'dashboards'
  | 'spma' | 'recepciones' | 'edi';

export interface ModulePermission {
  module_key: ModuleKey;
  can_view:   boolean;
  can_manage: boolean;
}

export interface AuthUser {
  id:           number;
  username:     string;
  display_name: string;
  role:         'guest' | 'operator' | 'it' | 'admin';
  permissions:  ModulePermission[];
}

// ─── Ingresso Merci ───────────────────────────────────────────────────────────

export interface IngressoMerci {
  id: number;
  materiale: string;
  mezzo: string;
  commessa: string | null;
  inseritoDa: string;
  orarioArrivo: string;
  timestampInserimento: string;
}

export interface IngressoMerciStorico {
  id: number;
  materiale: string;
  mezzo: string;
  commessa: string | null;
  inseritoDa: string;
  orarioArrivo: string;
  ricevutoDa: string;
  timestampRicezione: string;
}

// ─── Packing ─────────────────────────────────────────────────────────────────

export interface PackOperator {
  id: number;
  name: string;
}

export interface PackArticle {
  code: string;
  description: string | null;
}

export interface PackDispatch {
  id: number;
  type: string | null;
  destinationId: number | null;
  createdAt: string;
}

export interface PackDispatchDestination {
  id: number;
  name: string;
}

export interface PackContainer {
  id: number;
  name: string;
  code: string | null;
}

// ─── SPMA ─────────────────────────────────────────────────────────────────────

export type SpmaStatus = 'PENDING' | 'PICKED' | 'CONFIRMED' | 'SENT' | 'SKIPPED' | 'NA';

export interface SpmaCategory {
  id:         number;
  name:       string;
  sort_order: number;
}

export interface SpmaStation {
  id:                   number;
  line_id:              number;
  line_name:            string;
  component_category_id: number;
  category_name:        string;
  station_index:        number;
}

export interface SpmaModelReq {
  id:                   number;
  model_code:           string;
  component_category_id: number;
  category_name:        string;
  producer_name:        string | null;
}

export interface SpmaOverviewCell {
  component_category_id: number;
  status:       SpmaStatus;
  planned_ts:   string | null;
  current_fase: string | null;
}

export interface SpmaOverviewRow {
  commessa_id:   number;
  commessa_code: string;
  model_code:    string;
  line_id:       number;
  line_entry_ts: string | null;
  cells:         SpmaOverviewCell[];
}

export interface SpmaPlanItem {
  id:                   number;
  commessa_id:          number;
  commessa_code:        string;
  component_category_id: number;
  category_name:        string;
  status:               SpmaStatus;
  planned_ts:           string | null;
  confirmed_item_code:  string | null;
  picked_at:            string | null;
  confirmed_at:         string | null;
  sent_at:              string | null;
}

export interface SpmaLine {
  id: number;
  name: string;
}

export interface SpmaComponentCategory {
  id: number;
  name: string;
  sortOrder: number;
}

export interface SpmaCommessa {
  id: number;
  commessaNo: string;
  lineId: number | null;
  modelCode: string | null;
  lineEntryTs: string | null;
  createdAt: string;
}

export interface SpmaPlanItem {
  id: number;
  commessaId: number;
  categoryId: number;
  itemCode: string | null;
  status: SpmaStatus;
  confirmedAt: string | null;
  sentAt: string | null;
  updatedAt: string;
}

export interface SpmaCalendarDefault {
  id:          number;
  day_of_week: number;
  shift_start: string | null;
  shift_end:   string | null;
  is_working:  boolean;
}

export interface SpmaCalendarEntry {
  id:            number;
  line_id:       number;
  work_date:     string;
  start_time:    string;
  end_time:      string;
  auto_generated: boolean;
}

export interface SpmaFaseSequence {
  id:                     number;
  component_category_id:  number;
  order_index:            number;
  fase_name:              string;
  duration_minutes:       number;
}

export interface SpmaAlertConfig {
  warning_pct:  number;
  critical_pct: number;
  smtp_host:    string | null;
  smtp_port:    number | null;
  smtp_secure:  boolean | null;
  smtp_user:    string | null;
  smtp_from:    string | null;
  smtp_to:      string | null;
}

export interface SpmaDelayItem {
  commessa_code:     string;
  model_code:        string | null;
  category_id:       number;
  category_name:     string;
  planned_ts:        string;
  current_fase:      string | null;
  delay_pct:         number;
  delay_minutes:     number;
  remaining_minutes: number;
  severity:          'ok' | 'warning' | 'critical';
}

// ─── Monitor ──────────────────────────────────────────────────────────────────

export interface MonitorLinea {
  id: number;
  nome: string;
  fase: string;
  attivo: boolean;
  logo: string | null;
  created_at: string;
}

export interface MonitorCombo {
  id: number;
  linea_id: number;
  modello: string;
  componente: string;
}

export interface MonitorTurno {
  id: number;
  linea_id: number;
  data: string;
  numero: number;
  ora_inizio: string;
  ora_fine: string;
}

export interface MonitorSoglie {
  linea_id: number;
  soglia_giallo: number;
  soglia_rosso: number;
}

export interface MonitorResumen {
  id: number;
  nome: string;
  linea_count: number;
  created_at: string;
}

export interface MonitorResumenLinea {
  linea_id: number;
  nome: string;
  fase: string;
  attivo: boolean;
}

export interface MonitorResumenDettaglio {
  id: number;
  nome: string;
  created_at: string;
  linee: MonitorResumenLinea[];
}

export interface MonitorStato {
  linea: { id: number; nome: string; logo: string | null };
  turno_attivo: boolean;
  in_pausa?: boolean;
  qta_prodotta: number;
  qta_da_produrre: number;
  cycle_time_sec: number | null;
  ultimo_evento: string | null;
  elapsed_sec: number | null;
  remaining_sec: number | null;
  linestop_sec: number;
  avanzamento_previsto: number;
  commesse: string[];
  soglie: { soglia_giallo: number; soglia_rosso: number };
}

// ─── Buffer ───────────────────────────────────────────────────────────────────

export interface BufferLinea {
  id: number;
  nome: string;
  fasi: string[];
  attivo: boolean;
  combos: { modello: string; componente: string }[];
  soglie: { soglia_verde: number; soglia_giallo: number };
}

export interface BufferStato {
  count: number;
  commesse: string[];
  colore: 'verde' | 'giallo' | 'rosso';
  soglie: { soglia_verde: number; soglia_giallo: number };
}

// ─── Production ───────────────────────────────────────────────────────────────

export interface ProdOrder {
  id: number;
  bcOrderNo: string;
  description: string | null;
  itemNo: string | null;
  quantity: number | null;
  dueDate: string | null;
  status: string | null;
  routingNo: string | null;
  presentNow: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── EDI ─────────────────────────────────────────────────────────────────────

export interface EdiClient {
  id:                         number;
  customer_account:           string;
  description:                string;
  edi_type:                   string;
  cdt_company_name:           string;
  cdt_vat:                    string;
  cdt_address_1:              string | null;
  cdt_address_2:              string | null;
  cdt_address_3:              string | null;
  cdt_address_4:              string | null;
  sdt_vat:       string;
  supplier_code: string;
  csg_establishment_code:     '021' | '023' | '025' | '029' | '030' | 'SSF';
  csg_company_name:           string;
  csg_address_1:              string | null;
  csg_address_2:              string | null;
  csg_address_3:              string | null;
  csg_address_4:              string | null;
  csg_supply_point:           string | null;
  output_folder:              string;
  created_at:                 string;
  updated_at:                 string;
}

export interface EdiShipment {
  shipment_id:      string;
  shipment_date:    string;
  customer_account: string;
  document_number:  string;
  document_date:    string;
  is_extra_cee:     boolean;
  line_count:       number;
  edi_type:         string;
  edi_status:       'sent' | 'error' | 'pending';
}

export interface EdiLine {
  article_code:    string;
  description:     string;
  quantity:        number;
  unit_of_measure: string;
  contract_number: string | null;
}

export interface EdiHistoryEntry {
  id:               number;
  shipment_id:      string;
  customer_account: string;
  edi_type:         string;
  filename:         string;
  generated_at:     string;
  status:           'sent' | 'error';
  error_message:    string | null;
  is_regeneration:  boolean;
}

// ─── Recepciones DDT ─────────────────────────────────────────────────────────

export interface Recepcion {
  id_ddt:        number;
  pdf_path:      string;
  proveedor:     string | null;
  numero_ddt:    string | null;
  fecha_ddt:     string | null;
  destinatario:  string | null;
  confianza_ia:  'alta' | 'media' | 'baja' | null;
  estado:        'confirmado' | 'revision_manual';
  escaner_id:    string;
  creado_at:     string;
  confirmado_at: string | null;
}
