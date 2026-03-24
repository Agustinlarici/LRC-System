import Link from 'next/link';
import type { Metadata } from 'next';
import { visibleModules } from '@/lib/modules';

export const metadata: Metadata = { title: 'Home' };

export default function HomePage() {
  return (
    <div>
      <div className="mb-8">
        <p className="text-gray-500">Seleziona un modulo per iniziare</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {visibleModules.map((m) => (
          <Link
            key={m.href}
            href={m.soon ? '#' : m.href}
            className={`card group hover:shadow-md transition-shadow ${
              m.soon ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
            }`}
          >
            <div className="flex items-start gap-4">
              <span className="text-3xl">{m.icon}</span>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold text-gray-800 group-hover:text-blue-600">
                    {m.label}
                  </h2>
                  {m.soon && (
                    <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded">
                      In arrivo
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-500 mt-1">{m.description}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
