'use client';

import { AnalisiOrganico } from './AnalisiOrganico';
import { PageHeader } from '@/components/ui/PageHeader';

export default function AnalisiHRPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Analisi HR" description="Organico, età, anzianità e distribuzioni" />
      <AnalisiOrganico />
    </div>
  );
}
