'use client';

import { useState } from 'react';
import type { HrEmployeeTag } from '@/types';
import { TAG_COLOR_OPTIONS, tagDotClass } from '@/lib/tagColors';
import { useToast } from '@/components/ui/Toast';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

interface Props {
  tags: HrEmployeeTag[];
  onClose: () => void;
  onChanged: () => void;
}

// Gestione del catalogo etichette (pallino colorato): nome, colore e significato
// sono liberi — non ci sono valori fissi nel codice, HR li definisce qui.
export function TagsSettingsModal({ tags, onClose, onChanged }: Props) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>('gray');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  function resetForm() {
    setEditingId(null); setName(''); setColor('gray'); setDescription('');
  }

  function startEdit(t: HrEmployeeTag) {
    setEditingId(t.id); setName(t.name); setColor(t.color); setDescription(t.description ?? '');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    const body = { name: name.trim(), color, description: description.trim() || null };
    const res = await fetch(
      editingId ? `${BACKEND}/api/hr/tags/${editingId}` : `${BACKEND}/api/hr/tags`,
      {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      }
    );
    setSaving(false);
    if (res.ok) { resetForm(); onChanged(); }
    else {
      const b = await res.json().catch(() => ({}));
      toast.error(b.message ?? 'Errore durante il salvataggio');
    }
  }

  async function toggleActive(t: HrEmployeeTag) {
    const res = await fetch(`${BACKEND}/api/hr/tags/${t.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ is_active: !t.is_active }),
    });
    if (res.ok) onChanged();
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="max-h-[90vh] overflow-y-auto p-6">
          <h2 className="text-base font-medium text-gray-900 mb-4">Etichette dipendenti</h2>

          <div className="space-y-2 mb-5">
            {tags.length === 0 && <p className="text-sm text-gray-400">Nessuna etichetta creata.</p>}
            {tags.map(t => (
              <div key={t.id} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border border-gray-200 ${t.is_active ? '' : 'opacity-50'}`}>
                <span className={`w-3 h-3 rounded-full shrink-0 ${tagDotClass(t.color)}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800 truncate">{t.name}</p>
                  {t.description && <p className="text-xs text-gray-500 truncate">{t.description}</p>}
                </div>
                <button type="button" onClick={() => startEdit(t)} className="text-xs text-blue-600 hover:text-blue-800 shrink-0">Modifica</button>
                <button type="button" onClick={() => toggleActive(t)} className="text-xs text-gray-400 hover:text-gray-600 shrink-0">
                  {t.is_active ? 'Disattiva' : 'Riattiva'}
                </button>
              </div>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-3 border-t border-gray-100 pt-4">
            <p className="text-sm font-medium text-gray-700">{editingId ? 'Modifica etichetta' : 'Nuova etichetta'}</p>
            <div><label className="label">Nome</label><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="es. Da rivedere" /></div>
            <div><label className="label">Significato (facoltativo)</label><input className="input" value={description} onChange={e => setDescription(e.target.value)} placeholder="Spiega quando usarla" /></div>
            <div>
              <label className="label">Colore</label>
              <div className="flex flex-wrap gap-2">
                {TAG_COLOR_OPTIONS.map(c => (
                  <button
                    key={c.key} type="button" onClick={() => setColor(c.key)} title={c.label}
                    className={`w-7 h-7 rounded-full ${c.dot} ${color === c.key ? 'ring-2 ring-offset-2 ring-gray-400' : ''}`}
                  />
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              {editingId && <button type="button" onClick={resetForm} className="btn-secondary text-sm">Annulla modifica</button>}
              <button type="submit" disabled={saving || !name.trim()} className="btn-primary text-sm">{editingId ? 'Salva' : 'Crea etichetta'}</button>
            </div>
          </form>

          <div className="flex justify-end pt-5">
            <button type="button" onClick={onClose} className="btn-secondary text-sm">Chiudi</button>
          </div>
        </div>
      </div>
    </div>
  );
}
