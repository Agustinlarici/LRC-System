'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDatetime } from '@/lib/utils';
import { useToast } from '@/components/ui/Toast';
import { PageLoader } from '@/components/ui/Skeleton';
import { useConfirmDialog } from '@/components/ui/PromptDialog';

interface Item {
  id:              number;
  scanned_code:    string;
  seriale:         string;
  componente:      string | null;
  commessa:        string | null;
  tipo_lotto_primer: string | null;
  scanned_by_name: string;
  scanned_at:      string;
}

interface Shipment {
  id:              number;
  status:          'open' | 'closed';
  created_by_name: string;
  created_at:      string;
  closed_at:       string | null;
  closed_by_name:  string | null;
  items:           Item[];
  lookback_days:   number;
}

interface Candidate { seriale: string; componente: string | null; commessa: string | null }

type ScanResponse =
  | { status: 'added';     item: Item; also_in_shipment: number | null; warning: string | null }
  | { status: 'ambiguous'; candidates: Candidate[] };

export default function SpedizioneBucciDetailPage() {
  const { id }  = useParams<{ id: string }>();
  const toast   = useToast();
  const { canManage } = useAuth();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const [shipment,   setShipment]   = useState<Shipment | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [code,       setCode]       = useState('');
  const [busy,       setBusy]       = useState(false);
  const [pending,    setPending]    = useState<{ code: string; candidates: Candidate[] } | null>(null);
  const [lastError,  setLastError]  = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const isOpen = shipment?.status === 'open';

  const load = useCallback(async () => {
    try {
      setShipment(await api.get<Shipment>(`/api/bucci/shipments/${id}`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Errore nel caricamento');
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => { document.title = `Spedizione Bucci #${id} — STR`; load(); }, [id, load]);
  useEffect(() => { if (isOpen && !pending) inputRef.current?.focus(); }, [isOpen, pending, busy]);

  async function submitScan(scanned: string, seriale?: string) {
    setBusy(true);
    setLastError('');
    try {
      const res = await api.post<ScanResponse>(`/api/bucci/shipments/${id}/scan`, { code: scanned, seriale });
      if (res.status === 'ambiguous') {
        setPending({ code: scanned, candidates: res.candidates });
        return;
      }
      setPending(null);
      setShipment(prev => prev ? { ...prev, items: [...prev.items, res.item] } : prev);
      if (res.warning) toast.info(res.warning);
      if (res.also_in_shipment) {
        toast.info(`${res.item.seriale} era già nella spedizione #${res.also_in_shipment}`);
      }
    } catch (e) {
      setLastError(e instanceof Error ? e.message : 'Errore');
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = code.trim();
    if (!v || busy) return;
    setCode('');
    submitScan(v);
  }

  async function removeItem(item: Item) {
    try {
      await api.delete(`/api/bucci/shipments/${id}/items/${item.id}`);
      setShipment(prev => prev ? { ...prev, items: prev.items.filter(i => i.id !== item.id) } : prev);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Errore nella rimozione');
    }
  }

  async function changeStatus(action: 'close' | 'reopen') {
    if (action === 'close') {
      const ok = await confirm({
        title:        'Chiudere la spedizione?',
        message:      `La spedizione #${id} contiene ${shipment?.items.length ?? 0} cofani. Dopo la chiusura non sarà più modificabile.`,
        confirmLabel: 'Chiudi spedizione',
      });
      if (!ok) return;
    }
    try {
      await api.post(`/api/bucci/shipments/${id}/${action}`);
      toast.success(action === 'close' ? 'Spedizione chiusa' : 'Spedizione riaperta');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Errore');
    }
  }

  if (loading) return <PageLoader />;
  if (!shipment) return <p className="text-gray-500">Spedizione non trovata.</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/spedizione-bucci" className="btn-secondary inline-flex items-center gap-2 text-sm">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Spedizioni
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 mt-3">Spedizione Bucci #{shipment.id}</h1>
          <p className="mt-1 text-gray-500">
            {isOpen
              ? `Aperta da ${shipment.created_by_name} · ${fmtDatetime(shipment.created_at)}`
              : `Chiusa da ${shipment.closed_by_name ?? '–'} · ${shipment.closed_at ? fmtDatetime(shipment.closed_at) : ''}`}
          </p>
        </div>
        <div className="flex gap-2">
          {isOpen && <button className="btn-primary" onClick={() => changeStatus('close')}>Chiudi spedizione</button>}
          {!isOpen && canManage('spedizione_bucci') && (
            <button className="btn-secondary" onClick={() => changeStatus('reopen')}>Riapri</button>
          )}
        </div>
      </div>

      {isOpen && (
        <form onSubmit={onSubmit} className="card mb-4">
          <label className="label" htmlFor="bucci-code">Scansiona seriale o commessa (BUCC…)</label>
          <div className="flex items-center gap-4">
            <input
              id="bucci-code"
              ref={inputRef}
              className="input text-lg"
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="In attesa della scansione…"
              autoComplete="off"
              disabled={busy}
            />
            <span className="text-sm font-semibold text-blue-600 whitespace-nowrap">
              {shipment.items.length} cofani
            </span>
          </div>
          {lastError && (
            <p role="alert" className="mt-3 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {lastError}
            </p>
          )}
          <p className="mt-2 text-xs text-gray-400">Ricerca in iKnow negli ultimi {shipment.lookback_days} giorni.</p>
        </form>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
              <th className="py-3 px-4 text-left font-medium">#</th>
              <th className="py-3 px-4 text-left font-medium">Seriale</th>
              <th className="py-3 px-4 text-left font-medium">Componente</th>
              <th className="py-3 px-4 text-left font-medium">Commessa</th>
              <th className="py-3 px-4 text-left font-medium">Tipo Lotto Primer</th>
              <th className="py-3 px-4 text-left font-medium">Scansionato</th>
              {isOpen && <th className="py-3 px-4 text-center font-medium"></th>}
            </tr>
          </thead>
          <tbody>
            {shipment.items.length === 0 ? (
              <tr><td colSpan={7} className="py-10 text-center text-gray-400">Nessun cofano scansionato</td></tr>
            ) : shipment.items.map((it, i) => (
              <tr key={it.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2.5 px-4 text-gray-400">{i + 1}</td>
                <td className="py-2.5 px-4 font-mono">{it.seriale}</td>
                <td className="py-2.5 px-4 text-gray-500">{it.componente || '–'}</td>
                <td className="py-2.5 px-4 text-gray-500">{it.commessa || '–'}</td>
                <td className="py-2.5 px-4 text-gray-500">{it.tipo_lotto_primer || '–'}</td>
                <td className="py-2.5 px-4 text-gray-500">{fmtDatetime(it.scanned_at)} · {it.scanned_by_name}</td>
                {isOpen && (
                  <td className="py-2.5 px-4 text-center">
                    <button onClick={() => removeItem(it)} className="text-red-500 hover:text-red-700" aria-label={`Rimuovi ${it.seriale}`}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-4 h-4" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {confirmDialog}

      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900 text-lg">Seleziona il seriale</h3>
              <p className="text-sm text-gray-500 mt-1">
                La commessa {pending.candidates[0]?.commessa ?? pending.code} ha più seriali associati.
              </p>
            </div>
            <ul className="px-6 py-4 max-h-80 overflow-y-auto space-y-2">
              {pending.candidates.map(c => (
                <li key={c.seriale}>
                  <button
                    className="w-full text-left border border-gray-200 rounded-lg px-3 py-2 hover:bg-blue-50 hover:border-blue-300 transition-colors disabled:opacity-50"
                    disabled={busy}
                    onClick={() => submitScan(pending.code, c.seriale)}
                  >
                    <span className="font-mono font-medium">{c.seriale}</span>
                    <span className="text-xs text-gray-500 ml-2">{c.componente} · commessa {c.commessa}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end">
              <button className="btn-secondary" onClick={() => setPending(null)}>Annulla</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
