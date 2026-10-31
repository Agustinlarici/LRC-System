'use client';

import type { HrPlant } from '@/types';

// Selezione multipla di sedi come "chip" cliccabili — un dipendente può lavorare su più plant.
export function PlantMultiSelect({ plants, value, onChange, onAdd }: {
  plants: HrPlant[];
  value: number[];
  onChange: (ids: number[]) => void;
  onAdd?: () => void;
}) {
  const toggle = (id: number) => onChange(value.includes(id) ? value.filter(v => v !== id) : [...value, id]);
  return (
    <div className="flex flex-wrap gap-1.5">
      {plants.map(p => {
        const on = value.includes(p.id);
        return (
          <button
            key={p.id} type="button" onClick={() => toggle(p.id)}
            className={`text-sm px-3 py-1.5 rounded-ctl border transition-colors ${on ? 'bg-ink-800 border-ink-800 text-white' : 'bg-white border-stone-300 text-muted hover:border-accent'}`}
          >
            {p.name}
          </button>
        );
      })}
      {onAdd && <button type="button" onClick={onAdd} title="Nuovo plant" className="btn-secondary text-sm px-3">+</button>}
    </div>
  );
}
