import type { Metadata } from 'next';

// Manifest dedicato solo alla modalità tablet di Qualità: aggiunto a schermata
// home su Android apre l'app senza barra degli indirizzi (display: standalone).
export const metadata: Metadata = {
  manifest: '/manifest-qualita-tablet.json',
};

export default function QualitaTabletLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
