'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import type { ProjectRow } from '@/lib/progetti';

interface Props {
  ticketId: number;
  ticketTitle: string;
  projectId: number | null;
  projectName: string | null;
  /** Dopo un collegamento: il pannello del ticket si aggiorna */
  onChanged: () => void;
}

// Riquadro «Progetto» nella scheda del ticket: crea un progetto da questo ticket
// oppure lo aggiunge a uno esistente. Il ticket non cambia: si collega soltanto.
export function TicketProjectBox({ ticketId, ticketTitle, projectId, projectName, onChanged }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (projectId) return;
    api.get<ProjectRow[]>('/api/progetti').then(setProjects).catch(() => setProjects([]));
  }, [projectId]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); } catch (e) { toast.error(e instanceof Error ? e.message : 'Operazione non riuscita'); }
    finally { setBusy(false); }
  }

  const createFromTicket = () => run(async () => {
    const p = await api.post<{ id: number }>('/api/progetti', { name: ticketTitle, ticket_ids: [ticketId] });
    router.push(`/progetti/${p.id}`);
  });
  const addToProject = () => run(async () => {
    await api.post(`/api/progetti/${choice}/tickets`, { ticket_id: ticketId });
    toast.success('Ticket aggiunto al progetto');
    onChanged();
  });

  return (
    <div className="p-5 border-b border-gray-100">
      <p className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">Progetto</p>
      {projectId ? (
        <Link href={`/progetti/${projectId}`} className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-base font-medium text-accent-ink hover:underline">
          {projectName ?? 'Apri il progetto'} <span aria-hidden>→</span>
        </Link>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy} onClick={createFromTicket} className="btn-primary">Crea progetto da questo ticket</button>
          {projects.length > 0 && (
            <>
              <span className="text-sm text-muted">oppure</span>
              <select aria-label="Aggiungi a un progetto" value={choice} onChange={e => setChoice(e.target.value)} className="input !w-auto">
                <option value="">Aggiungi a un progetto…</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button type="button" disabled={busy || !choice} onClick={addToProject} className="btn-secondary">Aggiungi</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
