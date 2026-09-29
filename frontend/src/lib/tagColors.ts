// Palette fissa per le etichette HR (pallino colorato) — le classi Tailwind devono
// esistere staticamente nel bundle, quindi il colore scelto da HR è una chiave
// di questa lista e non una stringa CSS libera.
export const TAG_COLOR_OPTIONS = [
  { key: 'gray',   label: 'Grigio',   dot: 'bg-gray-400',   badge: 'bg-gray-100 text-gray-700 border-gray-200' },
  { key: 'red',    label: 'Rosso',    dot: 'bg-red-500',    badge: 'bg-red-50 text-red-700 border-red-200' },
  { key: 'amber',  label: 'Ambra',    dot: 'bg-amber-500',  badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  { key: 'yellow', label: 'Giallo',   dot: 'bg-yellow-400', badge: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
  { key: 'green',  label: 'Verde',    dot: 'bg-green-500',  badge: 'bg-green-50 text-green-700 border-green-200' },
  { key: 'blue',   label: 'Blu',      dot: 'bg-blue-500',   badge: 'bg-blue-50 text-blue-700 border-blue-200' },
  { key: 'purple', label: 'Viola',    dot: 'bg-purple-500', badge: 'bg-purple-50 text-purple-700 border-purple-200' },
  { key: 'pink',   label: 'Rosa',     dot: 'bg-pink-500',   badge: 'bg-pink-50 text-pink-700 border-pink-200' },
] as const;

export function tagDotClass(color: string | null | undefined): string {
  return TAG_COLOR_OPTIONS.find(c => c.key === color)?.dot ?? 'bg-gray-300';
}

export function tagBadgeClass(color: string | null | undefined): string {
  return TAG_COLOR_OPTIONS.find(c => c.key === color)?.badge ?? 'bg-gray-100 text-gray-700 border-gray-200';
}
