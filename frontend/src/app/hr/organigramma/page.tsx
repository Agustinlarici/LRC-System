'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import type { HrOrgNode, HrDepartment } from '@/types';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

// Stessa palette usata in Analisi HR/Evoluzione — un colore stabile per reparto,
// così una persona ha lo stesso colore ovunque nel modulo HR.
const PALETTE = ['#2563eb', '#8b5cf6', '#f59e0b', '#10b981', '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#84cc16', '#ef4444'];

interface TreeNode extends HrOrgNode { children: TreeNode[]; }

function buildTree(nodes: HrOrgNode[]): TreeNode[] {
  const byId = new Map<number, TreeNode>(nodes.map(n => [n.id, { ...n, children: [] }]));
  const roots: TreeNode[] = [];
  for (const n of byId.values()) {
    if (n.capo_id != null && byId.has(n.capo_id)) byId.get(n.capo_id)!.children.push(n);
    else roots.push(n);
  }
  const sortByName = (a: TreeNode, b: TreeNode) => a.cognome.localeCompare(b.cognome);
  const sortRec = (list: TreeNode[]) => { list.sort(sortByName); list.forEach(n => sortRec(n.children)); };
  sortRec(roots);
  return roots;
}

// Ritorna l'insieme di id da tenere espansi per mostrare tutti i match di ricerca
function ancestorsOf(nodes: HrOrgNode[], matchIds: Set<number>): Set<number> {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const result = new Set<number>();
  for (const id of matchIds) {
    let cur = byId.get(id);
    while (cur?.capo_id != null) { result.add(cur.capo_id); cur = byId.get(cur.capo_id); }
  }
  return result;
}

function initials(nome: string, cognome: string): string {
  return `${nome[0] ?? ''}${cognome[0] ?? ''}`.toUpperCase();
}

// ─── Nodo dell'albero visivo ────────────────────────────────────────────────

function OrgCard({ node, deptColor, expanded, toggle, matches, selectedId, onSelect }: {
  node: TreeNode; deptColor: string; expanded: Set<number>; toggle: (id: number) => void;
  matches: Set<number>; selectedId: number | null; onSelect: (id: number) => void;
}) {
  const isOpen = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const isMatch = matches.has(node.id);
  const isSelected = selectedId === node.id;

  return (
    <li>
      <div className="relative">
        <div
          onClick={() => onSelect(node.id)}
          className={`org-node inline-flex flex-col items-center gap-1 bg-white border-2 rounded-xl px-3.5 py-3 min-w-[140px] cursor-pointer shadow-sm transition-all hover:shadow-md
            ${isSelected ? 'border-blue-500 ring-2 ring-blue-100' : isMatch ? 'border-amber-400' : 'border-gray-200'}`}
        >
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0"
            style={{ background: deptColor }}
          >
            {initials(node.nome, node.cognome)}
          </div>
          <p className={`text-sm font-medium whitespace-nowrap ${isMatch ? 'text-amber-700' : 'text-gray-800'}`}>{node.cognome} {node.nome}</p>
          {node.mansione && <p className="text-[11px] text-gray-400 whitespace-nowrap -mt-0.5">{node.mansione}</p>}
          {node.stato !== 'attivo' && <span className="text-[10px] text-amber-600 font-medium">{node.stato}</span>}
        </div>

        {hasChildren && (
          <button
            onClick={(e) => { e.stopPropagation(); toggle(node.id); }}
            title={isOpen ? 'Comprimi' : `Espandi (${node.children.length})`}
            className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-white border border-gray-300 text-[10px] font-medium
              flex items-center justify-center text-gray-500 hover:border-blue-400 hover:text-blue-600 shadow-sm transition-colors"
          >
            {isOpen ? '−' : node.children.length}
          </button>
        )}
      </div>

      {isOpen && hasChildren && (
        <ul>
          {node.children.map(c => (
            <OrgCard key={c.id} node={c} deptColor={deptColor} expanded={expanded} toggle={toggle} matches={matches} selectedId={selectedId} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function OrganigrammaPage() {
  const [nodes, setNodes] = useState<HrOrgNode[]>([]);
  const [departments, setDepartments] = useState<HrDepartment[]>([]);
  const [repartoFilter, setRepartoFilter] = useState<number | ''>('');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (repartoFilter) params.set('reparto_id', String(repartoFilter));
    const [nodesRes, depRes] = await Promise.all([
      fetch(`${BACKEND}/api/hr/org-chart?${params}`, { credentials: 'include' }),
      fetch(`${BACKEND}/api/hr/departments`, { credentials: 'include' }),
    ]);
    if (nodesRes.ok) setNodes(await nodesRes.json());
    if (depRes.ok) setDepartments(await depRes.json());
    setLoading(false);
  }, [repartoFilter]);

  useEffect(() => { load(); }, [load]);

  const tree = useMemo(() => buildTree(nodes), [nodes]);
  const byId = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);

  // Colore stabile per reparto, basato sull'elenco reparti (non sull'ordine dei nodi)
  const deptColorMap = useMemo(() => {
    const sorted = [...departments].sort((a, b) => a.name.localeCompare(b.name));
    const map = new Map<string, string>();
    sorted.forEach((d, i) => map.set(d.name, PALETTE[i % PALETTE.length]));
    return map;
  }, [departments]);
  const colorFor = useCallback((n: HrOrgNode) =>
    (n.reparto_name && deptColorMap.get(n.reparto_name)) || '#94a3b8', [deptColorMap]);

  // Default: radici + primo livello espansi, il resto comprimibile a scoperta
  useEffect(() => {
    if (nodes.length === 0) return;
    const initial = new Set<number>();
    for (const root of buildTree(nodes)) {
      initial.add(root.id);
      for (const child of root.children) initial.add(child.id);
    }
    setExpanded(initial);
  }, [nodes]);

  const matchIds = useMemo(() => {
    if (!search) return new Set<number>();
    return new Set(nodes.filter(n => `${n.nome} ${n.cognome}`.toLowerCase().includes(search.toLowerCase())).map(n => n.id));
  }, [nodes, search]);

  useEffect(() => {
    if (search) setExpanded(prev => new Set([...prev, ...ancestorsOf(nodes, matchIds)]));
  }, [search, matchIds, nodes]);

  function toggle(id: number) {
    setExpanded(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  function expandAll() { setExpanded(new Set(nodes.map(n => n.id))); }
  function collapseAll() {
    setExpanded(new Set(tree.map(r => r.id))); // resta visibile almeno il primo livello (i responsabili)
  }

  const selected = selectedId != null ? byId.get(selectedId) : null;
  const superiors = useMemo(() => {
    if (!selected) return [];
    const chain: HrOrgNode[] = [];
    let cur = selected;
    while (cur.capo_id != null && byId.has(cur.capo_id)) { cur = byId.get(cur.capo_id)!; chain.push(cur); }
    return chain;
  }, [selected, byId]);
  const directReports = useMemo(() => selected ? nodes.filter(n => n.capo_id === selected.id) : [], [selected, nodes]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-medium text-gray-900">Organigramma</h1>
        <p className="text-xs text-gray-400 mt-0.5">Struttura organizzativa: dipendente → responsabile → manager → direzione</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <input type="text" placeholder="Cerca una persona…" value={search} onChange={e => setSearch(e.target.value)} className="input text-sm w-64" />
        <select value={repartoFilter} onChange={e => setRepartoFilter(e.target.value ? Number(e.target.value) : '')} className="input text-sm">
          <option value="">Tutti i reparti</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <button onClick={expandAll} className="btn-secondary text-xs">Espandi tutto</button>
        <button onClick={collapseAll} className="btn-secondary text-xs">Comprimi tutto</button>

        {departments.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap ml-auto text-[11px] text-gray-500">
            {[...departments].sort((a, b) => a.name.localeCompare(b.name)).map(d => (
              <span key={d.id} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: deptColorMap.get(d.name) }} />
                {d.name}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-start">
        <div className="card lg:col-span-3 overflow-x-auto overflow-y-hidden py-8">
          {loading ? (
            <p className="text-sm text-gray-400 text-center py-12">Caricamento…</p>
          ) : tree.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-12">Nessun dipendente trovato</p>
          ) : (
            <ul className="org-tree mx-auto w-max">
              {tree.map(n => (
                <OrgCard key={n.id} node={n} deptColor={colorFor(n)} expanded={expanded} toggle={toggle} matches={matchIds} selectedId={selectedId} onSelect={setSelectedId} />
              ))}
            </ul>
          )}
        </div>

        <div className="card lg:sticky lg:top-4">
          {!selected ? (
            <p className="text-sm text-gray-400 text-center py-12">Seleziona una persona dall&apos;organigramma per vedere dove si trova nella struttura</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0" style={{ background: colorFor(selected) }}>
                  {initials(selected.nome, selected.cognome)}
                </div>
                <div>
                  <p className="text-base font-medium text-gray-900">{selected.cognome} {selected.nome}</p>
                  <p className="text-xs text-gray-400">{selected.mansione ?? 'Mansione non specificata'} {selected.reparto_name ? `· ${selected.reparto_name}` : ''}</p>
                </div>
              </div>
              <Link href={`/hr/dipendenti/${selected.id}`} className="btn-secondary text-sm inline-block">Vedi ficha completa →</Link>

              {superiors.length > 0 && (
                <div>
                  <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">Catena superiori</p>
                  <div className="space-y-1">
                    {superiors.map((s, i) => (
                      <div key={s.id} className="flex items-center gap-1.5 text-sm">
                        <span className="text-gray-300">{'  '.repeat(i)}↑</span>
                        <button onClick={() => setSelectedId(s.id)} className="btn-secondary text-xs">{s.cognome} {s.nome}</button>
                        {s.mansione && <span className="text-xs text-gray-400">— {s.mansione}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">
                  Team diretto ({directReports.length})
                </p>
                {directReports.length === 0 ? (
                  <p className="text-xs text-gray-400">Nessun riporto diretto</p>
                ) : (
                  <div className="space-y-1">
                    {directReports.map(r => (
                      <button key={r.id} onClick={() => setSelectedId(r.id)} className="btn-secondary text-xs flex items-center gap-1.5 w-full text-left">
                        <span>↳</span> {r.cognome} {r.nome} {r.mansione && <span className="text-xs text-gray-400">— {r.mansione}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
