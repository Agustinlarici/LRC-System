'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { fmtDatetime } from '@/lib/utils';
import { useToast } from '@/components/ui/Toast';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { useAuth } from '@/lib/auth';
import { useConfirmDialog } from '@/components/ui/PromptDialog';

interface Shipment {
  id:              number;
  status:          'open' | 'closed';
  note:            string | null;
  created_by_name: string;
  created_at:      string;
  closed_at:       string | null;
  closed_by_name:  string | null;
  items:           number;
  modified_at:     string | null;
  modified_by_name: string | null;
}

export default function SpedizioneBucciPage() {
  const router    = useRouter();
  const toast     = useToast();
  const { canManage } = useAuth();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const manage    = canManage('spedizione_bucci');
  const [rows,     setRows]     = useState<Shipment[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await api.get<Shipment[]>('/api/bucci/shipments'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Errore nel caricamento');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { document.title = 'Spedizione Bucci — STR'; load(); }, [load]);

  async function createShipment() {
    if (creating) return;
    setCreating(true);
    try {
      const { id } = await api.post<{ id: number }>('/api/bucci/shipments', {});
      router.push(`/spedizione-bucci/${id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Errore nella creazione');
      setCreating(false);
    }
  }

  async function editShipment(s: Shipment) {
    try {
      if (s.status === 'closed') await api.post(`/api/bucci/shipments/${s.id}/reopen`);
      router.push(`/spedizione-bucci/${s.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Errore nella riapertura');
    }
  }

  async function deleteShipment(s: Shipment) {
    const ok = await confirm({
      title:        'Eliminare la spedizione?',
      message:      `La spedizione #${s.id} con ${s.items} cofani verrà eliminata definitivamente.`,
      confirmLabel: 'Elimina',
    });
    if (!ok) return;
    try {
      await api.delete(`/api/bucci/shipments/${s.id}`);
      toast.success(`Spedizione #${s.id} eliminata`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Errore nella eliminazione');
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Spedizione Bucci</h1>
        <p className="mt-1 text-gray-500">Scansione cofani Bucci e storico spedizioni</p>
      </div>

      <button
        onClick={createShipment}
        disabled={creating}
        className="btn-primary inline-flex items-center gap-2 mb-6"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-4 h-4" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
        </svg>
        {creating ? 'Creazione in corso…' : 'Nuova spedizione'}
      </button>

      {loading ? (
        <SkeletonTable rows={6} cols={6} />
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
                <th className="py-3 px-4 text-left font-medium">#</th>
                <th className="py-3 px-4 text-left font-medium">Stato</th>
                <th className="py-3 px-4 text-left font-medium">Creata da</th>
                <th className="py-3 px-4 text-left font-medium">Data</th>
                <th className="py-3 px-4 text-center font-medium">Cofani</th>
                <th className="py-3 px-4 text-center font-medium">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={6} className="py-10 text-center text-gray-400">Nessuna spedizione</td></tr>
              ) : rows.map(s => (
                <tr key={s.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-3 px-4 font-medium">{s.id}</td>
                  <td className="py-3 px-4">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      s.status === 'open' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                    }`}>
                      {s.status === 'open' ? 'Aperta' : 'Chiusa'}
                    </span>
                    {s.modified_at && (
                      <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700"
                            title={s.modified_by_name ? `Modificata da ${s.modified_by_name}` : undefined}>
                        Modificata il {fmtDatetime(s.modified_at)}
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-gray-500">{s.created_by_name}</td>
                  <td className="py-3 px-4 text-gray-500">{fmtDatetime(s.created_at)}</td>
                  <td className="py-3 px-4 text-center">{s.items}</td>
                  <td className="py-3 px-4">
                    <div className="flex justify-center gap-2">
                      <Link href={`/spedizione-bucci/${s.id}`} className="btn-secondary text-xs px-3 py-1">
                        {s.status === 'open' ? 'Scansiona' : 'Apri'}
                      </Link>
                      {manage && (
                        <>
                          <button onClick={() => editShipment(s)} className="btn-secondary text-xs px-3 py-1">Modifica</button>
                          <button onClick={() => deleteShipment(s)} className="text-xs px-3 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50">Elimina</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirmDialog}
    </div>
  );
}
