'use client';

import { forwardRef, useImperativeHandle, useRef, useState, useCallback } from 'react';

export interface DrawingCanvasHandle {
  exportBlob: () => Promise<Blob | null>;
  undo:       () => void;
  clear:      () => void;
}

interface Point { x: number; y: number; }

const STROKE_COLOR = '#e11d48'; // colore fisso — non persistito, serve solo a rendere visibile il tratto

interface DrawingCanvasProps {
  imageUrl:       string;
  imageAlt:       string;
  /** Altezza massima del riquadro di disegno, in vh — più alta in modalità tablet a schermo intero. */
  maxHeightVh?:   number;
}

export const DrawingCanvas = forwardRef<DrawingCanvasHandle, DrawingCanvasProps>(
  function DrawingCanvas({ imageUrl, imageAlt, maxHeightVh = 70 }, ref) {
    const canvasRef  = useRef<HTMLCanvasElement>(null);
    const strokesRef = useRef<Point[][]>([]);
    const drawingRef = useRef<Point[] | null>(null);
    const [aspect, setAspect] = useState<number | null>(null);
    const [hasStrokes, setHasStrokes] = useState(false);
    const [loadFailed, setLoadFailed] = useState(false);

    const redraw = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = STROKE_COLOR;
      ctx.lineWidth   = Math.max(2, canvas.width / 150);
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      for (const stroke of strokesRef.current) {
        if (stroke.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(stroke[0].x, stroke[0].y);
        for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i].x, stroke[i].y);
        ctx.stroke();
      }
    }, []);

    function handleImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
      const img = e.currentTarget;
      const canvas = canvasRef.current;
      if (!canvas) return;
      setLoadFailed(false);
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      setAspect(img.naturalWidth / img.naturalHeight);
      redraw();
    }

    function toCanvasPoint(e: React.PointerEvent<HTMLCanvasElement>): Point {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width  / rect.width;
      const scaleY = canvas.height / rect.height;
      return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
    }

    function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
      e.currentTarget.setPointerCapture(e.pointerId);
      drawingRef.current = [toCanvasPoint(e)];
    }

    function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
      if (!drawingRef.current) return;
      drawingRef.current.push(toCanvasPoint(e));
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      const pts = drawingRef.current;
      ctx.strokeStyle = STROKE_COLOR;
      ctx.lineWidth   = Math.max(2, canvas.width / 150);
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      ctx.beginPath();
      ctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y);
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      ctx.stroke();
    }

    function handlePointerUp() {
      if (drawingRef.current && drawingRef.current.length > 1) {
        strokesRef.current.push(drawingRef.current);
        setHasStrokes(true);
      }
      drawingRef.current = null;
    }

    useImperativeHandle(ref, () => ({
      exportBlob: () => new Promise((resolve) => {
        const canvas = canvasRef.current;
        if (!canvas) { resolve(null); return; }
        canvas.toBlob((blob) => resolve(blob), 'image/png');
      }),
      undo: () => {
        strokesRef.current.pop();
        setHasStrokes(strokesRef.current.length > 0);
        redraw();
      },
      clear: () => {
        strokesRef.current = [];
        setHasStrokes(false);
        redraw();
      },
    }), [redraw]);

    // Il riquadro mantiene sempre il rapporto naturale dell'immagine (niente distorsioni),
    // ma la larghezza è limitata in modo che l'altezza risultante non superi maxHeightVh —
    // così il disegno occupa il massimo spazio possibile sullo schermo del tablet.
    const wrapperStyle: React.CSSProperties = aspect
      ? { aspectRatio: `${aspect}`, width: '100%', maxWidth: `calc(${maxHeightVh}vh * ${aspect})` }
      : { minHeight: 300 };

    return (
      <div>
        <div
          className="relative mx-auto w-full bg-gray-100 border border-gray-200 rounded-lg overflow-hidden select-none"
          style={wrapperStyle}
        >
          {loadFailed ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 gap-2">
              <span className="text-3xl">🖼️</span>
              <p className="text-sm">Immagine non disponibile</p>
            </div>
          ) : (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt={imageAlt}
                onLoad={handleImageLoad}
                onError={() => setLoadFailed(true)}
                className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                draggable={false}
              />
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full touch-none cursor-crosshair"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
              />
            </>
          )}
        </div>
        {!hasStrokes && !loadFailed && (
          <p className="text-xs text-gray-400 mt-2 text-center">Disegna con il dito o la penna sopra l'immagine per segnare il difetto.</p>
        )}
      </div>
    );
  }
);
