'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { IconSettings } from '@/components/icons/ModuleIcons';
import { eur } from './_components/TabellaDespacho';

interface Stato { ultima_sync: string | null; in_corso: boolean; errore: string | null }
interface Despacho { shipment_id: string; shipment_date: string; customer_account: string; line_count: number; totale_str: number; senza_regola: number }
const dataOra = (iso: string) => new Date(iso).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function FatturazionePage() {
  const { canManage } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const manage = canManage('fatturazione');
  const [stato, setStato] = useState<Stato | null>(null);
  const [rows, setRows] = useState<Despacho[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [articolo, setArticolo] = useState('');
  const [testo, setTesto] = useState('');
  const [cliente, setCliente] = useState('');
  const [stato_, setStato_] = useState<'' | 'senza' | 'ok'>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    if (search.trim()) q.set('search', search.trim());
    if (articolo.trim()) q.set('articolo', articolo.trim());
    if (testo.trim()) q.set('testo', testo.trim());
    try { setRows(await api.get<Despacho[]>(`/api/fatturazione/despachi?${q}`, 60000)); }
    catch (e) { setError(errMsg(e)); }
    finally { setLoading(false); }
  }, [from, to, search, articolo, testo]);
  useEffect(() => { load(); }, [load]);

  const leggiStato = useCallback(async () => {
    try { const s = await api.get<Stato>('/api/fatturazione/stato'); setStato(s); return s; }
    catch { return null; }
  }, []);
  useEffect(() => { leggiStato(); }, [leggiStato]);

  // Mentre la sincronizzazione è in corso si rilegge lo stato; a fine corsa si ricarica l'elenco.
  useEffect(() => {
    if (!stato?.in_corso) return;
    const t = setInterval(async () => {
      const s = await leggiStato();
      if (s && !s.in_corso) { clearInterval(t); load(); }
    }, 3000);
    return () => clearInterval(t);
  }, [stato?.in_corso, leggiStato, load]);

  async function sincronizza(periodo?: { da?: string; a?: string }) {
    try {
      const r = await api.post<{ avviata: boolean }>('/api/fatturazione/sincronizza', periodo ?? {});
      if (r.avviata) toast.info('Sincronizzazione avviata'); else toast.info('Sincronizzazione già in corso');
      await leggiStato();
    } catch (e) { toast.error(errMsg(e)); }
  }

  const clienti = useMemo(() => [...new Set(rows.map(r => r.customer_account))].sort(), [rows]);
  const visibili = useMemo(() => rows.filter(r =>
    (!cliente || r.customer_account === cliente) &&
    (stato_ === '' || (stato_ === 'senza' ? r.senza_regola > 0 : r.senza_regola === 0))), [rows, cliente, stato_]);
  const totaleVisibili = Math.round(visibili.reduce((a, r) => a + r.totale_str, 0) * 100) / 100;

  const badge = !stato ? undefined
    : stato.in_corso ? <StatusBadge tone="info">Sincronizzazione in corso</StatusBadge>
    : stato.errore ? <StatusBadge tone="danger">Errore sincronizzazione</StatusBadge>
    : undefined;

  return (
    <div>
      <PageHeader
        title="Fatturazione"
        badge={badge}
        description={
          <>
            <span>{stato?.ultima_sync ? `Ultima sincronizzazione: ${dataOra(stato.ultima_sync)}` : 'Mai sincronizzato'}</span>
            {stato?.errore && <span className="ml-1 text-danger">{stato.errore}</span>}
          </>
        }
        actions={manage && (
          <>
            <Button href="/fatturazione/impostazioni" className="group-gear"><IconSettings className="gear h-4 w-4" />Impostazioni</Button>
            <Button variant="primary" disabled={stato?.in_corso} onClick={() => sincronizza()}>{stato?.in_corso ? 'Sincronizzazione…' : 'Sincronizza ora'}</Button>
          </>
        )}
      />

      {error && <div className="mb-4 rounded-ctl bg-danger-soft p-3 text-sm text-danger">{error}</div>}

      <div className="card !p-0 overflow-hidden">
        <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
          <div><label className="label">Da</label><input type="date" className="input" value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div><label className="label">A</label><input type="date" className="input" value={to} onChange={e => setTo(e.target.value)} /></div>
          <div><label className="label">Codice articolo</label><input className="input" placeholder="Cerca…" value={articolo} onChange={e => setArticolo(e.target.value)} /></div>
          <div><label className="label">Descrizione</label><input className="input" placeholder="Cerca…" value={testo} onChange={e => setTesto(e.target.value)} /></div>
          <div><label className="label">Cliente</label>
            <select className="input" value={cliente} onChange={e => setCliente(e.target.value)}>
              <option value="">Tutti</option>{clienti.map(c => <option key={c} value={c}>{c}</option>)}
            </select></div>
          <div><label className="label">Stato</label>
            <select className="input" value={stato_} onChange={e => setStato_(e.target.value as '' | 'senza' | 'ok')}>
              <option value="">Tutti</option><option value="senza">Con righe senza regola</option><option value="ok">Tutte le righe con regola</option>
            </select></div>
          <div><label className="label">N. spedizione</label><input className="input" placeholder="Cerca…" value={search} onChange={e => setSearch(e.target.value)} /></div>
          {manage && (
            <Button disabled={stato?.in_corso || (!from && !to)} onClick={() => sincronizza({ da: from || undefined, a: to || undefined })}
              title="Rilegge da Business Central le spedizioni del periodo Da/A. I prezzi seguono sempre le regole attuali.">
              Rileggi da BC questo periodo
            </Button>
          )}
        </div>

        {loading ? (
          <div className="p-4"><SkeletonTable rows={6} cols={5} /></div>
        ) : visibili.length === 0 ? (
          <EmptyState title="Nessuna spedizione" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="sheet-th">Spedizione</th><th className="sheet-th">Data</th><th className="sheet-th">Cliente</th>
                  <th className="sheet-th text-right">Righe</th><th className="sheet-th">Stato</th><th className="sheet-th text-right">Totale STR stimato</th>
                </tr>
              </thead>
              <tbody>
                {visibili.map(r => (
                  <Fragment key={r.shipment_id}>
                    <tr className="cursor-pointer hover:bg-stone-50" onClick={() => router.push(`/fatturazione/${encodeURIComponent(r.shipment_id)}`)}>
                      <td className="sheet-td font-medium text-ink-900"><Link href={`/fatturazione/${encodeURIComponent(r.shipment_id)}`} onClick={e => e.stopPropagation()} className="hover:underline">{r.shipment_id}</Link></td>
                      <td className="sheet-td">{r.shipment_date}</td>
                      <td className="sheet-td">{r.customer_account}</td>
                      <td className="sheet-td text-right">{r.line_count}</td>
                      <td className="sheet-td">{r.senza_regola > 0 && <StatusBadge tone="warning">{r.senza_regola} senza regola</StatusBadge>}</td>
                      <td className="sheet-td text-right font-semibold text-ink-900">{eur(r.totale_str)}</td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line font-semibold text-ink-900">
                  <td className="sheet-td" colSpan={3}>{visibili.length} spedizioni</td>
                  <td className="sheet-td text-right" colSpan={3}>Totale STR stimato: {eur(totaleVisibili)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
