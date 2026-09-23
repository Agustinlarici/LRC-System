'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import type { HrOrgNode, HrDepartment } from '@/types';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

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

function TreeRow({ node, depth, expanded, toggle, search, selectedId, onSelect }: {
  node: TreeNode; depth: number; expanded: Set<number>; toggle: (id: number) => void;
  search: string; selectedId: number | null; onSelect: (id: number) => void;
}) {
  const isOpen = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const matches = search && `${node.nome} ${node.cognome}`.toLowerCase().includes(search.toLowerCase());

  return (
    <div>
      <div
        onClick={() => onSelect(node.id)}
        style={{ paddingLeft: `${depth * 20}px` }}
        className={`flex items-center gap-2 py-1.5 px-2 rounded-lg cursor-pointer transition-colors ${
          selectedId === node.id ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50'
        }`}
      >
        {hasChildren ? (
          <button onClick={e => { e.stopPropagation(); toggle(node.id); }} className="w-4 h-4 flex items-center justify-center text-gray-400 shrink-0">
            {isOpen ? '▾' : '▸'}
          </button>
        ) : <span className="w-4 shrink-0" />}
        <span className={`text-sm ${matches ? 'font-semibold text-blue-700' : 'text-gray-800'}`}>{node.cognome} {node.nome}</span>
        {node.ruolo && <span className="text-xs text-gray-400">— {node.ruolo}</span>}
        {node.stato !== 'attivo' && <span className="text-[10px] text-amber-600">({node.stato})</span>}
        {node.n_riporti > 0 && <span className="text-[10px] text-gray-300 ml-auto shrink-0">{node.n_riporti} riporti</span>}
      </div>
      {isOpen && node.children.map(c => (
        <TreeRow key={c.id} node={c} depth={depth + 1} expanded={expanded} toggle={toggle} search={search} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </div>
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
  function collapseAll() { setExpanded(new Set()); }

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
        <p className="text-xs text-gray-400 mt-0.5">Struttura organizzativa: dipendente → capo → responsabile → manager → direzione</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <input type="text" placeholder="Cerca una persona…" value={search} onChange={e => setSearch(e.target.value)} className="input text-sm w-64" />
        <select value={repartoFilter} onChange={e => setRepartoFilter(e.target.value ? Number(e.target.value) : '')} className="input text-sm">
          <option value="">Tutti i reparti</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <button onClick={expandAll} className="text-xs text-gray-400 hover:text-gray-600 underline">Espandi tutto</button>
        <button onClick={collapseAll} className="text-xs text-gray-400 hover:text-gray-600 underline">Comprimi tutto</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-2 max-h-[70vh] overflow-y-auto">
          {loading ? (
            <p className="text-sm text-gray-400 text-center py-12">Caricamento…</p>
          ) : tree.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-12">Nessun dipendente trovato</p>
          ) : tree.map(n => (
            <TreeRow key={n.id} node={n} depth={0} expanded={expanded} toggle={toggle} search={search} selectedId={selectedId} onSelect={setSelectedId} />
          ))}
        </div>

        <div className="card">
          {!selected ? (
            <p className="text-sm text-gray-400 text-center py-12">Seleziona una persona dall&apos;organigramma per vedere dove si trova nella struttura</p>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-base font-medium text-gray-900">{selected.cognome} {selected.nome}</p>
                <p className="text-xs text-gray-400">{selected.ruolo ?? 'Ruolo non specificato'} {selected.reparto_name ? `· ${selected.reparto_name}` : ''}</p>
                <Link href={`/hr/dipendenti/${selected.id}`} className="text-xs text-blue-600 hover:underline">Vedi ficha completa →</Link>
              </div>

              {superiors.length > 0 && (
                <div>
                  <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">Catena superiori</p>
                  <div className="space-y-1">
                    {superiors.map((s, i) => (
                      <div key={s.id} className="flex items-center gap-1.5 text-sm">
                        <span className="text-gray-300">{'  '.repeat(i)}↑</span>
                        <button onClick={() => setSelectedId(s.id)} className="text-gray-700 hover:text-blue-600">{s.cognome} {s.nome}</button>
                        {s.ruolo && <span className="text-xs text-gray-400">— {s.ruolo}</span>}
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
                      <button key={r.id} onClick={() => setSelectedId(r.id)} className="flex items-center gap-1.5 text-sm text-gray-700 hover:text-blue-600 w-full text-left">
                        <span>↳</span> {r.cognome} {r.nome} {r.ruolo && <span className="text-xs text-gray-400">— {r.ruolo}</span>}
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
