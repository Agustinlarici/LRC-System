'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { IconSettings } from '@/components/icons/ModuleIcons';

interface Stato { ultima_sync: string | null; in_corso: boolean; errore: string | null }
interface Despacho { shipment_id: string; shipment_date: string; customer_account: string; line_count: number; totale_str: number; senza_regola: number }
interface Riga {
  line_no: number; article_code: string; quantity: number; order_no: string; descrizione: string;
  prezzo_str: number; totale_riga: number; regole: { id: number; nome: string; prezzo: number }[];
}
interface Dettaglio { shipment_id: string; righe: Riga[]; totale_str: number }

const SENZA_NOME = '(senza nome)';
const nomeRegola = (n: string) => n.trim() || SENZA_NOME;
/** Colonne del dettaglio: i nomi delle regole applicate nelle righe del despacho, nell'ordine in cui compaiono. */
const colonneDi = (righe: Riga[]): string[] => {
  const out: string[] = [];
  for (const l of righe) for (const g of l.regole) { const n = nomeRegola(g.nome); if (!out.includes(n)) out.push(n); }
  return out;
};
/** Valore unitario di una colonna per una riga (più regole con lo stesso nome si sommano); null = non applicata. */
const valoreDi = (l: Riga, col: string): number | null => {
  const v = l.regole.filter(g => nomeRegola(g.nome) === col);
  return v.length === 0 ? null : Math.round(v.reduce((a, g) => a + g.prezzo, 0) * 100) / 100;
};

const eur = (n: number) => n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
const dataOra = (iso: string) => new Date(iso).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function FatturazionePage() {
  const { canManage } = useAuth();
  const toast = useToast();
  const manage = canManage('fatturazione');
  const [stato, setStato] = useState<Stato | null>(null);
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
    catch (e) { setError(errMsg(e)); }
    finally { setLoading(false); }
  }, [from, to, search]);
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

  async function sincronizza() {
    try {
      const r = await api.post<{ avviata: boolean }>('/api/fatturazione/sincronizza');
      if (r.avviata) toast.info('Sincronizzazione avviata'); else toast.info('Sincronizzazione già in corso');
      await leggiStato();
    } catch (e) { toast.error(errMsg(e)); }
  }

  async function toggle(id: string) {
    if (open === id) { setOpen(null); return; }
    setOpen(id); setDet(null);
    try { setDet(await api.get<Dettaglio>(`/api/fatturazione/despachi/${encodeURIComponent(id)}`, 60000)); }
    catch (e) { setError(errMsg(e)); }
  }

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
            <Button variant="primary" disabled={stato?.in_corso} onClick={sincronizza}>{stato?.in_corso ? 'Sincronizzazione…' : 'Sincronizza ora'}</Button>
          </>
        )}
      />

      {error && <div className="mb-4 rounded-ctl bg-danger-soft p-3 text-sm text-danger">{error}</div>}

      <div className="card !p-0 overflow-hidden">
        <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
          <div><label className="label">Da</label><input type="date" className="input" value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div><label className="label">A</label><input type="date" className="input" value={to} onChange={e => setTo(e.target.value)} /></div>
          <div><label className="label">N. despacho</label><input className="input" placeholder="Cerca…" value={search} onChange={e => setSearch(e.target.value)} /></div>
        </div>

        {loading ? (
          <div className="p-4"><SkeletonTable rows={6} cols={5} /></div>
        ) : rows.length === 0 ? (
          <EmptyState title="Nessun despacho" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="sheet-th">Despacho</th><th className="sheet-th">Data</th><th className="sheet-th">Cliente</th>
                  <th className="sheet-th text-right">Righe</th><th className="sheet-th">Stato</th><th className="sheet-th text-right">Totale STR stimato</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <Fragment key={r.shipment_id}>
                    <tr className="cursor-pointer hover:bg-stone-50" onClick={() => toggle(r.shipment_id)}>
                      <td className="sheet-td font-medium text-ink-900">{r.shipment_id}</td>
                      <td className="sheet-td">{r.shipment_date}</td>
                      <td className="sheet-td">{r.customer_account}</td>
                      <td className="sheet-td text-right">{r.line_count}</td>
                      <td className="sheet-td">{r.senza_regola > 0 && <StatusBadge tone="warning">{r.senza_regola} senza regola</StatusBadge>}</td>
                      <td className="sheet-td text-right font-semibold text-ink-900">{eur(r.totale_str)}</td>
                    </tr>
                    {open === r.shipment_id && (
                      <tr>
                        <td colSpan={6} className="overflow-x-auto border-b border-stone-100 bg-stone-50 px-4 py-3">
                          {!det ? <div className="skeleton h-16 w-full" /> : (() => {
                            const cols = colonneDi(det.righe);
                            const somma = (c: string) => Math.round(det.righe.reduce((a, l) => a + (valoreDi(l, c) ?? 0) * l.quantity, 0) * 100) / 100;
                            return (
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-left text-muted">
                                    <th className="py-1 pr-3 font-medium">Spedizione</th><th className="pr-3 font-medium">Codice</th>
                                    <th className="pr-3 font-medium">Descrizione ordine</th><th className="pr-3 text-right font-medium">Q.tà</th>
                                    {cols.map(c => <th key={c} className="pr-3 text-right font-medium text-ink-900">{c}</th>)}
                                    <th className="pr-3 text-right font-medium">Unitario</th><th className="text-right font-medium">Totale</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {det.righe.map(l => (
                                    <tr key={l.line_no} className="border-t border-line align-top">
                                      <td className="py-1.5 pr-3 font-mono text-muted">{det.shipment_id}</td>
                                      <td className="pr-3 font-mono">{l.article_code}</td>
                                      <td className="pr-3">{l.descrizione || <span className="text-muted">vuota</span>}</td>
                                      <td className="pr-3 text-right">{l.quantity}</td>
                                      {l.regole.length === 0
                                        ? <td colSpan={Math.max(cols.length, 1)} className="pr-3 text-right"><StatusBadge tone="warning">Nessuna regola</StatusBadge></td>
                                        : cols.map(c => { const v = valoreDi(l, c); return <td key={c} className="pr-3 text-right">{v == null ? <span className="text-stone-300">–</span> : eur(v)}</td>; })}
                                      <td className="pr-3 text-right">{eur(l.prezzo_str)}</td>
                                      <td className="text-right font-semibold">{eur(l.totale_riga)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                                <tfoot>
                                  <tr className="border-t-2 border-line font-semibold text-ink-900">
                                    <td className="py-1.5 pr-3" colSpan={4}>Totale (valore × quantità)</td>
                                    {cols.map(c => <td key={c} className="pr-3 text-right">{eur(somma(c))}</td>)}
                                    <td className="pr-3" />
                                    <td className="text-right">{eur(det.totale_str)}</td>
                                  </tr>
                                </tfoot>
                              </table>
                            );
                          })()}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
