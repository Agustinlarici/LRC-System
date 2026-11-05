'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tabs } from '@/components/ui/Tabs';
import { OggiView } from '@/components/progetti/OggiView';
import { ElencoView } from '@/components/progetti/ElencoView';

const TABS = ['oggi', 'progetti'] as const;
type Tab = typeof TABS[number];

export default function ProgettiPage() {
  const [tab, setTab] = useState<Tab>('oggi');
  const [late, setLate] = useState(0);
  const today = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div>
      <PageHeader title="Progetti" description={<span className="capitalize">{today}</span>} />
      <Tabs tabs={TABS} value={tab} onChange={setTab} labels={{ oggi: 'Oggi', progetti: 'Progetti' }} badges={{ oggi: late }} />
      {tab === 'oggi' ? <OggiView onCount={setLate} /> : <ElencoView />}
    </div>
  );
}
