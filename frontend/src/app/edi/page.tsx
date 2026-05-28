'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import type { EdiClient, EdiShipment, EdiHistoryEntry, EdiLine } from '@/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(s: string | null | undefined) {
  if (!s) return '—';
  const d = new Date(s);
  return d.toLocaleDateString('it-IT');
}

function fmtDateTime(s: string) {
  const d = new Date(s);
  return d.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
}

// ─── Badge helpers ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    sent:    'bg-green-100 text-green-700',
    error:   'bg-red-100 text-red-700',
    pending: 'bg-gray-100 text-gray-500',
  };
  const labels: Record<string, string> = {
    sent: 'Inviato', error: 'Errore', pending: 'Pendente',
  };
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${map[status] ?? map.pending}`}>
      {labels[status] ?? status}
    </span>
  );
}

// ─── Tab bar ─────────────────────────────────────────────────────────────────

type Tab = 'clients' | 'shipments' | 'history';

function Tabs({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs: { key: Tab; label: string }[] = [
    { key: 'clients',   label: 'Clienti EDI' },
    { key: 'shipments', label: 'Spedizioni' },
    { key: 'history',   label: 'Storico' },
  ];
  return (
    <div className="flex border-b border-gray-200 mb-6">
      {tabs.map(t => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            active === t.key
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ─── Client Form Modal ────────────────────────────────────────────────────────

const EMPTY_CLIENT: Omit<EdiClient, 'id' | 'created_at' | 'updated_at'> = {
  customer_account: '', description: '', edi_type: '',
  cdt_company_name: '', cdt_vat: '',
  cdt_address_1: '', cdt_address_2: '', cdt_address_3: '', cdt_address_4: '',
  sdt_vat: '', supplier_code: '',
  csg_establishment_code: '', csg_company_name: '',
  csg_address_1: '', csg_address_2: '', csg_address_3: '', csg_address_4: '',
  csg_supply_point: '', output_folder: '',
};

function Field({
  label, value, onChange, placeholder, required, maxLen, mono,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; required?: boolean; maxLen?: number; mono?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLen}
        className={`w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${mono ? 'font-mono' : ''}`}
      />
    </div>
  );
}

function ClientModal({
  client, generators, onClose, onSaved,
}: {
  client: EdiClient | null;
  generators: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !client;
  const [form, setForm] = useState<typeof EMPTY_CLIENT>(
    client ? { ...EMPTY_CLIENT, ...client } : { ...EMPTY_CLIENT }
  );
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  function set(key: keyof typeof EMPTY_CLIENT) {
    return (v: string) => setForm(f => ({ ...f, [key]: v }));
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      if (isNew) {
        await api.post('/api/edi/clients', form);
      } else {
        await api.put(`/api/edi/clients/${client!.id}`, form);
      }
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <h2 className="font-semibold text-gray-800">
            {isNew ? 'Nuovo cliente EDI' : `Modifica — ${client!.description}`}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">&times;</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

          {/* Basic */}
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Generale</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Customer Account Dynamics" value={form.customer_account} onChange={set('customer_account')} required maxLen={20} mono />
              <Field label="Descrizione interna" value={form.description} onChange={set('description')} required />
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Tipo EDI<span className="text-red-500 ml-0.5">*</span></label>
                <select
                  value={form.edi_type}
                  onChange={e => setForm(f => ({ ...f, edi_type: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">— seleziona —</option>
                  {generators.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              <Field label="Cartella output (percorso assoluto)" value={form.output_folder} onChange={set('output_folder')} required placeholder="/mnt/intesa/edi_out" />
            </div>
          </section>

          {/* CDT */}
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">CDT — Mittente</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label="P.IVA mittente (es. 0940XXXXXXXXXXX)" value={form.cdt_vat} onChange={set('cdt_vat')} required maxLen={20} mono />
              <Field label="Ragione sociale" value={form.cdt_company_name} onChange={set('cdt_company_name')} required maxLen={35} />
              <Field label="Indirizzo 1" value={form.cdt_address_1 ?? ''} onChange={set('cdt_address_1')} maxLen={35} />
              <Field label="Indirizzo 2" value={form.cdt_address_2 ?? ''} onChange={set('cdt_address_2')} maxLen={35} />
              <Field label="Indirizzo 3" value={form.cdt_address_3 ?? ''} onChange={set('cdt_address_3')} maxLen={35} />
              <Field label="Indirizzo 4" value={form.cdt_address_4 ?? ''} onChange={set('cdt_address_4')} maxLen={35} />
            </div>
          </section>

          {/* SDT */}
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">SDT — Venditore/Fornitore</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label="P.IVA venditore" value={form.sdt_vat} onChange={set('sdt_vat')} maxLen={20} mono />
              <Field label="Codice Fornitore (max 9 cifre)" value={form.supplier_code} onChange={set('supplier_code')} required maxLen={9} mono placeholder="001234" />
            </div>
          </section>

          {/* CSG */}
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Destinatario</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Cod. identificativo destinatario"
                value={form.csg_establishment_code ?? ''}
                onChange={set('csg_establishment_code')}
                maxLen={20}
                mono
                placeholder="021 (Ferrari) · Odette ID (Audi) · Warehouse (McLaren)"
              />
              <Field label="Ragione sociale destinatario" value={form.csg_company_name} onChange={set('csg_company_name')} maxLen={35} />
              <Field label="Indirizzo 1 / Incoterms (Audi) / Location (McLaren)" value={form.csg_address_1 ?? ''} onChange={set('csg_address_1')} maxLen={35} />
              <Field label="Indirizzo 2" value={form.csg_address_2 ?? ''} onChange={set('csg_address_2')} maxLen={35} />
              <Field label="Indirizzo 3" value={form.csg_address_3 ?? ''} onChange={set('csg_address_3')} maxLen={35} />
              <Field label="Indirizzo 4" value={form.csg_address_4 ?? ''} onChange={set('csg_address_4')} maxLen={35} />
              <Field label="Punto di scarico / Codice impianto (an..5)" value={form.csg_supply_point ?? ''} onChange={set('csg_supply_point')} maxLen={17} mono placeholder="es. I05 (Audi Ingolstadt)" />
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t shrink-0 flex items-center justify-between gap-3">
          {error && <p className="text-sm text-red-600 flex-1">{error}</p>}
          {!error && <span />}
          <div className="flex gap-2 shrink-0">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50">Annulla</button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
            >
              {saving ? 'Salvataggio…' : isNew ? 'Crea cliente' : 'Salva modifiche'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tab Clienti ──────────────────────────────────────────────────────────────

function TabClienti({ generators }: { generators: string[] }) {
  const [clients, setClients]     = useState<EdiClient[]>([]);
  const [loading, setLoading]     = useState(true);
  const [modal, setModal]         = useState<EdiClient | null | 'new'>(null);
  const [deleting, setDeleting]   = useState<number | null>(null);

  const reload = useCallback(() => {
    api.get<EdiClient[]>('/api/edi/clients').then(setClients).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  async function handleDelete(id: number) {
    if (!confirm('Eliminare questo cliente EDI?')) return;
    setDeleting(id);
    try {
      await api.delete(`/api/edi/clients/${id}`);
      setClients(prev => prev.filter(c => c.id !== id));
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{clients.length} cliente/i configurato/i</p>
        <button
          onClick={() => setModal('new')}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 font-medium"
        >
          + Aggiungi cliente
        </button>
      </div>

      {loading && <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />)}</div>}

      {!loading && clients.length === 0 && (
        <div className="text-center py-12 text-gray-400 text-sm">
          Nessun cliente EDI configurato. Aggiungi il primo per iniziare.
        </div>
      )}

      {!loading && clients.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="text-left px-4 py-3">Descrizione</th>
                <th className="text-left px-4 py-3">Customer Account</th>
                <th className="text-left px-4 py-3">Tipo EDI</th>
                <th className="text-left px-4 py-3">Cod. Fornitore</th>
                <th className="text-left px-4 py-3">Cartella output</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {clients.map(c => (
                <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{c.description}</td>
                  <td className="px-4 py-3 font-mono text-gray-600">{c.customer_account}</td>
                  <td className="px-4 py-3">
                    <span className="inline-block bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded font-medium">
                      {c.edi_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-gray-600">{c.supplier_code}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs truncate max-w-[200px]">{c.output_folder}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <button onClick={() => setModal(c)} className="text-blue-600 hover:text-blue-700 text-xs font-medium">Modifica</button>
                      <button
                        onClick={() => handleDelete(c.id)}
                        disabled={deleting === c.id}
                        className="text-red-500 hover:text-red-700 text-xs font-medium disabled:opacity-40"
                      >
                        Elimina
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal !== null && (
        <ClientModal
          client={modal === 'new' ? null : modal}
          generators={generators}
          onClose={() => setModal(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}

// ─── Shipment Detail Modal (Schermata 3) ─────────────────────────────────────

function ShipmentDetailModal({
  shipment, clients, onClose, onGenerated,
}: {
  shipment: EdiShipment;
  clients: EdiClient[];
  onClose: () => void;
  onGenerated: () => void;
}) {
  const client    = clients.find(c => c.customer_account === shipment.customer_account);
  const [lines, setLines]         = useState<EdiLine[]>([]);
  const [loading, setLoading]     = useState(true);
  const [contracts, setContracts] = useState<Record<number, string>>({});
  const [generating, setGenerating] = useState(false);
  const [result, setResult]         = useState<{ filename: string } | null>(null);
  const [error, setError]           = useState('');

  useEffect(() => {
    api.get<EdiLine[]>(`/api/edi/shipments/${shipment.shipment_id}`)
      .then(data => {
        setLines(data);
        // Pre-fill contract numbers from Dynamics
        const init: Record<number, string> = {};
        data.forEach((l, i) => { init[i] = l.contract_number ?? ''; });
        setContracts(init);
      })
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [shipment.shipment_id]);

  // DESADV_MCLAREN: ordine acquisto opzionale; AVIEXP_FERRARI e DESADV_AUDI: obbligatorio
  const contractRequired = !client?.edi_type || !['DESADV_MCLAREN'].includes(client.edi_type);
  const contractLabel    = client?.edi_type === 'AVIEXP_FERRARI' ? 'N° Contratto Ferrari'
                         : client?.edi_type === 'DESADV_AUDI'    ? 'N° Ordine Acquisto (VDA)'
                         : 'N° Ordine Acquisto';
  const missingContracts = contractRequired ? lines.filter((_, i) => !contracts[i]?.trim()) : [];
  const canGenerate      = !loading && missingContracts.length === 0 && !generating;

  async function handleGenerate(force = false) {
    if (!force && shipment.edi_status === 'sent') {
      if (!confirm('Questa spedizione è già stata inviata. Rigenerare il file EDI?')) return;
      return handleGenerate(true);
    }
    setGenerating(true);
    setError('');
    try {
      const payload = {
        shipment_id:      shipment.shipment_id,
        customer_account: shipment.customer_account,
        document_number:  shipment.document_number,
        document_date:    shipment.document_date,
        is_extra_cee:     shipment.is_extra_cee,
        force,
        lines: lines.map((l, i) => ({
          ...l,
          contract_number: contracts[i]?.trim() || null,
        })),
      };
      const res = await api.post<{ filename: string }>('/api/edi/generate', payload);
      setResult(res);
      onGenerated();
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('già stata inviata') || msg.includes('409')) {
        if (confirm('Spedizione già inviata. Rigenerare?')) handleGenerate(true);
      } else {
        setError(msg);
      }
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <div>
            <h2 className="font-semibold text-gray-800">Spedizione #{shipment.shipment_id}</h2>
            <p className="text-sm text-gray-400">{client?.description ?? shipment.customer_account} · {fmtDate(shipment.shipment_date)}</p>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={shipment.edi_status} />
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">&times;</button>
          </div>
        </div>

        {/* Client config summary */}
        {client && (
          <div className="px-6 py-3 bg-gray-50 border-b shrink-0">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-600">
              <span><span className="font-medium">Tipo EDI:</span> {client.edi_type}</span>
              <span><span className="font-medium">Fornitore:</span> {client.supplier_code}</span>
              {client.csg_establishment_code && <span><span className="font-medium">Cod. dest.:</span> {client.csg_establishment_code}</span>}
              <span><span className="font-medium">Output:</span> <span className="font-mono">{client.output_folder}</span></span>
            </div>
          </div>
        )}

        {/* Lines */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && <div className="space-y-2">{[1,2,3].map(i=><div key={i} className="h-10 bg-gray-100 rounded animate-pulse"/>)}</div>}

          {!loading && lines.length === 0 && !error && (
            <p className="text-sm text-gray-400 text-center py-8">Nessuna riga trovata.</p>
          )}

          {!loading && lines.length > 0 && (
            <>
              {missingContracts.length > 0 && (
                <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
                  <strong>{missingContracts.length} riga/righe</strong> senza {contractLabel} — compilare per sbloccare la generazione.
                </div>
              )}
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <tr>
                      <th className="text-left px-3 py-2">Articolo</th>
                      <th className="text-left px-3 py-2">Descrizione</th>
                      <th className="text-right px-3 py-2">Qtà</th>
                      <th className="text-left px-3 py-2">UM</th>
                      <th className="text-left px-3 py-2">{contractLabel}{contractRequired && <span className="text-red-400 ml-0.5">*</span>}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {lines.map((line, i) => {
                      const missing = !contracts[i]?.trim();
                      return (
                        <tr key={i} className={missing ? 'bg-red-50' : 'hover:bg-gray-50'}>
                          <td className="px-3 py-2 font-mono text-gray-700">{line.article_code}</td>
                          <td className="px-3 py-2 text-gray-600 max-w-[200px] truncate">{line.description}</td>
                          <td className="px-3 py-2 text-right font-mono">{line.quantity}</td>
                          <td className="px-3 py-2 text-gray-500">{line.unit_of_measure}</td>
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              value={contracts[i] ?? ''}
                              onChange={e => setContracts(prev => ({ ...prev, [i]: e.target.value }))}
                              maxLength={client?.edi_type === 'AVIEXP_FERRARI' ? 14 : 35}
                              placeholder={client?.edi_type === 'AVIEXP_FERRARI' ? '14 cifre' : 'N° ordine'}
                              className={`w-44 font-mono text-xs border rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                                missing ? 'border-red-400 bg-red-50' : 'border-gray-300'
                              }`}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t shrink-0">
          {result && (
            <div className="mb-3 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
              File generato: <span className="font-mono font-medium">{result.filename}</span>
            </div>
          )}
          {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-gray-400">{lines.length} righe totali</p>
            <div className="flex gap-2">
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50">Chiudi</button>
              <button
                onClick={() => handleGenerate(false)}
                disabled={!canGenerate}
                title={missingContracts.length > 0 ? `Compilare ${contractLabel} per tutte le righe` : ''}
                className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 font-medium transition-colors"
              >
                {generating ? 'Generazione…' : 'Genera EDI'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tab Spedizioni ───────────────────────────────────────────────────────────

function TabSpedizioni({ clients }: { clients: EdiClient[] }) {
  const [shipments, setShipments] = useState<EdiShipment[]>([]);
  const [loading, setLoading]     = useState(true);
  const [dynError, setDynError]   = useState('');
  const [selected, setSelected]   = useState<EdiShipment | null>(null);
  const [filterAccount, setFilterAccount] = useState('');
  const [filterFrom,    setFilterFrom]    = useState('');
  const [filterTo,      setFilterTo]      = useState('');

  const reload = useCallback(() => {
    setLoading(true);
    setDynError('');
    const params = new URLSearchParams();
    if (filterAccount) params.set('customer_account', filterAccount);
    if (filterFrom)    params.set('from', filterFrom);
    if (filterTo)      params.set('to', filterTo);
    api.get<EdiShipment[]>(`/api/edi/shipments?${params}`)
      .then(setShipments)
      .catch(e => setDynError((e as Error).message))
      .finally(() => setLoading(false));
  }, [filterAccount, filterFrom, filterTo]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={filterAccount}
          onChange={e => setFilterAccount(e.target.value)}
          className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Tutti i clienti</option>
          {clients.map(c => <option key={c.customer_account} value={c.customer_account}>{c.description}</option>)}
        </select>
        <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)}
          className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)}
          className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <button onClick={reload} className="px-4 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors">
          Aggiorna
        </button>
      </div>

      {dynError && (
        <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
          <strong>Dynamics non disponibile</strong> — {dynError}
          <br />La configurazione clienti e lo storico rimangono operativi.
        </div>
      )}

      {loading && <div className="space-y-2">{[1,2,3,4].map(i=><div key={i} className="h-12 bg-gray-100 rounded-xl animate-pulse"/>)}</div>}

      {!loading && !dynError && shipments.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-10">Nessuna spedizione trovata.</p>
      )}

      {!loading && shipments.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="text-left px-4 py-3">N° Spedizione</th>
                <th className="text-left px-4 py-3">Data</th>
                <th className="text-left px-4 py-3">Cliente</th>
                <th className="text-left px-4 py-3">Tipo EDI</th>
                <th className="text-right px-4 py-3">Righe</th>
                <th className="text-left px-4 py-3">Stato EDI</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shipments.map(s => {
                const cl = clients.find(c => c.customer_account === s.customer_account);
                return (
                  <tr
                    key={s.shipment_id}
                    onClick={() => setSelected(s)}
                    className="hover:bg-blue-50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-mono font-medium text-gray-800">{s.shipment_id}</td>
                    <td className="px-4 py-3 text-gray-600">{fmtDate(s.shipment_date)}</td>
                    <td className="px-4 py-3 text-gray-700">{cl?.description ?? s.customer_account}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-medium">{s.edi_type}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{s.line_count}</td>
                    <td className="px-4 py-3"><StatusBadge status={s.edi_status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <ShipmentDetailModal
          shipment={selected}
          clients={clients}
          onClose={() => setSelected(null)}
          onGenerated={reload}
        />
      )}
    </div>
  );
}

// ─── File Content Modal ───────────────────────────────────────────────────────

function FileContentModal({ histId, filename, onClose }: { histId: number; filename: string; onClose: () => void }) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<{ content: string; filename: string }>(`/api/edi/history/${histId}/content`)
      .then(r => setContent(r.content ?? ''))
      .catch(() => setContent('(contenuto non disponibile)'))
      .finally(() => setLoading(false));
  }, [histId]);

  function handleDownload() {
    const blob = new Blob([content], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <h2 className="font-semibold text-gray-800 font-mono text-sm">{filename}</h2>
          <div className="flex items-center gap-2">
            <button onClick={handleDownload} className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg font-medium">
              Scarica
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">&times;</button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-6">
          {loading ? <div className="h-32 bg-gray-100 rounded animate-pulse" /> : (
            <pre className="text-xs font-mono text-gray-700 whitespace-pre-wrap break-all leading-relaxed">
              {content}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Tab Storico ──────────────────────────────────────────────────────────────

function TabStorico({ clients }: { clients: EdiClient[] }) {
  const [history, setHistory]   = useState<EdiHistoryEntry[]>([]);
  const [loading, setLoading]   = useState(true);
  const [preview, setPreview]   = useState<EdiHistoryEntry | null>(null);
  const [filterAccount, setFilterAccount] = useState('');
  const [filterFrom,    setFilterFrom]    = useState('');
  const [filterTo,      setFilterTo]      = useState('');

  const reload = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterAccount) params.set('customer_account', filterAccount);
    if (filterFrom)    params.set('from', filterFrom);
    if (filterTo)      params.set('to', filterTo);
    api.get<EdiHistoryEntry[]>(`/api/edi/history?${params}`)
      .then(setHistory)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filterAccount, filterFrom, filterTo]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={filterAccount}
          onChange={e => setFilterAccount(e.target.value)}
          className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Tutti i clienti</option>
          {clients.map(c => <option key={c.customer_account} value={c.customer_account}>{c.description}</option>)}
        </select>
        <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)}
          className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)}
          className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <button onClick={reload} className="px-4 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors">
          Aggiorna
        </button>
      </div>

      {loading && <div className="space-y-2">{[1,2,3].map(i=><div key={i} className="h-12 bg-gray-100 rounded-xl animate-pulse"/>)}</div>}

      {!loading && history.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-10">Nessun file EDI generato.</p>
      )}

      {!loading && history.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="text-left px-4 py-3">Data generazione</th>
                <th className="text-left px-4 py-3">Spedizione</th>
                <th className="text-left px-4 py-3">Cliente</th>
                <th className="text-left px-4 py-3">Tipo</th>
                <th className="text-left px-4 py-3">Filename</th>
                <th className="text-left px-4 py-3">Stato</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {history.map(h => {
                const cl = clients.find(c => c.customer_account === h.customer_account);
                return (
                  <tr key={h.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-gray-600">{fmtDateTime(h.generated_at)}</td>
                    <td className="px-4 py-3 font-mono text-gray-700">{h.shipment_id}</td>
                    <td className="px-4 py-3 text-gray-700">{cl?.description ?? h.customer_account}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-medium">{h.edi_type}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500 max-w-[200px] truncate">{h.filename}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <StatusBadge status={h.status} />
                        {h.is_regeneration && (
                          <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded font-medium">Rigenera</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {h.status === 'sent' && (
                        <button
                          onClick={() => setPreview(h)}
                          className="text-blue-600 hover:text-blue-700 text-xs font-medium"
                        >
                          Visualizza
                        </button>
                      )}
                      {h.status === 'error' && h.error_message && (
                        <span className="text-xs text-red-500 truncate max-w-[120px] block" title={h.error_message}>
                          {h.error_message.slice(0, 40)}{h.error_message.length > 40 ? '…' : ''}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {preview && (
        <FileContentModal
          histId={preview.id}
          filename={preview.filename}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EdiPage() {
  const [tab, setTab]             = useState<Tab>('clients');
  const [clients, setClients]     = useState<EdiClient[]>([]);
  const [generators, setGenerators] = useState<string[]>([]);

  // Load clients and generators once (shared across tabs)
  useEffect(() => {
    api.get<EdiClient[]>('/api/edi/clients').then(setClients).catch(() => {});
    api.get<string[]>('/api/edi/generators').then(setGenerators).catch(() => {});
  }, []);

  // Reload clients when Clienti tab is shown (after saves)
  function reloadClients() {
    api.get<EdiClient[]>('/api/edi/clients').then(setClients).catch(() => {});
  }

  return (
    <div className="max-w-6xl mx-auto">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">EDI</h1>
        <p className="text-sm text-gray-500 mt-1">
          Generazione automatica file Electronic Data Interchange per le spedizioni
        </p>
      </div>

      <Tabs active={tab} onChange={t => { setTab(t); if (t !== 'clients') reloadClients(); }} />

      {tab === 'clients' && (
        <TabClienti generators={generators} />
      )}
      {tab === 'shipments' && (
        <TabSpedizioni clients={clients} />
      )}
      {tab === 'history' && (
        <TabStorico clients={clients} />
      )}
    </div>
  );
}
