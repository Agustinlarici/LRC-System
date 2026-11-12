// Progetti: tipi, etichette e piccoli helper condivisi (API: /api/progetti, vedi backend/src/modules/progetti).
import type { Tone } from '@/components/ui/StatusBadge';

export type TaskStatus = 'da_fare' | 'in_corso' | 'in_attesa' | 'bloccata' | 'fatta';
export type ProjectStatus = 'attivo' | 'in_pausa' | 'chiuso';
export type LogKind = 'avanzamento' | 'problema' | 'decisione' | 'nota';

export interface PTask {
  id: number; project_id: number | null; ticket_id: number | null; title: string;
  status: TaskStatus; status_note: string | null; waiting_since: string | null;
  assigned_to: number | null; due_date: string | null; done_at: string | null; created_at: string;
  phase_id: number | null;
  project_name?: string | null; phase_name?: string | null; assigned_name?: string | null;
  days_to_due?: number | null; waiting_days?: number | null;
}

export interface Person { id: number; username: string; display_name: string }

/** Fase di un progetto: `start` è l'inizio effettivo (fissato a mano o la scadenza della precedente). */
export interface PhaseRow {
  id: number; project_id: number; name: string; sort_order: number;
  start_date: string | null; due_date: string | null; start: string; due_days: number | null;
  tasks_total: number; tasks_done: number;
}

/** Semaforo calcolato dal backend (backend/src/modules/progetti/health.ts). */
export interface Health { tone: Tone; label: string; reasons: string[] }

export interface ProjectRow {
  id: number; name: string; status: ProjectStatus; due_date: string | null; owner_name: string | null;
  tasks_total: number; tasks_done: number; tasks_blocked: number; tasks_waiting: number;
  last_activity: string | null; next_title: string | null; next_due: string | null; next_days: number | null;
  tickets_count: number; first_ticket: string | null;
  created_day: string; phases: PhaseRow[]; effective_due: string | null; due_is_manual: boolean; health: Health;
}

export interface ProjectTicket {
  id: number; ticket_number: string; title: string; status: string; priority: string; caller_name: string; created_at: string;
}

export interface ProjectDetail {
  id: number; name: string; description: string | null; status: ProjectStatus; due_date: string | null;
  owner_name: string | null; created_at: string; closed_at: string | null;
  phases: PhaseRow[]; effective_due: string | null; due_is_manual: boolean; health: Health;
  tasks: PTask[]; tickets: ProjectTicket[]; tasks_total: number; tasks_done: number; progress_pct: number;
}

export interface TimelineRow {
  source: 'log' | 'ticket'; id: number; kind: string; body: string | null; visible: boolean; who: string | null;
  created_at: string; ticket_number: string | null; ticket_action: string | null;
  old_value: string | null; new_value: string | null;
}

export interface PendingTicket { id: number; ticket_number: string; title: string; category: string | null; status: string; created_at: string }
export interface TicketHit { id: number; ticket_number: string; title: string; status: string; project_id: number | null; project_name: string | null }

export const TASK_LABEL: Record<TaskStatus, string> = {
  da_fare: 'Da fare', in_corso: 'In corso', in_attesa: 'In attesa', bloccata: 'Bloccata', fatta: 'Fatta',
};
export const TASK_TONE: Record<TaskStatus, Tone> = {
  da_fare: 'neutral', in_corso: 'info', in_attesa: 'warning', bloccata: 'danger', fatta: 'success',
};
export const PROJECT_LABEL: Record<ProjectStatus, string> = { attivo: 'Attivo', in_pausa: 'In pausa', chiuso: 'Chiuso' };
export const PROJECT_TONE: Record<ProjectStatus, Tone> = { attivo: 'success', in_pausa: 'warning', chiuso: 'neutral' };
export const KIND_LABEL: Record<string, string> = {
  avanzamento: 'Avanzamento', problema: 'Problema', decisione: 'Decisione', nota: 'Nota', sistema: 'Sistema', ticket: 'Ticket',
};
export const LOG_KINDS: LogKind[] = ['avanzamento', 'problema', 'decisione', 'nota'];
export const TICKET_ACTION_LABEL: Record<string, string> = {
  creato: 'creato', assegnato: 'assegnato', stato_cambiato: 'stato', priorita_cambiata: 'priorità',
  commentato: 'commento', risolto: 'risolto', chiuso: 'chiuso', riaperto: 'riaperto',
  allegato_aggiunto: 'allegato', approvato: 'approvato', categoria_cambiata: 'categoria',
};

export function dueLabel(days: number | null | undefined): string {
  if (days === null || days === undefined) return '';
  if (days < 0) return `scaduta da ${-days} g`;
  if (days === 0) return 'oggi';
  if (days === 1) return 'domani';
  return `tra ${days} g`;
}

export function fmtDate(d: string | null): string {
  if (!d) return '—';
  return new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
}
export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
/** Data di oggi come AAAA-MM-GG nel fuso del browser. */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function daysAgo(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

/** Giorni da oggi a una data AAAA-MM-GG (negativo = passato). */
export function daysFromToday(iso: string): number {
  const a = new Date(`${iso.slice(0, 10)}T12:00:00`).getTime();
  const b = new Date(`${todayISO()}T12:00:00`).getTime();
  return Math.round((a - b) / 86_400_000);
}
/** «18 nov» */
export function fmtShort(iso: string | null): string {
  if (!iso) return '—';
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }).replace('.', '');
}
export function initials(name: string | null | undefined): string {
  return (name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');
}
/** Data AAAA-MM-GG a N giorni da oggi (ora locale). */
export function isoPlusDays(n: number): string {
  const d = new Date(`${todayISO()}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
