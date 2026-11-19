'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/ui/PageHeader';

interface Despacho { shipment_id: string; shipment_date: string; customer_account: string; line_count: number; totale_str: number }
interface Riga {
  line_no: number; article_code: string; quantity: number; order_no: string; descrizione: string;
  prezzo_str: number; totale_riga: number; regole: { id: number; nome: string; prezzo: number }[];
}
interface Dettaglio { shipment_id: string; righe: Riga[]; totale_str: number }

const eur = (n: number) => n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });

export default function FatturazionePage() {
  const { canManage } = useAuth();
  const [rows, setRows] = useState<Despacho[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [det, setDet] = useState<Dettaglio | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    if (search.trim()) q.set('search', search.trim());
    try { setRows(await api.get<Despacho[]>(`/api/fatturazione/despachi?${q}`, 60000)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [from, to, search]);
  useEffect(() => { load(); }, [load]);

  async function toggle(id: string) {
    if (open === id) { setOpen(null); return; }
    setOpen(id); setDet(null);
    try { setDet(await api.get<Dettaglio>(`/api/fatturazione/despachi/${encodeURIComponent(id)}`, 60000)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  const inp = 'border border-gray-300 rounded-md px-2 py-1 text-sm';
  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader
        title="Fatturazione"
        description="Despachi con prezzo di vendita stimato STR (calcolato dalle regole sulla descrizione dell'ordine)"
        actions={canManage('fatturazione') && <Link href="/fatturazione/impostazioni" className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50">Regole</Link>}
      />
      <div className="mb-4 flex flex-wrap gap-2 items-center">
        <input type="date" className={inp} value={from} onChange={e => setFrom(e.target.value)} />
        <input type="date" className={inp} value={to} onChange={e => setTo(e.target.value)} />
        <input className={inp} placeholder="N. despacho" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">{error}</div>}
      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600"><tr>
            <th className="px-3 py-2">Despacho</th><th className="px-3 py-2">Data</th><th className="px-3 py-2">Cliente</th>
            <th className="px-3 py-2 text-right">Righe</th><th className="px-3 py-2 text-right">Totale STR stimato</th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">Caricamento…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">Nessun despacho</td></tr>}
            {rows.map(r => (
              <Fragment key={r.shipment_id}>
                <tr className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => toggle(r.shipment_id)}>
                  <td className="px-3 py-2 font-medium">{r.shipment_id}</td><td className="px-3 py-2">{r.shipment_date}</td>
                  <td className="px-3 py-2">{r.customer_account}</td><td className="px-3 py-2 text-right">{r.line_count}</td>
                  <td className="px-3 py-2 text-right font-semibold">{eur(r.totale_str)}</td>
                </tr>
                {open === r.shipment_id && (
                  <tr><td colSpan={5} className="bg-gray-50 px-3 py-3">
                    {!det ? <span className="text-gray-400">Caricamento…</span> : (
                      <table className="w-full text-xs">
                        <thead className="text-left text-gray-500"><tr><th className="py-1">Codice</th><th>Descrizione ordine</th><th className="text-right">Q.tà</th><th>Regole applicate</th><th className="text-right">Unitario</th><th className="text-right">Totale</th></tr></thead>
                        <tbody>{det.righe.map(l => (
                          <tr key={l.line_no} className="border-t border-gray-200 align-top">
                            <td className="py-1 pr-2 font-mono">{l.article_code}</td><td className="pr-2">{l.descrizione || <em className="text-gray-400">vuota</em>}</td>
                            <td className="text-right pr-2">{l.quantity}</td>
                            <td className="pr-2">{l.regole.length === 0 ? <em className="text-amber-600">nessuna regola</em> : l.regole.map(g => `${g.nome} (${eur(g.prezzo)})`).join(' + ')}</td>
                            <td className="text-right pr-2">{eur(l.prezzo_str)}</td><td className="text-right font-semibold">{eur(l.totale_riga)}</td>
                          </tr>))}
                        </tbody>
                      </table>
                    )}
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
