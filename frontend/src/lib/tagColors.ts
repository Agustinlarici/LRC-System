import type { CSSProperties } from 'react';

// Palette fissa per le etichette HR (pallino colorato), applicata via style inline
// e non via classi Tailwind: questo file vive in src/lib, fuori dalle cartelle che
// Tailwind analizza (src/app, src/components, src/pages), quindi classi come
// "bg-red-300" scritte solo qui non verrebbero mai generate nel CSS finale.
// In alternativa si può scegliere un colore libero (vedi isCustomColor sotto),
// salvato come stringa esadecimale ("#a3c9e0") invece che come chiave.
export const TAG_COLOR_OPTIONS = [
  { key: 'gray',   label: 'Grigio',   dot: '#9ca3af', badgeBg: '#f3f4f6', badgeBorder: '#d1d5db', badgeText: '#4b5563' },
  { key: 'red',    label: 'Rosso',    dot: '#ef4444', badgeBg: '#fef2f2', badgeBorder: '#fecaca', badgeText: '#b91c1c' },
  { key: 'amber',  label: 'Ambra',    dot: '#f59e0b', badgeBg: '#fffbeb', badgeBorder: '#fde68a', badgeText: '#b45309' },
  { key: 'yellow', label: 'Giallo',   dot: '#eab308', badgeBg: '#fefce8', badgeBorder: '#fef08a', badgeText: '#854d0e' },
  { key: 'green',  label: 'Verde',    dot: '#22c55e', badgeBg: '#f0fdf4', badgeBorder: '#bbf7d0', badgeText: '#15803d' },
  { key: 'blue',   label: 'Blu',      dot: '#3b82f6', badgeBg: '#eff6ff', badgeBorder: '#bfdbfe', badgeText: '#1d4ed8' },
  { key: 'purple', label: 'Viola',    dot: '#a855f7', badgeBg: '#faf5ff', badgeBorder: '#e9d5ff', badgeText: '#7e22ce' },
  { key: 'pink',   label: 'Rosa',     dot: '#ec4899', badgeBg: '#fdf2f8', badgeBorder: '#fbcfe8', badgeText: '#be185d' },
] as const;

export function isCustomColor(color: string | null | undefined): boolean {
  return !!color && color.startsWith('#');
}

export function tagDotStyle(color: string | null | undefined): { className: string; style?: CSSProperties } {
  const hex = isCustomColor(color) ? (color as string) : (TAG_COLOR_OPTIONS.find(c => c.key === color)?.dot ?? '#9ca3af');
  return { className: '', style: { backgroundColor: hex } };
}

export function tagBadgeStyle(color: string | null | undefined): { className: string; style?: CSSProperties } {
  if (isCustomColor(color)) {
    const hex = color as string;
    return { className: 'border', style: { backgroundColor: `${hex}1a`, borderColor: hex, color: hex } };
  }
  const opt = TAG_COLOR_OPTIONS.find(c => c.key === color);
  return {
    className: 'border',
    style: { backgroundColor: opt?.badgeBg ?? '#f3f4f6', borderColor: opt?.badgeBorder ?? '#d1d5db', color: opt?.badgeText ?? '#4b5563' },
  };
}
