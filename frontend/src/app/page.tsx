import Link from 'next/link';

const modules = [
  {
    href:        '/ingresso-merci',
    title:       'Ingresso Merci',
    description: 'Gestione ricezione materiali in entrata',
    icon:        '📦',
    status:      'live' as const,
  },
  {
    href:        '/packing',
    title:       'Packing & Spedizioni',
    description: 'Gestione pallet, spedizioni e liste di imballo',
    icon:        '🚚',
    status:      'live' as const,
  },
  {
    href:        '/spma',
    title:       'SPMA Planning',
    description: 'Pianificazione componenti per linea di produzione',
    icon:        '📋',
    status:      'soon' as const,
  },
  {
    href:        '/production',
    title:       'Ordini Produzione',
    description: 'Sincronizzazione e monitoraggio ordini da Business Central',
    icon:        '🏭',
    status:      'soon' as const,
  },
  {
    href:        '/assistant',
    title:       'Assistente AI',
    description: 'Chat con dati di produzione via AI',
    icon:        '🤖',
    status:      'soon' as const,
  },
];

export default function HomePage() {
  return (
    <div>
      <div className="mb-8">
        <p className="text-gray-500">Seleziona un modulo per iniziare</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {modules.map((m) => (
          <Link
            key={m.href}
            href={m.status === 'live' ? m.href : '#'}
            className={`card group hover:shadow-md transition-shadow ${
              m.status === 'soon' ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
            }`}
          >
            <div className="flex items-start gap-4">
              <span className="text-3xl">{m.icon}</span>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold text-gray-800 group-hover:text-blue-600">
                    {m.title}
                  </h2>
                  {m.status === 'soon' && (
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
