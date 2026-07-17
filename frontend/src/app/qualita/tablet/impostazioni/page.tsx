'use client';

import { useEffect } from 'react';
import { TabletShell } from '../TabletShell';
import { ImpostazioniFlow } from '../../impostazioni/ImpostazioniFlow';

export default function QualitaTabletImpostazioniPage() {
  useEffect(() => { document.title = 'Impostazioni Qualità — STR'; }, []);

  return (
    <TabletShell title="Impostazioni Qualità" backHref="/qualita/tablet" requireManage>
      <ImpostazioniFlow />
    </TabletShell>
  );
}
