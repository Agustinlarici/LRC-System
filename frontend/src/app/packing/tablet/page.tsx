'use client';

import { PackingMenu } from '../PackingMenu';

export default function PackingTabletPage() {
  return (
    <div className="p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Packing & Spedizioni</h1>
        <p className="mt-1 text-gray-500">Gestione pallet, spedizioni e liste di imballo</p>
      </div>

      <PackingMenu />
    </div>
  );
}
