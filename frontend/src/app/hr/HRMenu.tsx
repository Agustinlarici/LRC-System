'use client';

import Link from 'next/link';

const options = [
  { href: '/hr/dipendenti',   title: 'Dipendenti',           desc: 'Anagrafica, dati lavorativi e storico eventi di ogni persona' },
  { href: '/hr/organigramma', title: 'Organigramma',          desc: 'Struttura organizzativa, responsabili e team' },
  { href: '/hr/analisi',      title: 'Analisi HR',            desc: 'Organico, età, anzianità e distribuzioni' },
  { href: '/hr/evoluzione',   title: 'Evoluzione Aziendale',  desc: 'Come è cambiata l\'azienda nel tempo' },
];

export function HRMenu() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {options.map((opt) => (
        <Link key={opt.href} href={opt.href} className="card group hover:shadow-md transition-shadow cursor-pointer">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-semibold text-gray-800 group-hover:text-blue-600 transition-colors">{opt.title}</h2>
              <p className="text-sm text-gray-400 mt-1">{opt.desc}</p>
            </div>
            <span className="text-gray-300 group-hover:text-blue-500 transition-colors">→</span>
          </div>
        </Link>
      ))}
    </div>
  );
}
