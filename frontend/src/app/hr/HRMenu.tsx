'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth';

// soloHr: voci riservate a HR (i capi con permesso hr_team non le vedono)
const options: { href: string; title: string; desc: string; soloHr?: boolean }[] = [
  { href: '/hr/dipendenti',   title: 'Dipendenti',           desc: 'Anagrafica, dati lavorativi e storico eventi di ogni persona' },
  { href: '/hr/richieste',   title: 'Richieste',             desc: 'Ferie, assenze e modifiche scheda proposte dai capi, da approvare da HR' },
  { href: '/hr/scadenze',     title: 'Scadenze',              desc: 'Contratti in scadenza e regole di avviso' },
  { href: '/hr/documenti',     title: 'Documenti',             desc: 'Modelli di lettera (cambio mansione, retribuzione…) e documenti di consultazione', soloHr: true },
  { href: '/hr/vestiario',    title: 'Vestiario',             desc: 'Taglie di pantaloni, maglia e scarpe per reparto, da usare negli ordini', soloHr: true },
  { href: '/hr/organigramma', title: 'Organigramma',          desc: 'Struttura organizzativa, responsabili e team' },
  { href: '/hr/analisi',      title: 'Analisi HR',            desc: 'Organico, età, anzianità e distribuzioni', soloHr: true },
  { href: '/hr/evoluzione',   title: 'Evoluzione Aziendale',  desc: 'Come è cambiata l\'azienda nel tempo', soloHr: true },
];

export function HRMenu() {
  const { canView } = useAuth();
  const visible = options.filter(o => !o.soloHr || canView('hr'));
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {visible.map((opt) => (
        <Link key={opt.href} href={opt.href} className="card nudge group hover:shadow-float transition-shadow cursor-pointer">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-semibold text-ink-900 group-hover:text-accent-ink transition-colors">{opt.title}</h2>
              <p className="text-sm text-muted mt-1">{opt.desc}</p>
            </div>
            <span aria-hidden className="nudge-x text-stone-300 group-hover:text-accent-ink transition-colors">→</span>
          </div>
        </Link>
      ))}
    </div>
  );
}
