'use client';

import { AnalisiOrganico } from '../AnalisiOrganico';
import { PageHeader } from '@/components/ui/PageHeader';

export default function LivelliMansioniPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Livelli per mansione" back={{ label: 'Analisi HR', href: '/hr/analisi' }} />
      <AnalisiOrganico view="mansioni" />
    </div>
  );
}
