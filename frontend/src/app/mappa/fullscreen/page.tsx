'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api } from '@/lib/api';

type ColorState = 'verde' | 'giallo' | 'rosso' | 'grigio';
type ShapeState = { type: 'monitor' | 'buffer'; color: ColorState; count?: number };

const COLOR_MAP: Record<ColorState, string> = {
  verde:  '#22c55e',
  giallo: '#eab308',
  rosso:  '#ef4444',
  grigio: '#d1d5db',
};

const SHAPE_CELL_IDS: Record<string, string> = {
  'F171VS':   'H0EV9G83akpB2cg57h1L-1',
  'F173M':    'H0EV9G83akpB2cg57h1L-2',
  'F171':     'H0EV9G83akpB2cg57h1L-3',
  'F175':     'H0EV9G83akpB2cg57h1L-4',
  'F169':     'H0EV9G83akpB2cg57h1L-5',
  'F167':     'H0EV9G83akpB2cg57h1L-6',
  'DELIBERA': 'H0EV9G83akpB2cg57h1L-7',
  'ATC3':     'H0EV9G83akpB2cg57h1L-23',
  '8CIL':     'H0EV9G83akpB2cg57h1L-24',
};

function buildColorStyle(stati: Record<string, ShapeState>): string {
  const rules = Object.entries(SHAPE_CELL_IDS).map(([tag, cellId]) => {
    const state = stati[tag];
    const color = state ? COLOR_MAP[state.color] : '#ffffff';
    return `[data-cell-id="${cellId}"] g > rect { fill: ${color} !important; }`;
  });
  return `<style>${rules.join(' ')}</style>`;
}

function injectIntoSvg(raw: string, colorStyle: string): string {
  let svg = raw
    .replace(/(<svg[^>]*)\s+width="[^"]*"/, '$1')
    .replace(/(<svg[^>]*)\s+height="[^"]*"/, '$1');
  const bgRect = '<rect width="100%" height="100%" fill="white"/>';
  svg = svg.replace(/<g>/, `${bgRect}<g>`);
  svg = svg.replace('</svg>', `${colorStyle}</svg>`);
  return svg;
}

export default function MappaFullscreenPage() {
  const [rawSvg,   setRawSvg]   = useState('');
  const [stati,    setStati]    = useState<Record<string, ShapeState>>({});
  const [showHint, setShowHint] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { document.title = 'Mappa Fullscreen — STR'; }, []);

  useEffect(() => {
    fetch('/mappa.svg').then(r => r.text()).then(setRawSvg).catch(console.error);
    const t = setTimeout(() => setShowHint(false), 4_000);
    return () => clearTimeout(t);
  }, []);

  const fetchStati = useCallback(async () => {
    try {
      const data = await api.get<Record<string, ShapeState>>('/api/mappa/stati');
      setStati(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchStati();
    const interval = setInterval(fetchStati, 5_000);
    function onVisible() { if (document.visibilityState === 'visible') fetchStati(); }
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, [fetchStati]);

  const svgHtml = useMemo(() => {
    if (!rawSvg) return '';
    return injectIntoSvg(rawSvg, buildColorStyle(stati));
  }, [rawSvg, stati]);

  // Inject buffer count numbers into SVG shapes after render
  useEffect(() => {
    if (!containerRef.current || !svgHtml) return;
    // Remove existing buffer count texts
    containerRef.current.querySelectorAll('.buffer-count-text').forEach(el => el.remove());

    for (const [tag, state] of Object.entries(stati)) {
      if (state.type !== 'buffer' || state.count === undefined) continue;
      const cellId = SHAPE_CELL_IDS[tag];
      if (!cellId) continue;
      const g = containerRef.current.querySelector(`[data-cell-id="${cellId}"] g`);
      if (!g) continue;
      const rect = g.querySelector('rect');
      if (!rect) continue;
      const x = parseFloat(rect.getAttribute('x') || '0');
      const y = parseFloat(rect.getAttribute('y') || '0');
      const w = parseFloat(rect.getAttribute('width') || '0');
      const h = parseFloat(rect.getAttribute('height') || '0');
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', String(x + w / 2));
      text.setAttribute('y', String(y + h / 2 + 8));
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('fill', 'white');
      text.setAttribute('font-size', String(Math.min(h * 0.5, 28)));
      text.setAttribute('font-weight', 'bold');
      text.setAttribute('pointer-events', 'none');
      text.setAttribute('class', 'buffer-count-text');
      text.textContent = String(state.count);
      g.appendChild(text);
    }
  }, [svgHtml, stati]);

  return (
    <div className="fixed inset-0 z-[9999] bg-white flex flex-col">
      <button
        onClick={() => window.close()}
        className="absolute top-4 right-4 z-10 bg-black/20 hover:bg-black/40 text-white rounded-full w-10 h-10 flex items-center justify-center text-lg transition-all"
        title="Chiudi"
      >
        ✕
      </button>

      <div className={`absolute top-4 left-1/2 -translate-x-1/2 z-10 bg-black/50 text-white text-sm px-4 py-2 rounded-full transition-opacity duration-500 ${showHint ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        Schermo intero — premi ✕ per uscire
      </div>

      <div
        ref={containerRef}
        className="flex-1 overflow-hidden"
        style={{ paddingBottom: 52 }}
        dangerouslySetInnerHTML={{ __html: svgHtml || '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#9ca3af">Caricamento...</div>' }}
      />

      <div className="absolute bottom-0 inset-x-0 h-13 flex items-center justify-center gap-6 bg-white/90 backdrop-blur border-t border-gray-100 py-2 px-4">
        {([
          { color: '#22c55e', label: 'In tempo' },
          { color: '#eab308', label: 'Attenzione' },
          { color: '#ef4444', label: 'In ritardo' },
          { color: '#d1d5db', label: 'Fuori turno' },
        ] as const).map(it => (
          <div key={it.label} className="flex items-center gap-1.5 text-sm text-gray-700">
            <span className="inline-block w-4 h-4 rounded-sm border border-gray-300 shrink-0" style={{ background: it.color }} />
            {it.label}
          </div>
        ))}
      </div>
    </div>
  );
}
