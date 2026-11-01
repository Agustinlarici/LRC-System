import { Metadata } from 'next';
import { HRMenu } from './HRMenu';
import { PageHeader } from '@/components/ui/PageHeader';

export const metadata: Metadata = { title: 'HR' };

export default function HRPage() {
  return (
    <div>
      <PageHeader title="Risorse Umane" description="Anagrafica, organigramma e analisi del personale" />
      <HRMenu />
    </div>
  );
}
