'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

type Category   = { category: string; subcategory: string | null };
type Department = { id: number; name: string };
type PriorityRule = { category: string; blocca_lavoro: boolean; priority: string };

const PRIORITY_LABELS: Record<string, string> = {
  bassa: 'Bassa', media: 'Media', alta: 'Alta', critica: 'Critica',
};
const PRIORITY_COLORS: Record<string, string> = {
  bassa: 'text-green-700 bg-green-50 border-green-200',
  media: 'text-yellow-700 bg-yellow-50 border-yellow-200',
  alta:  'text-orange-700 bg-orange-50 border-orange-200',
  critica: 'text-red-700 bg-red-50 border-red-200',
};

export default function NuovoTicketPage() {
  const router = useRouter();

  const [categories,    setCategories]    = useState<Category[]>([]);
  const [departments,   setDepartments]   = useState<Department[]>([]);
  const [priorityRules, setPriorityRules] = useState<PriorityRule[]>([]);

  const [callerName,    setCallerName]    = useState('');
  const [callerEmail,   setCallerEmail]   = useState('');
  const [callerPhone,   setCallerPhone]   = useState('');
  const [departmentId,  setDepartmentId]  = useState('');
  const [title,         setTitle]         = useState('');
  const [description,   setDescription]  = useState('');
  const [category,      setCategory]      = useState('');
  const [subcategory,   setSubcategory]   = useState('');
  const [bloccaLavoro,  setBloccaLavoro]  = useState(false);
  const [attachment,    setAttachment]    = useState<File | null>(null);

  const [suggestedPriority, setSuggestedPriority] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`${BACKEND}/api/tickets/categories`).then(r => r.json()).then(setCategories);
    fetch(`${BACKEND}/api/tickets/departments`).then(r => r.json()).then(setDepartments);
    fetch(`${BACKEND}/api/tickets/priority-rules`).then(r => r.json()).then(setPriorityRules);
  }, []);

  // Derive unique top-level categories
  const topCategories = [...new Set(categories.map(c => c.category))];
  const subcategories = categories
    .filter(c => c.category === category && c.subcategory !== null)
    .map(c => c.subcategory as string);

  // Update suggested priority whenever category or blocca_lavoro changes
  useEffect(() => {
    if (!category) { setSuggestedPriority(''); return; }
    const rule = priorityRules.find(r => r.category === category && r.blocca_lavoro === bloccaLavoro);
    setSuggestedPriority(rule?.priority ?? 'media');
  }, [category, bloccaLavoro, priorityRules]);

  // Reset subcategory when category changes
  useEffect(() => { setSubcategory(''); }, [category]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const form = new FormData();
      form.append('caller_name',  callerName);
      if (callerEmail)   form.append('caller_email',  callerEmail);
      if (callerPhone)   form.append('caller_phone',  callerPhone);
      if (departmentId)  form.append('department_id', departmentId);
      form.append('title',         title);
      form.append('description',   description);
      if (category)      form.append('category',      category);
      if (subcategory)   form.append('subcategory',   subcategory);
      form.append('blocca_lavoro', String(bloccaLavoro));
      if (attachment)    form.append('attachment',    attachment);

      const res = await fetch(`${BACKEND}/api/tickets`, {
        method: 'POST',
        body:   form,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message ?? data.error ?? 'Errore durante l\'invio');
        return;
      }

      const data = await res.json();
      const ticketNum = data.ticket_number.replace(/^#/, '');
      router.push(`/tickets/stato/${ticketNum}`);
    } catch {
      setError('Errore di connessione al server');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Apri un ticket</h1>
        <p className="text-sm text-gray-500 mt-1">Compila il modulo per segnalare un problema o richiedere assistenza IT</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Caller info */}
        <div className="card space-y-4">
          <h2 className="font-semibold text-gray-800">I tuoi dati</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nome e cognome <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={callerName}
                onChange={e => setCallerName(e.target.value)}
                required
                placeholder="Mario Rossi"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reparto</label>
              <select
                value={departmentId}
                onChange={e => setDepartmentId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">— Seleziona —</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={callerEmail}
                onChange={e => setCallerEmail(e.target.value)}
                placeholder="mario@str-automotive.com"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Telefono</label>
              <input
                type="tel"
                value={callerPhone}
                onChange={e => setCallerPhone(e.target.value)}
                placeholder="interno 123"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Problem */}
        <div className="card space-y-4">
          <h2 className="font-semibold text-gray-800">Descrizione del problema</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Categoria</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">— Seleziona —</option>
                {topCategories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            {subcategories.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sottocategoria</label>
                <select
                  value={subcategory}
                  onChange={e => setSubcategory(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">— Seleziona —</option>
                  {subcategories.map(sub => (
                    <option key={sub} value={sub}>{sub}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Blocca lavoro */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={bloccaLavoro}
              onChange={e => setBloccaLavoro(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
            />
            <span className="text-sm text-gray-700">
              <span className="font-medium text-red-700">Il problema blocca il lavoro</span>
              <span className="text-gray-500"> — non riesco a lavorare a causa di questo problema</span>
            </span>
          </label>

          {suggestedPriority && (
            <div className={`inline-flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-full border ${PRIORITY_COLORS[suggestedPriority]}`}>
              Priorità suggerita: {PRIORITY_LABELS[suggestedPriority]}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Oggetto <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
              minLength={3}
              placeholder="Es. PC non si accende, stampante offline…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Descrizione <span className="text-red-500">*</span></label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              required
              minLength={10}
              rows={5}
              placeholder="Descrivi il problema in dettaglio: cosa stavi facendo, cosa è successo, eventuali messaggi di errore…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Screenshot / Allegato</label>
            <input
              type="file"
              accept="image/*,.pdf,.doc,.docx,.txt"
              onChange={e => setAttachment(e.target.files?.[0] ?? null)}
              className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
            <p className="text-xs text-gray-400 mt-1">Max 10 MB — immagini, PDF, documenti</p>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{error}</p>
        )}

        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={submitting}
            className="bg-blue-600 text-white rounded-lg px-6 py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Invio in corso…' : 'Invia ticket'}
          </button>
          <a href="/tickets" className="text-sm text-gray-500 hover:underline">Annulla</a>
        </div>
      </form>
    </div>
  );
}
