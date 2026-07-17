'use client';

import { useState } from 'react';
import type { QualitaReport } from '@/types';
import { PALETTE } from '../palette';
import { TintedDrawing } from '../TintedDrawing';

const BACKEND = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : (process.env.INTERNAL_API_URL ?? 'http://backend:3001');

const SEVERITY_LABELS: Record<string, string> = { bassa: 'Bassa', media: 'Media', alta: 'Alta' };

function fmtDateTime(ts: string): string {
  return new Date(ts).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function BaseImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="w-full aspect-[4/3] flex flex-col items-center justify-center gap-2 text-gray-300">
        <span className="text-4xl">🖼️</span>
        <p className="text-sm text-gray-400">Immagine non disponibile</p>
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} onError={() => setFailed(true)} className="w-full h-auto block" />;
}

function PhotoThumb({ src, tablet }: { src: string; tablet?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <a href={src} target="_blank" rel="noopener noreferrer" className="inline-block mt-1">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Foto difetto"
        onError={() => setFailed(true)}
        className={`${tablet ? 'w-28 h-28' : 'w-16 h-16'} object-cover rounded border border-gray-200 hover:opacity-80 transition-opacity`}
      />
    </a>
  );
}

export function OverlayViewer({ componentId, componentName, reports, tablet = false }: {
  componentId:   number;
  componentName: string;
  reports:       QualitaReport[];
  tablet?:       boolean;
}) {
  const [visible, setVisible] = useState<Set<number>>(new Set(reports.map(r => r.id)));

  function toggle(id: number) {
    setVisible(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const imageUrl = `${BACKEND}/api/qualita/components/${componentId}/image`;

  return (
    <div className="card">
      <h2 className={`font-semibold text-gray-800 mb-4 ${tablet ? 'text-xl' : ''}`}>
        {componentName} — {reports.length} segnalazion{reports.length === 1 ? 'e' : 'i'}
      </h2>

      <div className={`grid grid-cols-1 ${tablet ? 'lg:grid-cols-[1fr_420px]' : 'lg:grid-cols-[1fr_280px]'} gap-6`}>
        <div className="relative w-full bg-gray-100 border border-gray-200 rounded-lg overflow-hidden">
          <BaseImage src={imageUrl} alt={componentName} />
          {reports.map((r, i) => visible.has(r.id) && (
            <TintedDrawing
              key={r.id}
              src={`${BACKEND}/api/qualita/reports/${r.id}/drawing`}
              color={PALETTE[i % PALETTE.length]}
            />
          ))}
        </div>

        <div className={`space-y-3 ${tablet ? 'max-h-[44rem]' : 'max-h-[32rem]'} overflow-y-auto pr-1`}>
          {reports.map((r, i) => (
            <label key={r.id} className={`flex items-start gap-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 ${tablet ? 'p-4' : 'p-3'}`}>
              <input
                type="checkbox"
                checked={visible.has(r.id)}
                onChange={() => toggle(r.id)}
                className={tablet ? 'mt-1 w-6 h-6' : 'mt-1 w-4 h-4'}
              />
              <span
                className={`rounded-full shrink-0 ${tablet ? 'w-4 h-4 mt-2' : 'w-3 h-3 mt-1.5'}`}
                style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
              />
              <div className={`min-w-0 ${tablet ? 'text-base' : 'text-sm'}`}>
                <p className="font-medium text-gray-800">{fmtDateTime(r.created_at)}</p>
                <p className={tablet ? 'text-sm text-gray-500' : 'text-xs text-gray-500'}>{r.created_by_name ?? 'Sconosciuto'}</p>
                {(r.defect_type || r.severity) && (
                  <p className={`text-gray-600 mt-1 ${tablet ? 'text-sm' : 'text-xs'}`}>
                    {r.defect_type}
                    {r.defect_type && r.severity ? ' — ' : ''}
                    {r.severity && <span className="font-medium">{SEVERITY_LABELS[r.severity]}</span>}
                  </p>
                )}
                {r.note && <p className={`text-gray-500 mt-1 whitespace-pre-wrap ${tablet ? 'text-sm' : 'text-xs'}`}>{r.note}</p>}
                {r.photo_path && (
                  <PhotoThumb src={`${BACKEND}/api/qualita/reports/${r.id}/photo`} tablet={tablet} />
                )}
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
