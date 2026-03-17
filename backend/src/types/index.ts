// ─── Common response types ────────────────────────────────────────────────────

export interface ApiError {
  error: string;
  details?: string;
}

export interface ApiSuccess<T = unknown> {
  data: T;
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

export interface IngressoMerciStorico extends IngressoMerci {
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

export interface PackPalletItem {
  id: number;
  palletId: number;
  articleCode: string;
  quantity: number;
  commessa: string | null;
  createdAt: string;
}

export interface PackContainer {
  id: number;
  name: string;
  code: string | null;
}

export interface PackArticleWeight {
  articleCode: string;
  weightKg: number;
}

export interface PackArticlePrice {
  articleCode: string;
  currency: string;
  price: number;
}

// ─── SPMA ─────────────────────────────────────────────────────────────────────

export type SpmaStatus = 'PENDING' | 'PICKED' | 'CONFIRMED' | 'SENT' | 'SKIPPED';

export interface SpmaCommessa {
  id: number;
  commessaNo: string;
  lineId: number | null;
  modelCode: string | null;
  lineEntryTs: string | null;
  createdAt: string;
}

export interface SpmaPlan {
  id: number;
  commessaId: number;
  categoryId: number;
  itemCode: string | null;
  status: SpmaStatus;
  confirmedAt: string | null;
  sentAt: string | null;
  updatedAt: string;
}

export interface SpmaComponentCategory {
  id: number;
  name: string;
  sortOrder: number;
}

export interface SpmaLine {
  id: number;
  name: string;
}

// ─── Production Orders ────────────────────────────────────────────────────────

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
  rowSig: string | null;
  createdAt: string;
  updatedAt: string;
}
