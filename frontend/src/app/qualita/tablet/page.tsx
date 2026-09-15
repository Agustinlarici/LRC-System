'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { TabletShell } from './TabletShell';

const options = [
  {
    href:        '/qualita/tablet/nuova',
    title:       'Nuova segnalazione',
    icon:        '✏️',
    needsManage: false,
  },
  {
    href:        '/qualita/tablet/cerca',
    title:       'Cerca',
    icon:        '🔍',
    needsManage: false,
  },
  {
    href:        '/qualita/tablet/impostazioni',
    title:       'Impostazioni',
    icon:        '⚙️',
    needsManage: true,
  },
];

function TabletMenu() {
  const { canManage } = useAuth();
  const router = useRouter();
  const visible = options.filter(o => !o.needsManage || canManage('qualita'));

  // Richiesta di fullscreen esplicita e sincrona nello stesso click, come nel
  // pulsante "Schermo intero" — non basta contare sul listener di TabletShell,
  // che si disattiva dopo il primo tocco sulla pagina e quindi non copre più i
  // click successivi sulle voci del menu.
  function handleClick(e: React.MouseEvent, href: string) {
    e.preventDefault();
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
    router.push(href);
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {visible.map((opt) => (
        <a
          key={opt.href}
          href={opt.href}
          onClick={e => handleClick(e, opt.href)}
          className="card group hover:shadow-md hover:border-blue-300 transition-shadow text-center py-10"
        >
          <span className="text-5xl block mb-4">{opt.icon}</span>
          <h2 className="font-semibold text-lg text-gray-800 group-hover:text-blue-600">{opt.title}</h2>
        </a>
      ))}
    </div>
  );
}

export default function QualitaTabletHubPage() {
  useEffect(() => { document.title = 'Qualità — Tablet'; }, []);

  return (
    <TabletShell title="">
      <TabletMenu />
    </TabletShell>
  );
}
