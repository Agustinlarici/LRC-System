import { Metadata } from 'next';
import { HRMenu } from './HRMenu';

export const metadata: Metadata = { title: 'HR' };

export default function HRPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-lg font-medium text-gray-900">Risorse Umane</h1>
        <p className="text-xs text-gray-400 mt-0.5">Anagrafica, organigramma e analisi del personale</p>
      </div>
      <HRMenu />
    </div>
  );
}
