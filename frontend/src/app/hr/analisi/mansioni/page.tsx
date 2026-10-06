'use client';

import { AnalisiOrganico } from '../AnalisiOrganico';

export default function LivelliMansioniPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-medium text-gray-900 d-print-none">Livelli per mansione</h1>
      <AnalisiOrganico view="mansioni" />
    </div>
  );
}
