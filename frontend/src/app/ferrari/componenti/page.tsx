'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { regoleApi, type TabellaComponenti } from '@/lib/ferrari-regole';
import { Errore, VistaToggle } from '@/components/ferrari/Comuni';
import { ValoriComp } from '@/components/ferrari/RegoleComponenti';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconSettings } from '@/components/icons/ModuleIcons';

// «Per componente»: una riga per commessa, una colonna per componente. Quello che c'e' in ogni cella lo decidono le regole
// (pagina Regole): passando sopra un valore si vede quale regola lo ha prodotto.
export default function PerComponentePage() {
  const { canManage } = useAuth();
  const puoModificare = canManage('ferrari_schede');
  const [modello, setModello] = useState('');
  const [q, setQ] = useState('');
  const [t, setT] = useState<TabellaComponenti | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  const carica = useCallback(async (mod: string, testo: string) => {
    try {
      const r = await regoleApi.tabella(mod, testo);
      setT(r); setModello(r.modello); setErrore(null);
    } catch (e) { setErrore((e as Error).message); }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => { void carica(modello, q.trim()); }, 200);
    return () => clearTimeout(id);
  }, [modello, q, carica]);

  return (
    <div>
      <PageHeader
        title="Programma produzione (schede)"
        actions={
          <>
            <button className="btn-secondary" onClick={() => window.print()}>Stampa</button>
            <Link href="/ferrari/regole" className="btn-secondary">Regole</Link>
            {puoModificare && <Link href="/ferrari/impostazioni#componenti" className="btn-secondary group-gear"><IconSettings className="gear h-4 w-4" />Impostazioni</Link>}
          </>
        }
      />
      <Errore messaggio={errore} />

      <VistaToggle />

      {t && t.modelli.length > 0 && (
        <div className="d-print-none mb-4 flex flex-wrap items-center gap-2">
          <select className="input !w-auto" value={modello} onChange={e => setModello(e.target.value)}>
            {t.modelli.map(x => <option key={x.modello} value={x.modello}>{x.modello} ({x.schede})</option>)}
          </select>
          <input className="input !w-48" placeholder="Commessa…" value={q} onChange={e => setQ(e.target.value)} autoFocus />
          <span className="text-sm text-muted">{t.righe.length} commesse</span>
          {puoModificare && t.regole_attive > 0 && t.non_coperte.length > 0 && (
            <Link href="/ferrari/regole" className="text-xs text-muted hover:text-ink-900" title={t.non_coperte.map(x => `${x.sigla} (${x.schede})`).join(', ')}>
              {t.non_coperte.length} sigle senza regola
            </Link>
          )}
        </div>
      )}

      {!t ? null : t.modelli.length === 0 ? (
        <div className="rounded-card border border-line bg-white"><EmptyState title="Non c'è ancora nessuna scheda" hint="Carica un Excel dalla pagina principale." /></div>
      ) : t.regole_attive === 0 ? (
        <div className="rounded-card border border-line bg-white">
          <EmptyState title={`Nessuna regola per ${t.modello}`} hint="Le regole dicono cosa mettere in ogni componente a partire dalle sigle della scheda."
            action={<Link href="/ferrari/regole" className="btn-primary">{puoModificare ? 'Crea le regole' : 'Vedi le regole'}</Link>} />
        </div>
      ) : t.righe.length === 0 ? (
        <div className="rounded-card border border-line bg-white p-10 text-center text-sm text-muted">Nessuna commessa trovata</div>
      ) : (
        <div className="print-a4 overflow-auto max-h-[75vh] rounded-card border border-line bg-white print:max-h-none print:overflow-visible print:border-0">
          <table className="w-full text-sm operator-sheet">
            <thead>
              <tr className="border-b border-line bg-stone-50 text-muted">
                <th className="sticky left-0 top-0 z-20 bg-stone-50 px-4 py-2.5 text-left font-medium">Commessa</th>
                {t.componenti.map(c => <th key={c} className="sticky top-0 z-10 min-w-[160px] bg-stone-50 px-4 py-2.5 text-left font-semibold text-ink-900">{c}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {t.righe.map(r => (
                <tr key={r.file_id} className="align-top hover:bg-stone-50">
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-4 py-2 font-semibold">
                    <Link href={`/ferrari/${r.file_id}`} className="text-accent-ink hover:underline print:text-black">{r.commessa}</Link>
                  </td>
                  {t.componenti.map(c => (
                    <td key={c} className="max-w-[280px] px-4 py-2">
                      {r.celle[c]?.length ? <ValoriComp voci={r.celle[c]!} /> : <span className="text-muted">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <style>{`@media print { @page { size: A4 landscape; margin: 10mm; } .d-print-none { display: none !important; } .operator-sheet { font-size: 8pt; } }`}</style>
    </div>
  );
}
