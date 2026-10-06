'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import type { HrOrgNode, HrCapoPair } from '@/types';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

// Stessa palette usata in Analisi HR/Evoluzione — un colore stabile per funzione aziendale,
// così una persona ha lo stesso colore ovunque nel modulo HR.
const PALETTE = ['#2563eb', '#8b5cf6', '#f59e0b', '#10b981', '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#84cc16', '#ef4444'];

// Un "nodo" può rappresentare due persone insieme: una coppia di co-responsabili
// configurata esplicitamente (stesso team), mostrate affiancate in un unico box
// invece che separate — vedi "Gestisci coppie di co-responsabili" in pagina.
// Con "Dividi per mansione" i nodi foglia sotto un responsabile vengono raccolti in
// nodi-gruppo (mansione valorizzata): un box con il titolo della mansione e l'elenco dei nomi.
interface TreeNode { people: HrOrgNode[]; children: TreeNode[]; mansione?: string; grid?: boolean; }

// Oltre questa soglia le persone senza riporti di uno stesso responsabile vengono
// messe in un unico blocco a griglia, invece di una lunghissima riga orizzontale.
const GRID_THRESHOLD = 6;
const GRID_COLS = 6;

function groupLeavesInGrid(list: TreeNode[]): TreeNode[] {
  list.forEach(n => { n.children = groupLeavesInGrid(n.children); });
  const isLeaf = (n: TreeNode) => n.children.length === 0 && n.people.length === 1;
  const leaves = list.filter(isLeaf);
  if (leaves.length <= GRID_THRESHOLD) return list;
  const grid: TreeNode = { people: leaves.map(l => l.people[0]), children: [], grid: true };
  return [...list.filter(n => !isLeaf(n)), grid];
}

function groupLeavesByMansione(list: TreeNode[]): TreeNode[] {
  list.forEach(n => { n.children = groupLeavesByMansione(n.children); });
  const isLeaf = (n: TreeNode) => n.children.length === 0 && n.people.length === 1;
  const leaves = list.filter(isLeaf);
  if (leaves.length === 0) return list;
  const byMansione = new Map<string, HrOrgNode[]>();
  for (const l of leaves) {
    const key = l.people[0].mansione?.trim() || 'Senza mansione';
    byMansione.set(key, [...(byMansione.get(key) ?? []), l.people[0]]);
  }
  const groups: TreeNode[] = [...byMansione.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mansione, people]) => ({ mansione, people: people.sort((a, b) => a.cognome.localeCompare(b.cognome)), children: [] }));
  return [...list.filter(n => !isLeaf(n)), ...groups];
}

function buildTree(nodes: HrOrgNode[], pairs: HrCapoPair[]): TreeNode[] {
  const byId = new Map<number, HrOrgNode>(nodes.map(n => [n.id, n]));

  // Ogni persona appartiene al proprio gruppo: se fa parte di una coppia configurata
  // (e il partner è visibile con gli stessi filtri) il gruppo è [lei, partner].
  const groupOf = new Map<number, number[]>();
  for (const n of nodes) groupOf.set(n.id, [n.id]);
  for (const p of pairs) {
    if (!byId.has(p.employee_a_id) || !byId.has(p.employee_b_id)) continue;
    groupOf.set(p.employee_a_id, [p.employee_a_id, p.employee_b_id]);
    groupOf.set(p.employee_b_id, [p.employee_a_id, p.employee_b_id]);
  }

  // Un ciclo nei responsabili (A → B → A) non deve rompere l'albero né bloccare la pagina:
  // solo chi fa parte del ciclo diventa radice; chi sta sotto resta collegato normalmente.
  const inCycle = (startId: number, firstCapo: number): boolean => {
    const seen = new Set<number>();
    let cur: number | null = firstCapo;
    while (cur != null && !seen.has(cur)) {
      if (cur === startId) return true;
      seen.add(cur);
      cur = byId.get(cur)?.capo_id ?? null;
    }
    return false;
  };

  const treeNodeOf = new Map<number, TreeNode>();
  const roots: TreeNode[] = [];
  const handled = new Set<number>();

  function nodeFor(id: number): TreeNode {
    const existing = treeNodeOf.get(id);
    if (existing) return existing;
    const group = groupOf.get(id) ?? [id];
    const people = group.map(gid => byId.get(gid)!).sort((a, b) => a.cognome.localeCompare(b.cognome));
    const tn: TreeNode = { people, children: [] };
    for (const gid of group) treeNodeOf.set(gid, tn);
    return tn;
  }

  for (const n of nodes) {
    if (handled.has(n.id)) continue;
    const group = groupOf.get(n.id) ?? [n.id];
    group.forEach(id => handled.add(id));

    const tn = nodeFor(n.id);
    // Posizionamento nell'albero: il capo del primo membro del gruppo che ne ha uno
    const anchor = group.find(gid => byId.get(gid)?.capo_id != null) ?? group[0];
    const capo = byId.get(anchor)?.capo_id ?? null;
    if (capo != null && byId.has(capo) && !group.includes(capo) && !inCycle(anchor, capo)) {
      nodeFor(capo).children.push(tn);
    } else {
      roots.push(tn);
    }
  }

  const sortByName = (a: TreeNode, b: TreeNode) => a.people[0].cognome.localeCompare(b.people[0].cognome);
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
  // L'id del nodo ai fini di espandi/comprimi è quello del primo membro — stabile
  // finché il cluster di co-responsabili resta lo stesso.
  const nodeId = node.people[0].id;
  if (node.grid) {
    return (
      <li>
        <div className="org-node inline-grid bg-gray-200 border-2 border-gray-200 rounded-md shadow-sm overflow-hidden gap-px" style={{ gridTemplateColumns: `repeat(${Math.min(GRID_COLS, node.people.length)}, 78px)` }}>
          {node.people.map(p => {
            const isMatch = matches.has(p.id);
            const isSelected = selectedId === p.id;
            return (
              <div
                key={p.id}
                onClick={() => onSelect(p.id)}
                title={p.mansione ?? undefined}
                className={`flex flex-col items-center gap-0.5 px-1 py-1.5 cursor-pointer bg-white hover:bg-gray-50 ${isSelected ? 'ring-2 ring-inset ring-blue-300' : ''}`}
              >
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[8px] font-semibold shrink-0"
                  style={{ background: colorFor(p), outline: isSelected ? '2px solid #3b82f6' : isMatch ? '2px solid #f59e0b' : undefined }}
                >
                  {initials(p.nome, p.cognome)}
                </div>
                <div className="text-center leading-tight w-full">
                  <p className={`text-[11px] font-medium break-words ${isMatch ? 'text-amber-700' : 'text-gray-800'}`}>{p.cognome}</p>
                  <p className="text-[10px] text-gray-500 break-words">{p.nome}</p>
                </div>
                {p.stato !== 'attivo' && <span className="text-[10px] text-amber-600 font-medium">{p.stato}</span>}
              </div>
            );
          })}
          {Array.from({ length: (GRID_COLS - (node.people.length % GRID_COLS)) % GRID_COLS * (node.people.length > GRID_COLS ? 1 : 0) }, (_, i) => <div key={`pad${i}`} className="bg-white" />)}
        </div>
      </li>
    );
  }
  if (node.mansione !== undefined) {
    return (
      <li>
        <div className="org-node inline-flex flex-col bg-white border-2 border-gray-200 rounded-md shadow-sm w-[130px] text-left">
          <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-wide px-2 py-1 border-b border-gray-200 bg-gray-50 rounded-t break-words">
            {node.mansione} <span className="text-gray-400 font-normal">({node.people.length})</span>
          </p>
          <div className="py-1">
            {node.people.map(p => {
              const isSelected = selectedId === p.id;
              return (
                <div
                  key={p.id}
                  onClick={() => onSelect(p.id)}
                  className={`flex items-center gap-1.5 px-2 py-0.5 cursor-pointer hover:bg-gray-50 ${isSelected ? 'bg-blue-50' : ''}`}
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: colorFor(p) }} />
                  <span className={`text-[11px] leading-tight break-words ${matches.has(p.id) ? 'text-amber-700 font-medium' : 'text-gray-800'}`}>
                    {p.cognome} {p.nome}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </li>
    );
  }
  const isOpen = expanded.has(nodeId);
  const hasChildren = node.children.length > 0;
  const isCluster = node.people.length > 1;

  return (
    <li>
      <div className="relative">
        <div
          title={node.people.map(p => p.mansione).filter(Boolean).join(' · ') || undefined}
          className={`org-node inline-flex bg-white border-2 border-gray-200 rounded-md shadow-sm transition-all hover:shadow-md
            ${isCluster ? '' : 'flex-col items-center px-1 py-1.5 w-[78px] gap-0.5'}`}
        >
          {node.people.map((p, i) => {
            const isMatch = matches.has(p.id);
            const isSelected = selectedId === p.id;
            return (
              <div
                key={p.id}
                onClick={() => onSelect(p.id)}
                className={`flex flex-col items-center gap-0.5 cursor-pointer rounded
                  ${isCluster ? `px-1 py-1.5 w-[78px] ${i > 0 ? 'border-l border-gray-200' : ''}` : ''}
                  ${isSelected ? 'ring-2 ring-blue-200' : ''}`}
              >
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[8px] font-semibold shrink-0"
                  style={{ background: colorFor(p), outline: isSelected ? '2px solid #3b82f6' : isMatch ? '2px solid #f59e0b' : undefined }}
                >
                  {initials(p.nome, p.cognome)}
                </div>
                <div className="text-center leading-tight w-full">
                  <p className={`text-[11px] font-medium break-words ${isMatch ? 'text-amber-700' : 'text-gray-800'}`}>{p.cognome}</p>
                  <p className="text-[10px] text-gray-500 break-words">{p.nome}</p>
                </div>
                {p.stato !== 'attivo' && <span className="text-[10px] text-amber-600 font-medium">{p.stato}</span>}
              </div>
            );
          })}
        </div>

        {hasChildren && (
          <button
            onClick={(e) => { e.stopPropagation(); toggle(nodeId); }}
            title={isOpen ? 'Comprimi' : `Espandi (${node.children.length})`}
            className="absolute top-full mt-0.5 left-1/2 -translate-x-1/2 z-20 w-6 h-6 rounded-full bg-white border border-gray-300 text-[11px] font-medium cursor-pointer
              flex items-center justify-center text-gray-500 hover:border-blue-400 hover:text-blue-600 shadow-sm transition-colors"
          >
            {isOpen ? '−' : node.children.length}
          </button>
        )}
      </div>

      {isOpen && hasChildren && (
        <ul>
          {node.children.map(c => (
            <OrgCard key={c.people[0].id} node={c} colorFor={colorFor} expanded={expanded} toggle={toggle} matches={matches} selectedId={selectedId} onSelect={onSelect} />
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
  const [pairs, setPairs] = useState<HrCapoPair[]>([]);

  // Le coppie di co-responsabili si gestiscono dalla ficha del dipendente
  // (campo "Co-responsabile" nella modifica) — qui si leggono solo per disegnarle.
  const load = useCallback(async () => {
    setLoading(true);
    const [orgRes, pairsRes] = await Promise.all([
      fetch(`${BACKEND}/api/hr/org-chart`, { credentials: 'include' }),
      fetch(`${BACKEND}/api/hr/capo-pairs`, { credentials: 'include' }),
    ]);
    if (orgRes.ok) setAllNodes(await orgRes.json());
    if (pairsRes.ok) setPairs(await pairsRes.json());
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

  const [byMansione, setByMansione] = useState(false);
  const tree = useMemo(() => {
    const t = buildTree(viewNodes, pairs);
    return byMansione ? groupLeavesByMansione(t) : groupLeavesInGrid(t);
  }, [viewNodes, pairs, byMansione]);

  // Profondità di ogni persona nell'albero visualizzato (0 = radice) e numero di livelli
  const depthOf = useMemo(() => {
    const m = new Map<number, number>();
    const walk = (list: TreeNode[], d: number) => list.forEach(n => { n.people.forEach(p => m.set(p.id, d)); walk(n.children, d + 1); });
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

  // Stampa solo l'albero attualmente visibile, in orizzontale: lo scala per farlo stare in una pagina A4.
  const treeRef = useRef<HTMLUListElement>(null);
  function handlePrint() {
    const el = treeRef.current;
    if (el) {
      const availW = 1000, availH = 630; // area utile A4 orizzontale a 96dpi, con margini
      el.style.setProperty('--print-zoom', String(Math.min(1, availW / el.scrollWidth, availH / el.scrollHeight)));
    }
    window.print();
  }

  function toggle(id: number) {
    setExpanded(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  const selected = selectedId != null ? byId.get(selectedId) : null;
  // Catena dei responsabili principali verso l'alto (il primo di capo_ids per ciascuno);
  // eventuali co-responsabili allo stesso livello si vedono nel box dell'organigramma.
  const superiors = useMemo(() => {
    if (!selected) return [];
    const chain: HrOrgNode[] = [];
    let cur = selected;
    const seen = new Set<number>([cur.id]);
    while (cur.capo_id != null && byId.has(cur.capo_id) && !seen.has(cur.capo_id)) { cur = byId.get(cur.capo_id)!; seen.add(cur.id); chain.push(cur); }
    return chain;
  }, [selected, byId]);
  const directReports = useMemo(() => selected ? nodes.filter(n => n.capo_id === selected.id) : [], [selected, nodes]);
  // Partner della persona selezionata, se fa parte di una coppia di co-responsabili configurata
  const coCapi = useMemo(() => {
    if (!selected) return [];
    const partnerId = pairs.find(p => p.employee_a_id === selected.id)?.employee_b_id
      ?? pairs.find(p => p.employee_b_id === selected.id)?.employee_a_id;
    if (partnerId == null) return [];
    const partner = byId.get(partnerId);
    return partner ? [partner] : [];
  }, [selected, byId, pairs]);

  return (
    <div className="space-y-4">
      <style>{`@media print { @page { size: A4 landscape; margin: 8mm; } }`}</style>
      <div className="d-print-none flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-medium text-gray-900">Organigramma</h1>
          <p className="text-xs text-gray-400 mt-0.5">Struttura organizzativa: dipendente → responsabile → manager → direzione</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handlePrint} className="btn-primary text-xs">Stampa</button>
          <div className="flex items-center rounded-md border border-gray-300 overflow-hidden text-xs" role="group" aria-label="Vista organigramma">
            {([[false, 'Per persona'], [true, 'Per mansione']] as const).map(([val, label]) => (
              <button
                key={label}
                onClick={() => setByMansione(val)}
                className={`px-3 py-1.5 transition-colors ${byMansione === val ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap d-print-none">
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
        <div className="only-print mb-3">
          <h1 className="text-base font-semibold text-gray-900">
            Organigramma{funzioneFilter ? ` — ${funzioneFilter}` : ''}{search.trim() ? ` — Ricerca: "${search.trim()}"` : ''}
          </h1>
          <p className="text-[11px] text-gray-500">
            {[funzioneFilter && `Funzione: ${funzioneFilter}`, search.trim() && `Persona: ${search.trim()}`, byMansione && 'Vista per mansione'].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="card overflow-x-auto overflow-y-hidden py-6 org-print-area">
          {loading ? (
            <p className="text-sm text-gray-400 text-center py-12">Caricamento…</p>
          ) : tree.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-12">Nessun dipendente trovato</p>
          ) : (
            <ul ref={treeRef} className="org-tree mx-auto w-max org-print-zoom">
              {tree.map(n => (
                <OrgCard key={n.people[0].id} node={n} colorFor={colorFor} expanded={expanded} toggle={toggle} matches={matchIds} selectedId={selectedId} onSelect={setSelectedId} />
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

              {coCapi.length > 0 && (
                <div>
                  <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">Co-responsabile</p>
                  <div className="space-y-1">
                    {coCapi.map(s => (
                      <button key={s.id} onClick={() => setSelectedId(s.id)} className="btn-secondary text-xs flex items-center gap-1.5 w-full text-left">
                        {s.cognome} {s.nome} {s.mansione && <span className="text-xs text-gray-400">— {s.mansione}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}

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
