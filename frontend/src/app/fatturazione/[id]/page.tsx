'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { TabellaDespacho, eur, type Dettaglio } from '../_components/TabellaDespacho';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function DespachoPage() {
  const { id } = useParams<{ id: string }>();
  const [det, setDet] = useState<Dettaglio | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [fCodice, setFCodice] = useState('');
  const [fTesto, setFTesto] = useState('');
  const [soloSenza, setSoloSenza] = useState(false);

  const carica = useCallback(async () => {
    setErrore(null);
    try { setDet(await api.get<Dettaglio>(`/api/fatturazione/despachi/${encodeURIComponent(id)}`, 60000)); }
    catch (e) { setErrore(errMsg(e)); }
  }, [id]);
  useEffect(() => { carica(); }, [carica]);

  const righe = useMemo(() => {
    if (!det) return [];
    const c = fCodice.trim().toLowerCase(), t = fTesto.trim().toLowerCase();
    return det.righe.filter(l =>
      (!c || l.article_code.toLowerCase().includes(c)) &&
      (!t || l.descrizione.toLowerCase().includes(t)) &&
      (!soloSenza || l.regole.length === 0));
  }, [det, fCodice, fTesto, soloSenza]);

  const senza = det ? det.righe.filter(l => l.regole.length === 0).length : 0;

  return (
    <div>
      <PageHeader
        title={`Spedizione ${id}`}
        back={{ label: 'Fatturazione', href: '/fatturazione' }}
        description={det ? `${det.shipment_date ?? 'senza data'} · cliente ${det.customer_account} · ${det.righe.length} righe` : undefined}
        badge={senza > 0 ? <StatusBadge tone="warning">{senza} senza regola</StatusBadge> : undefined}
      />
      {errore && <div className="mb-4 rounded-ctl bg-danger-soft p-3 text-sm text-danger">{errore}</div>}
      <div className="card !p-0 overflow-hidden">
        <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
          <div><label className="label">Codice</label><input className="input" placeholder="Filtra codice" value={fCodice} onChange={e => setFCodice(e.target.value)} /></div>
          <div><label className="label">Descrizione</label><input className="input" placeholder="Filtra descrizione" value={fTesto} onChange={e => setFTesto(e.target.value)} /></div>
          <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={soloSenza} onChange={e => setSoloSenza(e.target.checked)} />Solo righe senza regola</label>
          {det && <div className="ml-auto pb-2 text-sm text-muted">Totale STR stimato: <span className="font-semibold text-ink-900">{eur(det.totale_str)}</span></div>}
        </div>
        <div className="overflow-x-auto px-4 py-3">
          {!det && !errore ? <div className="skeleton h-24 w-full" />
            : det && righe.length === 0 ? <EmptyState title="Nessuna riga con questi filtri" />
            : det && <TabellaDespacho det={det} righe={righe} />}
        </div>
      </div>
    </div>
  );
}
