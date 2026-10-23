'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
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
  seriale:         string | null;   // null = non ancora verificato in iKnow
  componente:      string | null;
  modello:         string | null;
  commessa:        string | null;
  tipo_lotto_primer: string | null;
  conto_garanzia:  boolean;
}

interface Shipment {
  id:              number;
  status:          'open' | 'closed';
  created_by_name: string;
  created_at:      string;
  closed_at:       string | null;
  closed_by_name:  string | null;
  modified_at:     string | null;
  modified_by_name: string | null;
  items:           Item[];
  lookback_days:   number;
}

interface Candidate { seriale: string; componente: string | null; commessa: string | null }

type Problem =
  | { item_id: number; scanned_code: string; kind: 'not_found' }
  | { item_id: number; scanned_code: string; kind: 'duplicate'; seriale: string }
  | { item_id: number; scanned_code: string; kind: 'ambiguous'; candidates: Candidate[] };

interface Warning { item_id: number; kind: 'no_primer' | 'in_other_shipment'; shipment_id?: number }

interface VerifyResponse {
  items:              Item[];
  problems:           Problem[];
  warnings:           Warning[];
  iknow_error:        boolean;
  primer_unavailable: boolean;
  unresolved:         number;
}

// Ogni quanti cofani non ancora verificati parte la verifica in background
const VERIFY_BATCH = 5;
// La verifica fa query in blocco su iKnow (fino a 30 s ciascuna, due in sequenza al massimo): più larga del timeout standard
const VERIFY_TIMEOUT_MS = 90_000;

function problemText(p: Problem): string {
  if (p.kind === 'not_found') return 'Non trovato in iKnow';
  if (p.kind === 'duplicate') return `Doppio: ${p.seriale} è già nella spedizione`;
  return 'La commessa ha più seriali: scegli quello giusto';
}

function warningText(w: Warning): string {
  return w.kind === 'no_primer' ? 'Tipo Lotto Primer non trovato' : `Già in spedizione #${w.shipment_id}`;
}

export default function SpedizioneBucciDetailPage() {
  const { id }  = useParams<{ id: string }>();
  const router  = useRouter();
  const toast   = useToast();
  const { canManage } = useAuth();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const [shipment,   setShipment]   = useState<Shipment | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [code,       setCode]       = useState('');
  const [busy,       setBusy]       = useState(false);
  const [lastError,  setLastError]  = useState('');
  const [problems,   setProblems]   = useState<Problem[]>([]);
  const [warnings,   setWarnings]   = useState<Warning[]>([]);
  const [review,     setReview]     = useState<VerifyResponse | null>(null);
  const [verifying,  setVerifying]  = useState(false);
  const inputRef  = useRef<HTMLInputElement>(null);
  const itemsRef  = useRef<Item[]>([]);
  const verifyRef = useRef(false);

  const isOpen = shipment?.status === 'open';
  itemsRef.current = shipment?.items ?? [];

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
  useEffect(() => { if (isOpen && !review) inputRef.current?.focus(); }, [isOpen, review, busy, verifying]);

  // Aggiorna le righe con i dati risolti dal server senza perdere i cofani scansionati nel frattempo
  function applyVerify(res: VerifyResponse) {
    const byId = new Map(res.items.map(i => [i.id, i]));
    setShipment(prev => prev ? { ...prev, items: prev.items.map(i => byId.get(i.id) ?? i) } : prev);
    setProblems(res.problems);
    setWarnings(res.warnings);
  }

  // Una verifica alla volta; silent = in background durante la scansione (errori ignorati, si riprova alla prossima)
  async function runVerify(silent: boolean): Promise<VerifyResponse | null> {
    if (verifyRef.current) return null;
    verifyRef.current = true;
    setVerifying(true);
    try {
      const res = await api.post<VerifyResponse>(`/api/bucci/shipments/${id}/verify`, undefined, VERIFY_TIMEOUT_MS);
      applyVerify(res);
      return res;
    } catch (e) {
      if (!silent) setLastError(e instanceof Error && e.name !== 'TimeoutError' ? e.message : 'iKnow lento o non raggiungibile, riprova');
      return null;
    } finally {
      verifyRef.current = false;
      setVerifying(false);
    }
  }

  async function submitScan(scanned: string) {
    setBusy(true);
    setLastError('');
    try {
      const res = await api.post<{ status: 'added'; item: Item }>(`/api/bucci/shipments/${id}/scan`, { code: scanned });
      const items = [...itemsRef.current, res.item];
      setShipment(prev => prev ? { ...prev, items } : prev);
      const flagged = new Set(problems.map(p => p.item_id));
      const toVerify = items.filter(i => !i.seriale && !flagged.has(i.id)).length;
      if (toVerify >= VERIFY_BATCH) void runVerify(true);
    } catch (e) {
      setLastError(e instanceof Error && e.name !== 'TimeoutError' ? e.message : 'Tempo scaduto: ricarica la pagina e controlla la lista prima di riprovare');
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
      setProblems(prev => prev.filter(p => p.item_id !== item.id));
      setWarnings(prev => prev.filter(w => w.item_id !== item.id));
      setReview(prev => {
        if (!prev) return prev;
        const items = prev.items.filter(i => i.id !== item.id);
        return {
          ...prev,
          items,
          problems:   prev.problems.filter(p => p.item_id !== item.id),
          warnings:   prev.warnings.filter(w => w.item_id !== item.id),
          unresolved: items.filter(i => !i.seriale).length,
        };
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Errore nella rimozione');
    }
  }

  async function pickSeriale(itemId: number, seriale: string) {
    try {
      await api.post(`/api/bucci/shipments/${id}/items/${itemId}/resolve`, { seriale });
      await reverify();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Errore');
    }
  }

  async function toggleGaranzia(item: Item, value: boolean) {
    const patch = (v: boolean) => setShipment(prev => prev
      ? { ...prev, items: prev.items.map(i => i.id === item.id ? { ...i, conto_garanzia: v } : i) } : prev);
    patch(value);
    try {
      await api.patch(`/api/bucci/shipments/${id}/items/${item.id}`, { conto_garanzia: value });
    } catch (e) {
      patch(!value);
      toast.error(e instanceof Error ? e.message : 'Errore nel salvataggio');
    }
  }

  // Chiudi: prima verifica tutto, poi mostra l'esito e chiede conferma
  async function startClose() {
    setLastError('');
    const res = await runVerify(false);
    if (res) setReview(res);
  }

  async function reverify() {
    const res = await runVerify(false);
    if (res) setReview(res);
  }

  async function confirmClose() {
    try {
      await api.post(`/api/bucci/shipments/${id}/close`);
      toast.success(`Spedizione chiusa: ${review?.items.length ?? 0} cofani verificati`);
      setReview(null);
      setProblems([]);
      setWarnings([]);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Errore');
    }
  }

  async function reopen() {
    try {
      await api.post(`/api/bucci/shipments/${id}/reopen`);
      toast.success('Spedizione riaperta');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Errore');
    }
  }

  async function deleteShipment() {
    const ok = await confirm({
      title:        'Eliminare la spedizione?',
      message:      `La spedizione #${id} con ${shipment?.items.length ?? 0} cofani verrà eliminata definitivamente.`,
      confirmLabel: 'Elimina',
    });
    if (!ok) return;
    try {
      await api.delete(`/api/bucci/shipments/${id}`);
      toast.success('Spedizione eliminata');
      router.push('/spedizione-bucci');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Errore nella eliminazione');
    }
  }

  if (loading) return <PageLoader />;
  if (!shipment) return <p className="text-gray-500">Spedizione non trovata.</p>;

  const problemOf = (itemId: number) => problems.find(p => p.item_id === itemId);
  const warningsOf = (itemId: number) => warnings.filter(w => w.item_id === itemId);
  const reviewBlocked = !!review && (review.problems.length > 0 || review.unresolved > 0 || review.iknow_error);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/spedizione-bucci" className="btn-secondary print:hidden inline-flex items-center gap-2 text-sm">
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
          {shipment.modified_at && (
            <span className="inline-block mt-2 text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
              Modificata il {fmtDatetime(shipment.modified_at)}{shipment.modified_by_name ? ` · ${shipment.modified_by_name}` : ''}
            </span>
          )}
        </div>
        <div className="flex gap-2 print:hidden">
          <button className="btn-secondary" onClick={() => window.print()}>Stampa</button>
          {isOpen && (
            <button className="btn-primary disabled:opacity-60" onClick={startClose} disabled={verifying}>
              {verifying ? 'Verifica in corso…' : 'Chiudi spedizione'}
            </button>
          )}
          {!isOpen && canManage('spedizione_bucci') && (
            <button className="btn-secondary" onClick={reopen}>Riapri</button>
          )}
          {canManage('spedizione_bucci') && (
            <button className="px-3 py-2 text-sm rounded-lg border border-red-200 text-red-600 hover:bg-red-50" onClick={deleteShipment}>Elimina</button>
          )}
        </div>
      </div>

      {isOpen && (
        <form onSubmit={onSubmit} className="card mb-4 print:hidden">
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
          <p className="mt-2 text-xs text-gray-400">
            Seriali, modello e lotto si leggono da iKnow (ultimi {shipment.lookback_days} giorni) ogni {VERIFY_BATCH} scansioni e alla chiusura.
          </p>
        </form>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto print:overflow-visible print:border-0 print:shadow-none">
        <table className="w-full text-sm print:text-xs [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap print:[&_th]:px-2 print:[&_td]:px-2">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
              <th className="py-3 px-4 text-left font-medium">#</th>
              <th className="py-3 px-4 text-left font-medium">Seriale</th>
              <th className="py-3 px-4 text-left font-medium">Componente</th>
              <th className="py-3 px-4 text-left font-medium">Modello</th>
              <th className="py-3 px-4 text-left font-medium">Commessa</th>
              <th className="py-3 px-4 text-left font-medium">Tipo Lotto Primer</th>
              <th className="py-3 px-4 text-center font-medium">Conto Garanzia</th>
              {isOpen && <th className="py-3 px-4 text-center font-medium print:hidden"></th>}
            </tr>
          </thead>
          <tbody>
            {shipment.items.length === 0 ? (
              <tr><td colSpan={8} className="py-10 text-center text-gray-400">Nessun cofano scansionato</td></tr>
            ) : shipment.items.map((it, i) => {
              const problem = problemOf(it.id);
              return (
              <tr key={it.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2.5 px-4 text-gray-400">{i + 1}</td>
                <td className="py-2.5 px-4 font-mono">
                  {it.seriale ?? (
                    <span className="text-gray-400">{it.scanned_code}</span>
                  )}
                  {!it.seriale && (
                    <span className={`ml-2 font-sans text-xs font-medium px-2 py-0.5 rounded-full ${
                      problem ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                      {problem ? problemText(problem) : 'da verificare'}
                    </span>
                  )}
                  {warningsOf(it.id).map(w => (
                    <span key={w.kind} className="ml-2 font-sans text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                      {warningText(w)}
                    </span>
                  ))}
                </td>
                <td className="py-2.5 px-4 text-gray-500">{it.componente || '–'}</td>
                <td className="py-2.5 px-4 text-gray-500">{it.modello || '–'}</td>
                <td className="py-2.5 px-4 text-gray-500">{it.commessa || '–'}</td>
                <td className="py-2.5 px-4 text-gray-500">{it.tipo_lotto_primer || '–'}</td>
                <td className="py-2.5 px-4 text-center">
                  {isOpen ? (
                    <>
                    <span className="hidden print:inline text-xs font-medium">{it.conto_garanzia ? 'Sì' : 'No'}</span>
                    <input
                      type="checkbox"
                      className="print:hidden w-4 h-4 accent-blue-600 cursor-pointer"
                      checked={it.conto_garanzia}
                      onChange={e => toggleGaranzia(it, e.target.checked)}
                      aria-label={`Conto Garanzia ${it.seriale ?? it.scanned_code}`}
                    />
                    </>
                  ) : (
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      it.conto_garanzia ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {it.conto_garanzia ? 'Sì' : 'No'}
                    </span>
                  )}
                </td>
                {isOpen && (
                  <td className="py-2.5 px-4 text-center print:hidden">
                    <button onClick={() => removeItem(it)} className="text-red-500 hover:text-red-700" aria-label={`Rimuovi ${it.seriale ?? it.scanned_code}`}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-4 h-4" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
                  </td>
                )}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {confirmDialog}

      {review && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900 text-lg">
                {reviewBlocked ? 'Controlla prima di chiudere' : 'Tutto verificato'}
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                {reviewBlocked
                  ? 'Risolvi i punti qui sotto: la spedizione non si può chiudere finché restano.'
                  : `${review.items.length} cofani verificati in iKnow. Chiudere la spedizione?`}
              </p>
            </div>

            <div className="px-6 py-4 overflow-y-auto space-y-3">
              {review.iknow_error && (
                <p role="alert" className="text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  iKnow non ha risposto: i cofani sono salvati ma non verificati. Riprova.
                </p>
              )}
              {review.primer_unavailable && (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Tipo Lotto Primer non letto (iKnow lento): puoi chiudere comunque o riprovare.
                </p>
              )}

              {review.problems.map(p => (
                <div key={p.item_id} className="border border-red-200 bg-red-50 rounded-lg px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <span className="font-mono font-medium">{p.scanned_code}</span>
                      <span className="text-sm text-red-700 ml-2">{problemText(p)}</span>
                    </div>
                    <button
                      className="text-sm text-red-600 hover:text-red-800 underline"
                      onClick={() => {
                        const item = review.items.find(i => i.id === p.item_id);
                        if (item) removeItem(item);
                      }}
                    >Rimuovi</button>
                  </div>
                  {p.kind === 'ambiguous' && (
                    <ul className="mt-2 space-y-1">
                      {p.candidates.map(c => (
                        <li key={c.seriale}>
                          <button
                            className="w-full text-left border border-gray-200 bg-white rounded-lg px-3 py-1.5 hover:bg-blue-50 hover:border-blue-300 transition-colors"
                            onClick={() => pickSeriale(p.item_id, c.seriale)}
                          >
                            <span className="font-mono font-medium">{c.seriale}</span>
                            <span className="text-xs text-gray-500 ml-2">{c.componente} · commessa {c.commessa}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}

              {review.warnings.length > 0 && (
                <div className="border border-amber-200 bg-amber-50 rounded-lg px-3 py-2">
                  <p className="text-sm font-medium text-amber-800 mb-1">Avvisi (non bloccano la chiusura)</p>
                  <ul className="text-sm text-amber-800 space-y-0.5">
                    {review.warnings.map(w => {
                      const item = review.items.find(i => i.id === w.item_id);
                      return (
                        <li key={`${w.item_id}-${w.kind}`}>
                          <span className="font-mono">{item?.seriale ?? item?.scanned_code}</span> · {warningText(w)}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setReview(null)}>Torna alla lista</button>
              {reviewBlocked ? (
                <button className="btn-primary disabled:opacity-60" onClick={reverify} disabled={verifying}>
                  {verifying ? 'Verifica in corso…' : 'Verifica di nuovo'}
                </button>
              ) : (
                <button className="btn-primary" onClick={confirmClose}>Conferma e chiudi</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
