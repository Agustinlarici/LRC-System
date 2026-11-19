'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tabs } from '@/components/ui/Tabs';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/Toast';
import { RegolaEditor, nuovaRegola, pulisciRegola, type Regola } from '../_components/RegolaEditor';

interface Gruppo { nome: string; parole: string[] }
interface Prova { totale: number; applicate: { id: number; nome: string; prezzo: number }[] }

type Scheda = 'regole' | 'gruppi' | 'prova';
const SCHEDE: readonly Scheda[] = ['regole', 'gruppi', 'prova'];
const ETICHETTE: Record<Scheda, string> = { regole: 'Regole', gruppi: 'Gruppi di parole', prova: 'Clienti e prova' };

const eur = (n: number) => n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
const lista = (t: string) => t.split(',').map(x => x.trim()).filter(Boolean);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function FatturazioneImpostazioniPage() {
  const { canManage } = useAuth();
  const toast = useToast();
  const manage = canManage('fatturazione');
  const [tab, setTab] = useState<Scheda>('regole');
  const [regole, setRegole] = useState<Regola[]>([]);
  const [gruppi, setGruppi] = useState<Gruppo[]>([]);
  const [conti, setConti] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pArt, setPArt] = useState('');
  const [pDesc, setPDesc] = useState('');
  const [prova, setProva] = useState<Prova | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<Regola[]>('/api/fatturazione/regole'),
      api.get<Gruppo[]>('/api/fatturazione/gruppi'),
      api.get<string[]>('/api/fatturazione/conti'),
    ])
      .then(([r, g, c]) => { setRegole(r); setGruppi(g); setConti(c.join(', ')); })
      .catch(e => setError(errMsg(e)))
      .finally(() => setLoading(false));
  }, []);

  async function salva(fn: () => Promise<void>, ok: string) {
    setSaving(true);
    try { await fn(); toast.success(ok); } catch (e) { toast.error(errMsg(e)); } finally { setSaving(false); }
  }

  const upd = (i: number, p: Partial<Regola>) => setRegole(rs => rs.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const sposta = (i: number, d: -1 | 1) => setRegole(rs => {
    const j = i + d; if (j < 0 || j >= rs.length) return rs;
    const c = [...rs]; [c[i], c[j]] = [c[j]!, c[i]!]; return c;
  });

  return (
    <div>
      <PageHeader
        back={{ label: 'Fatturazione', href: '/fatturazione' }}
        title="Impostazioni fatturazione"
        badge={!manage ? <StatusBadge tone="neutral">Sola lettura</StatusBadge> : undefined}
      />
      {error && <div className="mb-4 rounded-ctl bg-danger-soft p-3 text-sm text-danger">{error}</div>}

      <Tabs tabs={SCHEDE} value={tab} onChange={setTab} labels={ETICHETTE} />

      {loading ? (
        <div className="card space-y-3"><Skeleton className="h-5 w-1/3" /><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
      ) : (
        <>
          {tab === 'regole' && (
            <div className="space-y-4">
              <p className="text-sm text-muted">Parole separate da virgola = alternative. @NOME = gruppo di parole.</p>
              {regole.length === 0 && <div className="card"><EmptyState title="Nessuna regola" /></div>}
              {regole.map((r, i) => (
                <RegolaEditor key={r.id ?? `n${i}`} regola={r} manage={manage}
                  onChange={p => upd(i, p)}
                  onSu={i > 0 ? () => sposta(i, -1) : undefined}
                  onGiu={i < regole.length - 1 ? () => sposta(i, 1) : undefined}
                  onElimina={() => setRegole(rs => rs.filter((_, k) => k !== i))} />
              ))}
              {manage && (
                <div className="flex gap-2">
                  <button className="btn-secondary" onClick={() => setRegole(rs => [...rs, nuovaRegola()])}>+ Regola</button>
                  <button className="btn-primary" disabled={saving}
                    onClick={() => salva(async () => setRegole(await api.put<Regola[]>('/api/fatturazione/regole', { regole: regole.map(pulisciRegola) })), 'Regole salvate')}>
                    Salva regole
                  </button>
                </div>
              )}
            </div>
          )}

          {tab === 'gruppi' && (
            <div className="card max-w-3xl space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-ink-700">Gruppi di parole</h2>
              </div>
              {gruppi.length === 0 && <EmptyState title="Nessun gruppo" />}
              {gruppi.map((g, i) => (
                <div key={i} className="flex gap-2">
                  <input className="input !w-40" placeholder="NOME" aria-label="Nome gruppo" value={g.nome} disabled={!manage}
                    onChange={e => setGruppi(gs => gs.map((x, k) => (k === i ? { ...x, nome: e.target.value } : x)))} />
                  <input className="input flex-1" placeholder="parole, separate da virgola" aria-label="Parole del gruppo" value={g.parole.join(', ')} disabled={!manage}
                    onChange={e => setGruppi(gs => gs.map((x, k) => (k === i ? { ...x, parole: e.target.value.split(',').map(s => s.trimStart()) } : x)))} />
                  {manage && <button className="btn-secondary !px-3" aria-label="Elimina gruppo" onClick={() => setGruppi(gs => gs.filter((_, k) => k !== i))}>×</button>}
                </div>
              ))}
              {manage && (
                <div className="flex gap-2">
                  <button className="btn-secondary" onClick={() => setGruppi(gs => [...gs, { nome: '', parole: [] }])}>+ Gruppo</button>
                  <button className="btn-primary" disabled={saving}
                    onClick={() => salva(async () => { await api.put('/api/fatturazione/gruppi', { gruppi: gruppi.map(g => ({ nome: g.nome.trim(), parole: g.parole.map(s => s.trim()).filter(Boolean) })) }); }, 'Gruppi salvati')}>
                    Salva gruppi
                  </button>
                </div>
              )}
            </div>
          )}

          {tab === 'prova' && (
            <div className="max-w-3xl space-y-4">
              <div className="card space-y-3">
                <h2 className="text-sm font-semibold text-ink-700">Clienti (conti) da fatturare</h2>
                <div>
                  <label className="label">Conti separati da virgola (es. C558)</label>
                  <input className="input max-w-sm" value={conti} onChange={e => setConti(e.target.value)} disabled={!manage} />
                </div>
                {manage && (
                  <div>
                    <button className="btn-primary" disabled={saving}
                      onClick={() => salva(async () => { await api.put('/api/fatturazione/conti', { conti: lista(conti) }); }, 'Conti salvati')}>Salva conti</button>
                  </div>
                )}
              </div>

              <div className="card space-y-3">
                <div>
                  <h2 className="text-sm font-semibold text-ink-700">Prova</h2>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="w-40"><label className="label">Codice</label><input className="input" value={pArt} onChange={e => setPArt(e.target.value)} /></div>
                  <div className="min-w-[14rem] flex-1"><label className="label">Descrizione dell&apos;ordine di vendita</label><input className="input" value={pDesc} onChange={e => setPDesc(e.target.value)} /></div>
                  <button className="btn-primary" disabled={saving || !pArt.trim()}
                    onClick={() => salva(async () => setProva(await api.post<Prova>('/api/fatturazione/prova', { article_code: pArt.trim(), descrizione: pDesc })), 'Calcolato')}>Calcola</button>
                </div>
                {prova && (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span>Totale: <b>{eur(prova.totale)}</b></span>
                    {prova.applicate.length === 0
                      ? <StatusBadge tone="warning">Nessuna regola applicata</StatusBadge>
                      : prova.applicate.map(a => <StatusBadge key={a.id} tone="success">{a.nome} ({eur(a.prezzo)})</StatusBadge>)}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
