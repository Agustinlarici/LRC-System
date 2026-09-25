'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import type { HrOrgNode } from '@/types';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

// Stessa palette usata in Analisi HR/Evoluzione — un colore stabile per funzione aziendale,
// così una persona ha lo stesso colore ovunque nel modulo HR.
const PALETTE = ['#2563eb', '#8b5cf6', '#f59e0b', '#10b981', '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#84cc16', '#ef4444'];

interface TreeNode extends HrOrgNode { children: TreeNode[]; }

function buildTree(nodes: HrOrgNode[]): TreeNode[] {
  const byId = new Map<number, TreeNode>(nodes.map(n => [n.id, { ...n, children: [] }]));
  const roots: TreeNode[] = [];
  // Un ciclo nei responsabili (A → B → A) non deve rompere l'albero né bloccare la pagina:
  // solo chi fa parte del ciclo diventa radice; chi sta sotto resta collegato normalmente.
  const inCycle = (n: TreeNode) => {
    const seen = new Set<number>();
    let cur = n.capo_id != null ? byId.get(n.capo_id) : undefined;
    while (cur && !seen.has(cur.id)) {
      if (cur.id === n.id) return true;
      seen.add(cur.id);
      cur = cur.capo_id != null ? byId.get(cur.capo_id) : undefined;
    }
    return false;
  };
  for (const n of byId.values()) {
    if (n.capo_id != null && byId.has(n.capo_id) && !inCycle(n)) byId.get(n.capo_id)!.children.push(n);
    else roots.push(n);
  }
  const sortByName = (a: TreeNode, b: TreeNode) => a.cognome.localeCompare(b.cognome);
  const sortRec = (list: TreeNode[]) => { list.sort(sortByName); list.forEach(n => sortRec(n.children)); };
  sortRec(roots);
  return roots;
}

function initials(nome: string, cognome: string): string {
  return `${nome[0] ?? ''}${cognome[0] ?? ''}`.toUpperCase();
}

// ─── Nodo dell'albero visivo ────────────────────────────────────────────────

function OrgCard({ node, colorFor, expanded, toggle, matches, selectedId, onSelect }: {
  node: TreeNode; colorFor: (n: HrOrgNode) => string; expanded: Set<number>; toggle: (id: number) => void;
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
          title={node.mansione ?? undefined}
          className={`org-node inline-flex flex-col items-center gap-0.5 bg-white border-2 rounded-md px-1 py-1.5 w-[78px] cursor-pointer shadow-sm transition-all hover:shadow-md
            ${isSelected ? 'border-blue-500 ring-2 ring-blue-100' : isMatch ? 'border-amber-400' : 'border-gray-200'}`}
        >
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[8px] font-semibold shrink-0"
            style={{ background: colorFor(node) }}
          >
            {initials(node.nome, node.cognome)}
          </div>
          <div className="text-center leading-tight w-full">
            <p className={`text-[11px] font-medium break-words ${isMatch ? 'text-amber-700' : 'text-gray-800'}`}>{node.cognome}</p>
            <p className="text-[10px] text-gray-500 break-words">{node.nome}</p>
          </div>
          {node.stato !== 'attivo' && <span className="text-[10px] text-amber-600 font-medium">{node.stato}</span>}
        </div>

        {hasChildren && (
          <button
            onClick={(e) => { e.stopPropagation(); toggle(node.id); }}
            title={isOpen ? 'Comprimi' : `Espandi (${node.children.length})`}
            className="absolute -bottom-3 left-1/2 -translate-x-1/2 z-20 w-6 h-6 rounded-full bg-white border border-gray-300 text-[11px] font-medium cursor-pointer
              flex items-center justify-center text-gray-500 hover:border-blue-400 hover:text-blue-600 shadow-sm transition-colors"
          >
            {isOpen ? '−' : node.children.length}
          </button>
        )}
      </div>

      {isOpen && hasChildren && (
        <ul>
          {node.children.map(c => (
            <OrgCard key={c.id} node={c} colorFor={colorFor} expanded={expanded} toggle={toggle} matches={matches} selectedId={selectedId} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function OrganigrammaPage() {
  const [allNodes, setAllNodes] = useState<HrOrgNode[]>([]);
  const [funzioneFilter, setFunzioneFilter] = useState('');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`${BACKEND}/api/hr/org-chart`, { credentials: 'include' });
    if (res.ok) setAllNodes(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Le funzioni aziendali (MANUFACTURING, QUALITA'…) vengono dai dati stessi, non da un catalogo
  const funzioni = useMemo(
    () => Array.from(new Set(allNodes.map(n => n.funzione_aziendale).filter((f): f is string => !!f))).sort((a, b) => a.localeCompare(b)),
    [allNodes],
  );
  const nodes = useMemo(
    () => (funzioneFilter ? allNodes.filter(n => n.funzione_aziendale === funzioneFilter) : allNodes),
    [allNodes, funzioneFilter],
  );
  const byId = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);

  // Colore stabile per funzione aziendale, basato sull'elenco delle funzioni (non sull'ordine dei nodi)
  const deptColorMap = useMemo(() => {
    const map = new Map<string, string>();
    funzioni.forEach((f, i) => map.set(f, PALETTE[i % PALETTE.length]));
    return map;
  }, [funzioni]);
  // Ogni persona ha il proprio colore: quello della sua funzione aziendale; se non ne ha una
  // (direzione) prende il colore della funzione che guida se è una sola, altrimenti un grigio scuro neutro.
  const colorFor = useCallback((n: HrOrgNode) => {
    if (n.funzione_aziendale && deptColorMap.get(n.funzione_aziendale)) return deptColorMap.get(n.funzione_aziendale)!;
    const childrenOf = new Map<number, HrOrgNode[]>();
    for (const x of nodes) if (x.capo_id != null) childrenOf.set(x.capo_id, [...(childrenOf.get(x.capo_id) ?? []), x]);
    const found = new Set<string>();
    const stack = [...(childrenOf.get(n.id) ?? [])];
    while (stack.length) {
      const x = stack.pop()!;
      if (x.funzione_aziendale && deptColorMap.has(x.funzione_aziendale)) found.add(x.funzione_aziendale);
      stack.push(...(childrenOf.get(x.id) ?? []));
    }
    const colors = [...found].sort().map(name => deptColorMap.get(name)!);
    if (colors.length === 0) return '#94a3b8';
    if (colors.length === 1) return colors[0];
    return '#475569'; // guida più funzioni (es. presidente): colore neutro scuro
  }, [deptColorMap, nodes]);

  const matchIds = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return new Set<number>();
    return new Set(nodes.filter(n => `${n.nome} ${n.cognome}`.toLowerCase().includes(q) || `${n.cognome} ${n.nome}`.toLowerCase().includes(q)).map(n => n.id));
  }, [nodes, search]);

  // Con una ricerca attiva si mostra solo la catena delle persone trovate: i loro responsabili
  // (fino in cima) e tutti quelli che stanno sotto, nient'altro.
  const viewNodes = useMemo(() => {
    if (!search.trim()) return nodes;
    const byNode = new Map(nodes.map(n => [n.id, n]));
    const childrenOf = new Map<number, number[]>();
    for (const n of nodes) if (n.capo_id != null) childrenOf.set(n.capo_id, [...(childrenOf.get(n.capo_id) ?? []), n.id]);
    const keep = new Set<number>();
    for (const id of matchIds) {
      let cur = byNode.get(id);
      while (cur && !keep.has(cur.id)) { keep.add(cur.id); cur = cur.capo_id != null ? byNode.get(cur.capo_id) : undefined; }
      const stack = [...(childrenOf.get(id) ?? [])];
      while (stack.length) {
        const x = stack.pop()!;
        if (keep.has(x)) continue;
        keep.add(x);
        stack.push(...(childrenOf.get(x) ?? []));
      }
    }
    return nodes.filter(n => keep.has(n.id));
  }, [nodes, search, matchIds]);

  const tree = useMemo(() => buildTree(viewNodes), [viewNodes]);

  // Profondità di ogni persona nell'albero visualizzato (0 = radice) e numero di livelli
  const depthOf = useMemo(() => {
    const m = new Map<number, number>();
    const walk = (list: TreeNode[], d: number) => list.forEach(n => { m.set(n.id, d); walk(n.children, d + 1); });
    walk(tree, 0);
    return m;
  }, [tree]);
  const maxLevel = useMemo(() => Math.max(1, ...[...depthOf.values()].map(d => d + 1)), [depthOf]);

  // Livelli: livello N = si vedono le prime N righe dell'albero (99 = tutto). Con una ricerca
  // attiva si mostra tutta la catena trovata.
  const [level, setLevel] = useState(99); // all'apertura è tutto espanso
  const shownLevel = Math.min(level, maxLevel);
  useEffect(() => {
    const all = !!search.trim();
    setExpanded(new Set(viewNodes.filter(n => all || (depthOf.get(n.id) ?? 0) + 1 < level).map(n => n.id)));
  }, [viewNodes, depthOf, level, search]);

  function toggle(id: number) {
    setExpanded(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  const selected = selectedId != null ? byId.get(selectedId) : null;
  const superiors = useMemo(() => {
    if (!selected) return [];
    const chain: HrOrgNode[] = [];
    let cur = selected;
    const seen = new Set<number>([cur.id]);
    while (cur.capo_id != null && byId.has(cur.capo_id) && !seen.has(cur.capo_id)) { cur = byId.get(cur.capo_id)!; seen.add(cur.id); chain.push(cur); }
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
        <select value={funzioneFilter} onChange={e => setFunzioneFilter(e.target.value)} className="input text-sm w-auto">
          <option value="">Tutte le funzioni</option>
          {funzioni.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <button onClick={() => setLevel(99)} className="btn-secondary text-xs">Espandi tutto</button>
        <button onClick={() => setLevel(1)} className="btn-secondary text-xs">Comprimi tutto</button>
        <div className="flex items-center gap-1">
          <button onClick={() => setLevel(Math.max(1, shownLevel - 1))} disabled={shownLevel <= 1} title="Comprimi un livello" className="btn-secondary text-xs disabled:opacity-40">− Livello</button>
          <span className="text-xs text-gray-500 tabular-nums px-1">{shownLevel} / {maxLevel}</span>
          <button onClick={() => setLevel(Math.min(maxLevel, shownLevel + 1))} disabled={shownLevel >= maxLevel} title="Espandi un livello in più" className="btn-secondary text-xs disabled:opacity-40">+ Livello</button>
        </div>

        {funzioni.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap ml-auto text-[11px] text-gray-500">
            {funzioni.map(f => (
              <span key={f} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: deptColorMap.get(f) }} />
                {f}
              </span>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="card overflow-x-auto overflow-y-hidden py-6">
          {loading ? (
            <p className="text-sm text-gray-400 text-center py-12">Caricamento…</p>
          ) : tree.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-12">Nessun dipendente trovato</p>
          ) : (
            <ul className="org-tree mx-auto w-max">
              {tree.map(n => (
                <OrgCard key={n.id} node={n} colorFor={colorFor} expanded={expanded} toggle={toggle} matches={matchIds} selectedId={selectedId} onSelect={setSelectedId} />
              ))}
            </ul>
          )}
        </div>

        {selected && (
          <aside className="fixed top-0 right-0 h-full w-full sm:w-96 bg-white border-l border-gray-200 shadow-2xl z-40 overflow-y-auto p-5 d-print-none">
            <div className="flex justify-end mb-3">
              <button onClick={() => setSelectedId(null)} className="btn-secondary text-sm">Chiudi ×</button>
            </div>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0" style={{ background: colorFor(selected) }}>
                  {initials(selected.nome, selected.cognome)}
                </div>
                <div>
                  <p className="text-base font-medium text-gray-900">{selected.cognome} {selected.nome}</p>
                  <p className="text-xs text-gray-400">{selected.mansione ?? 'Mansione non specificata'} {selected.funzione_aziendale ? `· ${selected.funzione_aziendale}` : ''}</p>
                </div>
              </div>
              <Link href={`/hr/dipendenti/${selected.id}`} className="btn-secondary text-sm inline-block">Vedi scheda completa →</Link>

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
          </aside>
        )}
      </div>
    </div>
  );
}
