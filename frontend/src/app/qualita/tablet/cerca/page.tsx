'use client';

import { useEffect } from 'react';
import { TabletShell } from '../TabletShell';
import { CercaFlow } from '../../cerca/CercaFlow';

export default function QualitaTabletCercaPage() {
  useEffect(() => { document.title = 'Cerca — Qualità'; }, []);

  return (
    <TabletShell title="Cerca segnalazioni" backHref="/qualita/tablet">
      <CercaFlow tablet />
    </TabletShell>
  );
}
