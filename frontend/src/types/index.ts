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

export type SpmaStatus = 'PENDING' | 'PICKED' | 'CONFIRMED' | 'SENT' | 'SKIPPED';

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
