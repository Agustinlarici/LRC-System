'use client';

import { OggiView } from '@/components/progetti/OggiView';
import { useProgettiLate } from '@/components/progetti/ListaShell';

export default function OggiPage() {
  const { setLate } = useProgettiLate();
  return <OggiView onCount={setLate} />;
}
