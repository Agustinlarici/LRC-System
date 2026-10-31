'use client';

export interface LetturaCartella {
  id: number; tipo: 'auto' | 'manuale'; utente: string | null; avviato_at: string; finito_at: string | null;
  trovati: number; invariati: number; nuovi: number; duplicati: number; quarantena: number; errori: number;
  dettaglio: { nome: string; esito: string; commessa?: string; motivo?: string }[]; errore: string | null;
}
export interface StatoCartella {
  config: { percorso: string; auto: boolean; ora: number };
  in_corso: { tipo: string; avviato_at: string } | null;
  letture: LetturaCartella[];
}

export const quando = (iso: string | null) => iso
  ? new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

export const riassunto = (l: LetturaCartella) => l.errore ? `errore: ${l.errore}`
  : `${l.nuovi} nuove, ${l.duplicati} già presenti, ${l.quarantena} non valide, ${l.errori} errori`;

/** Una riga sotto il titolo: da dove si leggono le schede e com'e' andata l'ultima volta. */
export function InfoCartella({ stato }: { stato: StatoCartella | null }) {
  if (!stato) return null;
  const { config, in_corso, letture } = stato;
  const ultima = letture.find(l => l.finito_at);
  return (
    <p className="mt-1 text-xs text-muted">
      {!config.percorso ? 'Cartella degli Excel non ancora scelta (Impostazioni, Cartella Excel).'
        : in_corso ? 'Lettura della cartella in corso…'
        : ultima ? `Ultima lettura ${quando(ultima.finito_at)} (${ultima.tipo === 'auto' ? 'automatica' : 'manuale'}): ${riassunto(ultima)}`
        : 'Nessuna lettura ancora.'}
      {config.percorso && config.auto && !in_corso && ` · automatica ogni notte alle ${String(config.ora).padStart(2, '0')}:20`}
    </p>
  );
}
