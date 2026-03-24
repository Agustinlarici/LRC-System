'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-xl border border-red-200 p-8 max-w-md w-full text-center shadow-sm">
        <div className="text-4xl mb-4">⚠️</div>
        <h2 className="text-xl font-bold text-gray-800 mb-2">Qualcosa è andato storto</h2>
        <p className="text-sm text-gray-500 mb-6">
          {error.message || 'Si è verificato un errore imprevisto.'}
        </p>
        <button
          onClick={reset}
          className="btn-primary"
        >
          Riprova
        </button>
      </div>
    </div>
  );
}
