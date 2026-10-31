'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import type { HrEmployee, HrContractCompany, HrDeadlineRule } from '@/types';
import { useToast } from '@/components/ui/Toast';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';
import { PageHeader } from '@/components/ui/PageHeader';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

function fmtDate(d: string | null): string {
  if (!d) return '—';
  return new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Prima regola attiva che corrisponde (per sort_order) — lista vuota di società,
// o in_prova NULL, significano "qualsiasi" per quel filtro.
function matchRule(e: HrEmployee, rules: HrDeadlineRule[]): HrDeadlineRule | null {
  for (const r of rules) {
    if (!r.is_active) continue;
    if (r.contract_company_ids.length > 0 && (e.contract_company_id == null || !r.contract_company_ids.includes(e.contract_company_id))) continue;
    if (r.in_prova != null && r.in_prova !== e.in_prova) continue;
    return r;
  }
  return null;
}

function ruleSocieta(r: HrDeadlineRule): string {
  return r.contract_company_ids.length > 0 ? (r.contract_company_names ?? `${r.contract_company_ids.length} società`) : 'Tutte';
}
function ruleProva(r: HrDeadlineRule): string {
  return r.in_prova == null ? 'Qualsiasi' : r.in_prova ? 'Sì' : 'No';
}
function ruleDescription(r: HrDeadlineRule): string {
  return `${ruleSocieta(r)} · ${r.in_prova == null ? 'in prova o no' : r.in_prova ? 'in prova' : 'non in prova'}`;
}

interface DeadlineAck {
  employee_id: number;
  data_cessazione: string;
  status: 'preso_in_carico';
  user_name: string | null;
  acted_at: string;
}

function fmtDateTime(d: string): string {
  return new Date(d).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const COLS = 'grid-cols-[160px_minmax(110px,1fr)_minmax(110px,1fr)_minmax(100px,1fr)_70px_100px_130px_80px]';

interface RuleFormState {
  label: string;
  contract_company_ids: number[]; // [] = tutte
  in_prova: Set<'si' | 'no'>;     // entrambi o nessuno selezionato = qualsiasi
  giorni_avviso: string;
}
const EMPTY_RULE_FORM = (): RuleFormState => ({ label: '', contract_company_ids: [], in_prova: new Set(), giorni_avviso: '30' });

export default function ScadenzePage() {
  const { canManage } = useAuth();
  const manage = canManage('hr');
  const toast = useToast();

  const [employees, setEmployees] = useState<HrEmployee[]>([]);
  const [companies, setCompanies] = useState<HrContractCompany[]>([]);
  const [rules, setRules] = useState<HrDeadlineRule[]>([]);
  const [acks, setAcks] = useState<Map<number, DeadlineAck>>(new Map());
  const [loading, setLoading] = useState(true);
  const [societaFilter, setSocietaFilter] = useState<number[]>([]);
  const [showRules, setShowRules] = useState(false);
  const [ruleForm, setRuleForm] = useState<RuleFormState>(EMPTY_RULE_FORM());
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);
  const [savingRule, setSavingRule] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [empRes, coRes, ruleRes, ackRes] = await Promise.all([
      fetch(`${BACKEND}/api/hr/employees`, { credentials: 'include' }),
      fetch(`${BACKEND}/api/hr/contract-companies`, { credentials: 'include' }),
      fetch(`${BACKEND}/api/hr/deadline-rules`, { credentials: 'include' }),
      fetch(`${BACKEND}/api/hr/deadline-acks`, { credentials: 'include' }),
    ]);
    if (empRes.ok) setEmployees(await empRes.json());
    if (coRes.ok) setCompanies(await coRes.json());
    if (ruleRes.ok) setRules(await ruleRes.json());
    if (ackRes.ok) setAcks(new Map((await ackRes.json() as DeadlineAck[]).map(a => [a.employee_id, a])));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const today = useMemo(() => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z'), []);

  // Un dipendente cessato (stato marcato come tale) esce da questa pagina anche se
  // la sua data di cessazione è nel passato: le scadenze servono solo a segnalare
  // le cessazioni ancora da gestire, non a tenere uno storico.
  const allDeadlines = useMemo(() => {
    return employees
      .filter(e => e.stato !== 'cessato' && e.data_cessazione)
      .map(e => {
        const dataCessazione = new Date(`${e.data_cessazione!.slice(0, 10)}T00:00:00Z`);
        const giorniRimanenti = Math.round((dataCessazione.getTime() - today.getTime()) / 86400000);
        const rule = matchRule(e, rules);
        const inAvviso = rule != null && giorniRimanenti <= rule.giorni_avviso;
        const overdue = giorniRimanenti < 0;
        return { employee: e, giorniRimanenti, rule, inAvviso, overdue };
      })
      .filter(d => societaFilter.length === 0 || (d.employee.contract_company_id != null && societaFilter.includes(d.employee.contract_company_id)))
      .sort((a, b) => a.giorniRimanenti - b.giorniRimanenti);
  }, [employees, rules, today, societaFilter]);

  // La pagina mostra solo chi è in avviso o già scaduto — una scadenza lontana
  // senza regola che la segnali non ha motivo di comparire in questa lista.
  const deadlines = useMemo(() => allDeadlines.filter(d => d.inAvviso || d.overdue), [allDeadlines]);

  const counts = useMemo(() => ({
    scadute: allDeadlines.filter(d => d.overdue).length,
    avviso:  allDeadlines.filter(d => d.inAvviso && !d.overdue).length,
  }), [allDeadlines]);

  // Per ogni regola attiva: quanti dipendenti (che la regola "vince") sono in avviso o scaduti.
  const ruleCards = useMemo(() => rules.filter(r => r.is_active).map(r => {
    const mine = allDeadlines.filter(d => d.rule?.id === r.id);
    return {
      rule: r,
      avviso: mine.filter(d => d.inAvviso && !d.overdue).length,
      scadute: mine.filter(d => d.overdue).length,
    };
  }), [rules, allDeadlines]);

  // Il numero nella sidebar si aggiorna tramite l'evento, senza aspettare il
  // prossimo cambio pagina.
  async function setAck(employeeId: number, status: 'preso_in_carico' | null) {
    const res = await fetch(`${BACKEND}/api/hr/deadline-acks/${employeeId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ status }),
    });
    if (!res.ok) { const b = await res.json().catch(() => ({})); toast.error(b.message ?? 'Errore durante il salvataggio'); return; }
    const saved: DeadlineAck | null = status === null ? null : await res.json();
    setAcks(prev => {
      const next = new Map(prev);
      if (saved) next.set(employeeId, saved); else next.delete(employeeId);
      return next;
    });
    window.dispatchEvent(new Event('hr-deadlines-changed'));
  }

  function resetRuleForm() { setEditingRuleId(null); setRuleForm(EMPTY_RULE_FORM()); }
  function startEditRule(r: HrDeadlineRule) {
    setEditingRuleId(r.id);
    setRuleForm({
      label: r.label ?? '',
      contract_company_ids: r.contract_company_ids,
      in_prova: r.in_prova == null ? new Set() : new Set([r.in_prova ? 'si' : 'no']),
      giorni_avviso: String(r.giorni_avviso),
    });
  }

  async function submitRule(e: React.FormEvent) {
    e.preventDefault();
    const giorni = Number(ruleForm.giorni_avviso);
    if (!Number.isFinite(giorni) || giorni < 0) { toast.error('Giorni avviso non valido'); return; }
    setSavingRule(true);
    // Entrambi o nessuno selezionato = "qualsiasi" (NULL); solo uno = quel valore specifico.
    const inProvaValue = ruleForm.in_prova.size === 1 ? ruleForm.in_prova.has('si') : null;
    const body = {
      label: ruleForm.label.trim() || null,
      contract_company_ids: ruleForm.contract_company_ids,
      in_prova: inProvaValue,
      giorni_avviso: giorni,
      ...(editingRuleId ? {} : { sort_order: rules.length }),
    };
    const res = await fetch(
      editingRuleId ? `${BACKEND}/api/hr/deadline-rules/${editingRuleId}` : `${BACKEND}/api/hr/deadline-rules`,
      {
        method: editingRuleId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify(body),
      }
    );
    setSavingRule(false);
    if (res.ok) { resetRuleForm(); load(); }
    else { const b = await res.json().catch(() => ({})); toast.error(b.message ?? 'Errore durante il salvataggio'); }
  }

  async function deleteRule(r: HrDeadlineRule) {
    const res = await fetch(`${BACKEND}/api/hr/deadline-rules/${r.id}`, { method: 'DELETE', credentials: 'include' });
    if (res.ok) load();
  }

  // Scambia sort_order con il vicino per spostare su/giù — la prima regola che
  // corrisponde vince, quindi l'ordine decide la priorità tra regole sovrapposte.
  async function moveRule(index: number, dir: -1 | 1) {
    const other = rules[index + dir];
    const current = rules[index];
    if (!other) return;
    await Promise.all([
      fetch(`${BACKEND}/api/hr/deadline-rules/${current.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ sort_order: other.sort_order }),
      }),
      fetch(`${BACKEND}/api/hr/deadline-rules/${other.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ sort_order: current.sort_order }),
      }),
    ]);
    load();
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Scadenze"
        description="Contratti in scadenza: chi è in avviso o già scaduto, per regola"
        actions={manage && <button onClick={() => setShowRules(true)} className="btn-secondary text-sm">Gestisci regole di avviso</button>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        <div className="rounded-card border border-warning/30 bg-warning-soft px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-warning">In avviso</p>
          <p className="text-3xl font-semibold text-warning leading-tight mt-1">{counts.avviso}</p>
        </div>
        <div className="rounded-card border border-danger/30 bg-danger-soft px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-danger">Scadute</p>
          <p className="text-3xl font-semibold text-danger leading-tight mt-1">{counts.scadute}</p>
        </div>
        {ruleCards.map(({ rule, avviso, scadute }) => (
          <div
            key={rule.id}
            className="rounded-card border border-line bg-white px-4 py-3 col-span-2 lg:col-span-1"
            title={`${ruleDescription(rule)} · avviso a ${rule.giorni_avviso} giorni`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-ink-800 truncate">{rule.label || ruleDescription(rule)}</p>
              <p className="text-[11px] text-muted whitespace-nowrap">{rule.giorni_avviso} giorni</p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <p className="text-3xl font-semibold leading-none text-warning">{avviso}</p>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-muted"><span className="w-2 h-2 rounded-full bg-warning" />in avviso</p>
              </div>
              <div>
                <p className="text-3xl font-semibold leading-none text-danger">{scadute}</p>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-muted"><span className="w-2 h-2 rounded-full bg-danger" />scadute</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {showRules && manage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowRules(false)}>
          <div className="card w-full max-w-6xl max-h-[95vh] overflow-y-auto space-y-4 relative" onClick={e => e.stopPropagation()}>
            <button type="button" onClick={() => setShowRules(false)} aria-label="Chiudi"
              className="absolute top-3 right-3 text-muted hover:text-ink-800 text-xl leading-none w-8 h-8 flex items-center justify-center rounded-full hover:bg-stone-100">×</button>

            <div className="pr-8">
              <p className="text-sm font-semibold text-ink-800">Regole di avviso</p>
              <p className="text-xs text-muted mt-1">
                Ogni dipendente con data di cessazione prende la prima regola attiva (dall&apos;alto) i cui filtri corrispondono — società e/o periodo di prova. Lascia un filtro su &quot;Qualsiasi&quot; per farlo valere a prescindere.
              </p>
            </div>

            {rules.length === 0 ? (
              <p className="text-sm text-muted">Nessuna regola creata — senza regole nessun dipendente risulta &quot;in avviso&quot;.</p>
            ) : (
              <div className="border border-line rounded-ctl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-stone-50 border-b border-line text-xs font-medium text-muted uppercase tracking-wide">
                      <th className="w-8"></th>
                      <th className="text-left px-3 py-2">Nome</th>
                      <th className="text-left px-3 py-2">Società</th>
                      <th className="text-left px-3 py-2">Prova</th>
                      <th className="text-left px-3 py-2">Giorni avviso</th>
                      <th className="text-left px-3 py-2">Stato</th>
                      <th className="text-right px-3 py-2">Azioni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map((r, i) => (
                      <tr key={r.id} className={`border-b border-stone-100 last:border-b-0 ${r.is_active ? '' : 'opacity-50'}`}>
                        <td className="px-2 py-2">
                          <div className="flex flex-col gap-0.5">
                            <button type="button" disabled={i === 0} onClick={() => moveRule(i, -1)} className="text-muted hover:text-ink-800 disabled:opacity-20 text-xs leading-none">▲</button>
                            <button type="button" disabled={i === rules.length - 1} onClick={() => moveRule(i, 1)} className="text-muted hover:text-ink-800 disabled:opacity-20 text-xs leading-none">▼</button>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-ink-800 font-medium truncate max-w-[160px]">{r.label || '—'}</td>
                        <td className="px-3 py-2 text-muted truncate max-w-[160px]">{ruleSocieta(r)}</td>
                        <td className="px-3 py-2 text-muted">{ruleProva(r)}</td>
                        <td className="px-3 py-2 text-muted">{r.giorni_avviso} giorni</td>
                        <td className="px-3 py-2">
                          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${r.is_active ? 'bg-success-soft text-success border-success/30' : 'bg-stone-50 text-muted border-line'}`}>
                            {r.is_active ? 'Attiva' : 'Disattivata'}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                            <button type="button" onClick={() => startEditRule(r)} className="text-xs text-accent-ink hover:underline">Modifica</button>
                            <button type="button" onClick={() => deleteRule(r)} className="text-xs text-danger hover:text-danger">Elimina</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <form onSubmit={submitRule} className="space-y-3 border-t border-stone-100 pt-4">
              <div className="flex items-end gap-3 flex-wrap">
                <div className="shrink-0"><label className="label">Nome (facoltativo)</label>
                  <input className="input text-sm" value={ruleForm.label} onChange={e => setRuleForm(f => ({ ...f, label: e.target.value }))} placeholder="es. STR in prova" />
                </div>
                <div className="shrink-0"><label className="label">In prova</label>
                  <MultiSelectDropdown
                    allLabel="Tutti"
                    options={[{ value: 'si', label: 'Sì' }, { value: 'no', label: 'No' }]}
                    selected={[...ruleForm.in_prova]}
                    onChange={vals => setRuleForm(f => ({ ...f, in_prova: new Set(vals as ('si' | 'no')[]) }))}
                  />
                </div>
                <div className="shrink-0"><label className="label">Società (nessuna = tutte)</label>
                  <MultiSelectDropdown
                    className="w-56"
                    allLabel="Tutte"
                    options={companies.map(c => ({ value: String(c.id), label: c.name }))}
                    selected={ruleForm.contract_company_ids.map(String)}
                    onChange={vals => setRuleForm(f => ({ ...f, contract_company_ids: vals.map(Number) }))}
                  />
                </div>
                <div className="shrink-0 w-28"><label className="label">Giorni avviso</label>
                  <input type="number" min={0} className="input text-sm" value={ruleForm.giorni_avviso} onChange={e => setRuleForm(f => ({ ...f, giorni_avviso: e.target.value }))} />
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  {editingRuleId && <button type="button" onClick={resetRuleForm} className="btn-secondary text-sm">Annulla</button>}
                  <button type="submit" disabled={savingRule} className="btn-primary text-sm whitespace-nowrap">{editingRuleId ? 'Salva' : 'Aggiungi regola'}</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-stone-100 bg-stone-50 flex-wrap">
          <MultiSelectDropdown
            className="w-56"
            allLabel="Tutte le società"
            options={companies.map(c => ({ value: String(c.id), label: c.name }))}
            selected={societaFilter.map(String)}
            onChange={vals => setSocietaFilter(vals.map(Number))}
          />
          <span className="text-xs text-muted">Solo dipendenti in avviso o scaduti</span>
        </div>

        <div className={`grid ${COLS} gap-x-3 px-4 py-2.5 bg-stone-50 border-b border-stone-100 text-xs font-medium text-muted uppercase tracking-wide`}>
          <div>In carico</div><div>Cognome</div><div>Nome</div><div>Società</div><div className="text-center">Prova</div>
          <div>Cessazione</div><div>Regola applicata</div><div className="text-center">Giorni</div>
        </div>
        {loading ? (
          <SkeletonTable rows={8} cols={6} />
        ) : deadlines.length === 0 ? (
          <EmptyState title="Nessuna scadenza trovata" />
        ) : deadlines.map(d => {
          // Lo stato vale solo per la data di cessazione a cui si riferiva.
          const stored = acks.get(d.employee.id);
          const ack = stored && stored.data_cessazione === d.employee.data_cessazione?.slice(0, 10) ? stored : null;
          return (
          <Link key={d.employee.id} href={`/hr/dipendenti/${d.employee.id}`}
            className={`grid ${COLS} gap-x-3 px-4 py-3 border-b border-stone-50 last:border-b-0 hover:bg-stone-50 transition-colors items-center
              ${ack ? 'opacity-60' : d.overdue ? 'bg-danger-soft/60' : d.inAvviso ? 'bg-warning-soft/60' : ''}`}
          >
            <div className="flex items-center gap-2 min-w-0">
              {ack ? (
                <>
                  <button
                    type="button"
                    aria-label="Rimuovi presa in carico"
                    title="Preso in carico — clicca per annullare"
                    onClick={e => { e.preventDefault(); e.stopPropagation(); setAck(d.employee.id, null); }}
                    className="shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center bg-success border-success/30 text-white"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="w-3.5 h-3.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </button>
                  <div className="min-w-0 leading-tight" title={`${ack.user_name ?? '—'} · ${fmtDateTime(ack.acted_at)}`}>
                    <p className="text-[11px] font-medium text-muted truncate">{ack.user_name ?? '—'}</p>
                    <p className="text-[10px] text-muted">{fmtDateTime(ack.acted_at)}</p>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  onClick={e => { e.preventDefault(); e.stopPropagation(); setAck(d.employee.id, 'preso_in_carico'); }}
                  className="shrink-0 text-[11px] font-medium text-muted border border-stone-300 rounded-full px-2 py-0.5 hover:border-success/30 hover:text-success hover:bg-success-soft transition-colors"
                >
                  Prendi in carico
                </button>
              )}
            </div>
            <div className="text-sm font-medium text-ink-800 truncate">{d.employee.cognome}</div>
            <div className="text-sm text-ink-800 truncate">{d.employee.nome}</div>
            <div className="text-sm text-muted truncate">{d.employee.contract_company_name ?? '—'}</div>
            <div className="text-center text-sm text-muted">{d.employee.in_prova ? 'Sì' : '—'}</div>
            <div className="text-sm text-muted">{fmtDate(d.employee.data_cessazione)}</div>
            <div className="text-xs text-muted truncate">{d.rule ? ruleDescription(d.rule) : 'Nessuna regola'}</div>
            <div className="text-center">
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${
                d.overdue ? 'bg-danger-soft text-danger border-danger/30'
                  : d.inAvviso ? 'bg-warning-soft text-warning border-warning/30'
                  : 'bg-stone-50 text-muted border-line'
              }`}>
                {d.overdue ? `${Math.abs(d.giorniRimanenti)}g fa` : `${d.giorniRimanenti}g`}
              </span>
            </div>
          </Link>
          );
        })}
      </div>
    </div>
  );
}
