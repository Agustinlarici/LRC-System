// Il modulo HR usa viola/rosa come colore che evidenzia (variabili --accent in globals.css).
// Le modali stanno nello stesso albero, quindi ereditano il tema.
export default function HRLayout({ children }: { children: React.ReactNode }) {
  return <div className="theme-hr">{children}</div>;
}
