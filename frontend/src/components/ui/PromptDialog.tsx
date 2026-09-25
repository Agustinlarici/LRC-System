'use client';

import { useCallback, useRef, useState } from 'react';

export const SKIP_ALL = Symbol('skip-all');
export type PromptResult = string | null | typeof SKIP_ALL;

interface PromptOptions {
  title: string;
  message?: string;
  label: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Se presente mostra un terzo bottone che risponde SKIP_ALL (es. per chiudere una serie di richieste) */
  skipAllLabel?: string;
}

// Sostituisce window.prompt con una finestra del programma. Uso:
//   const { ask, dialog } = usePromptDialog();
//   const nome = await ask({ title: '…', label: 'Nome' });   // string | null (annullato)
//   … return (<>{…}{dialog}</>)
export function usePromptDialog() {
  const [opts, setOpts] = useState<PromptOptions | null>(null);
  const [value, setValue] = useState('');
  const resolver = useRef<((r: PromptResult) => void) | null>(null);

  const ask = useCallback((o: PromptOptions) => new Promise<PromptResult>(resolve => {
    resolver.current = resolve;
    setValue('');
    setOpts(o);
  }), []);

  function close(result: PromptResult) {
    setOpts(null);
    resolver.current?.(result);
    resolver.current = null;
  }

  const dialog = opts && (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100] p-4" onClick={() => close(null)}>
      <form
        className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4"
        onClick={e => e.stopPropagation()}
        onSubmit={e => { e.preventDefault(); close(value.trim() || null); }}
      >
        <h2 className="text-base font-medium text-gray-900">{opts.title}</h2>
        {opts.message && <p className="text-sm text-gray-500">{opts.message}</p>}
        <div>
          <label className="label">{opts.label}</label>
          <input autoFocus className="input" value={value} placeholder={opts.placeholder} onChange={e => setValue(e.target.value)} />
        </div>
        <div className="flex items-center justify-end gap-2 flex-wrap">
          {opts.skipAllLabel && (
            <button type="button" onClick={() => close(SKIP_ALL)} className="btn-secondary text-sm mr-auto">{opts.skipAllLabel}</button>
          )}
          <button type="button" onClick={() => close(null)} className="btn-secondary text-sm">{opts.cancelLabel ?? 'Annulla'}</button>
          <button type="submit" disabled={!value.trim()} className="btn-primary text-sm">{opts.confirmLabel ?? 'Conferma'}</button>
        </div>
      </form>
    </div>
  );

  return { ask, dialog };
}
