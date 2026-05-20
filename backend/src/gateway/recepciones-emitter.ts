import { EventEmitter } from 'events';

export interface RecepcionEvento {
  tipo:   string;
  data?:  Record<string, unknown>;
  count?: number;
}

class RecepcionesEmitter extends EventEmitter {}
export const recepcionesEmitter = new RecepcionesEmitter();
recepcionesEmitter.setMaxListeners(200);
