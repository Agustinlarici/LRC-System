'use client';

import { createContext, useContext, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tabs } from '@/components/ui/Tabs';

const TABS = ['oggi', 'progetti'] as const;
type Tab = typeof TABS[number];
const HREF: Record<Tab, string> = { oggi: '/progetti', progetti: '/progetti/elenco' };

const LateCtx = createContext<{ late: number; setLate: (n: number) => void }>({ late: 0, setLate: () => {} });
/** Contatore delle attività in ritardo, mostrato sulla solapa «Oggi». */
export const useProgettiLate = () => useContext(LateCtx);

export function ListaShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [late, setLate] = useState(0);
  const tab: Tab = pathname.startsWith('/progetti/elenco') ? 'progetti' : 'oggi';
  const ctx = useMemo(() => ({ late, setLate }), [late]);
  // «venerdì 6 novembre»: in italiano il mese va in minuscolo, solo la prima lettera in maiuscolo
  const raw = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  const today = raw.charAt(0).toUpperCase() + raw.slice(1);

  return (
    <LateCtx.Provider value={ctx}>
      <PageHeader title="Progetti" description={today} />
      <Tabs tabs={TABS} value={tab} onChange={t => router.push(HREF[t])} labels={{ oggi: 'Oggi', progetti: 'Progetti' }} badges={{ oggi: late }} />
      {children}
    </LateCtx.Provider>
  );
}
