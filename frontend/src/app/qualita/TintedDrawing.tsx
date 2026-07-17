'use client';

import { useState, useEffect, useRef } from 'react';

// Ricolora il disegno (tratti su sfondo trasparente) nel colore assegnato,
// disegnandolo su un <canvas> invece di usare mask-image CSS — mask-image ha
// comportamento incoerente tra browser (alpha vs luminance, prefissi -webkit-),
// mentre "source-in" su canvas è supportato ovunque e dà un risultato prevedibile.
export function TintedDrawing({ src, color, opacity = 0.85, className }: {
  src:        string;
  color:      string;
  opacity?:   number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    // Nessun crossOrigin: il canvas risulta "tainted" per la lettura pixel (getImageData/
    // toDataURL), ma disegnare (drawImage/composite) e mostrarlo a schermo funziona comunque
    // — e i cookie di sessione vengono comunque inviati, come per un <img> normale.
    const img = new window.Image();
    img.onload = () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      setReady(true);
    };
    img.src = src;
    return () => { cancelled = true; };
  }, [src, color]);

  return (
    <canvas
      ref={canvasRef}
      className={className ?? 'absolute inset-0 w-full h-full pointer-events-none'}
      style={{ opacity: ready ? opacity : 0 }}
    />
  );
}
