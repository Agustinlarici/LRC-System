'use client';

import { useEffect } from 'react';
import { TabletShell } from '../TabletShell';
import { NuovaSegnalazioneFlow } from '../../nuova/NuovaSegnalazioneFlow';

export default function QualitaTabletNuovaPage() {
  useEffect(() => { document.title = 'Nuova segnalazione — Qualità'; }, []);

  return (
    <TabletShell title="Nuova segnalazione" backHref="/qualita/tablet">
      <NuovaSegnalazioneFlow tablet />
    </TabletShell>
  );
}
