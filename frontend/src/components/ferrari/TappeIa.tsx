'use client';

import type { Tappa, StatoTappa } from '@/lib/ferrari-ia';
import { IconaAvviso, IconaChiudi, IconaOk, IconaRotella, IconaTrattino } from '@/components/ferrari/Icone';

// Colori dei token del design system. «in corso» e' celeste (accent), pronto verde, attenzione ambra, errore rosso, saltato tratteggiato.
const CERCHIO: Record<StatoTappa, string> = {
  fatto: 'bg-success text-white',
  in_corso: 'bg-accent text-white ring-4 ring-accent/20 motion-safe:animate-pulse',
  da_fare: 'border border-line bg-white text-stone-300',
  attenzione: 'border border-warning/40 bg-warning-soft text-warning',
  errore: 'border border-danger/40 bg-danger-soft text-danger',
  saltato: 'border border-dashed border-stone-300 bg-white text-stone-400',
};
const TESTO: Record<StatoTappa, string> = {
  fatto: 'text-ink-900', in_corso: 'text-accent-ink font-semibold', da_fare: 'text-muted', attenzione: 'text-warning font-medium', errore: 'text-danger font-medium', saltato: 'text-stone-400',
};
const NOME_STATO: Record<StatoTappa, string> = { fatto: 'fatto', in_corso: 'in corso', da_fare: 'da fare', attenzione: 'attenzione', errore: 'errore', saltato: 'saltato' };

function Icona({ stato, n }: { stato: StatoTappa; n: number }) {
  switch (stato) {
    case 'fatto': return <IconaOk className="h-3.5 w-3.5" />;
    case 'in_corso': return <IconaRotella />;
    case 'attenzione': return <IconaAvviso />;
    case 'errore': return <IconaChiudi />;
    case 'saltato': return <IconaTrattino />;
    default: return <span className="text-[10px] font-semibold">{n}</span>;
  }
}

/** Le sei tappe di una scheda con i colori dello stato: l'utente vede a che punto e' il programma. */
export function TappeIa({ tappe }: { tappe: Tappa[] }) {
  return (
    <ol className="flex min-w-[28rem] items-start" aria-label="Tappe di elaborazione">
      {tappe.map((t, i) => (
        <li key={t.passo} className="flex min-w-0 flex-1 flex-col items-center text-center" title={t.dettaglio ? `${t.etichetta}: ${t.dettaglio}` : t.etichetta}>
          <div className="flex w-full items-center">
            <span className={`h-0.5 flex-1 ${i === 0 ? 'opacity-0' : tappe[i - 1]!.stato === 'fatto' ? 'bg-success' : 'bg-line'}`} />
            <span role="img" aria-label={`${t.etichetta}: ${NOME_STATO[t.stato]}`} className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${CERCHIO[t.stato]}`}>
              <Icona stato={t.stato} n={i + 1} />
            </span>
            <span className={`h-0.5 flex-1 ${i === tappe.length - 1 ? 'opacity-0' : t.stato === 'fatto' ? 'bg-success' : 'bg-line'}`} />
          </div>
          <span className={`mt-1 text-[11px] leading-tight ${TESTO[t.stato]}`}>{t.etichetta}</span>
          {t.dettaglio && <span className="mt-0.5 max-w-[7rem] truncate text-[10px] leading-tight text-muted">{t.dettaglio}</span>}
        </li>
      ))}
    </ol>
  );
}
