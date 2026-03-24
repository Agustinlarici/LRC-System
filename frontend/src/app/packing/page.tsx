import { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Packing' };

const options = [
  {
    href:        '/packing/operatore',
    title:       'Crea Packing List',
    description: 'Avvia una nuova sessione di scansione',
    icon:        '📦',
  },
  {
    href:        '/packing/liste',
    title:       'Consulta Packing Lists',
    description: 'Visualizza, stampa e modifica le spedizioni',
    icon:        '🔍',
  },
  {
    href:        '/packing/impostazioni',
    title:       'Impostazioni',
    description: 'Gestisci magazzinieri e destinazioni',
    icon:        '⚙️',
  },
];

export default function PackingPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Packing & Spedizioni</h1>
        <p className="mt-1 text-gray-500">Gestione pallet, spedizioni e liste di imballo</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
        {options.map((opt) => (
          <Link
            key={opt.href}
            href={opt.href}
            className="card group hover:shadow-md transition-shadow cursor-pointer"
          >
            <div className="flex items-start gap-4">
              <span className="text-3xl">{opt.icon}</span>
              <div>
                <h2 className="font-semibold text-gray-800 group-hover:text-blue-600">
                  {opt.title}
                </h2>
                <p className="text-sm text-gray-500 mt-1">{opt.description}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
