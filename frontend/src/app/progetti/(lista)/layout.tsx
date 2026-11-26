import { ListaShell } from '@/components/progetti/ListaShell';

// Oggi e Progetti sono due pagine con URL propri (/progetti e /progetti/elenco):
// così ricaricare o tornare indietro da un progetto non riporta sempre su «Oggi».
export default function ListaLayout({ children }: { children: React.ReactNode }) {
  return <ListaShell>{children}</ListaShell>;
}
