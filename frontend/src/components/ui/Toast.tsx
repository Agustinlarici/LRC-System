'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
} from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id:      number;
  type:    ToastType;
  message: string;
}

interface ToastContextValue {
  success: (message: string) => void;
  error:   (message: string) => void;
  info:    (message: string) => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue>({
  success: () => {},
  error:   () => {},
  info:    () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const add = useCallback((type: ToastType, message: string) => {
    const id = ++counter.current;
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }, []);

  const remove = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const ctx: ToastContextValue = {
    success: (msg) => add('success', msg),
    error:   (msg) => add('error',   msg),
    info:    (msg) => add('info',    msg),
  };

  return (
    <ToastContext.Provider value={ctx}>
      {children}

      {/* Toast container — bottom-right */}
      <div
        aria-live="polite"
        className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2 pointer-events-none"
      >
        {toasts.map(t => (
          <div
            key={t.id}
            role="alert"
            className={`
              pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg
              text-sm font-medium min-w-[260px] max-w-[360px]
              animate-slideIn
              ${t.type === 'success' ? 'bg-emerald-600 text-white' : ''}
              ${t.type === 'error'   ? 'bg-red-600 text-white'     : ''}
              ${t.type === 'info'    ? 'bg-blue-600 text-white'    : ''}
            `}
          >
            {/* Icon */}
            <span className="shrink-0 text-base">
              {t.type === 'success' && '✓'}
              {t.type === 'error'   && '✕'}
              {t.type === 'info'    && 'ℹ'}
            </span>

            {/* Message */}
            <span className="flex-1 leading-snug">{t.message}</span>

            {/* Close */}
            <button
              onClick={() => remove(t.id)}
              className="shrink-0 opacity-70 hover:opacity-100 transition-opacity ml-1"
              aria-label="Chiudi notifica"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3.5 h-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
