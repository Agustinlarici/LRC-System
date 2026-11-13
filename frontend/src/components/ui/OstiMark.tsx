// Punto viola accanto ai dati che arrivano da Osti (importati con "Sincronizza con Osti"),
// così in scheda e nei moduli si vede quali campi si aggiornano da lì.

// Etichette dei campi che l'import legge da Osti
const OSTI_LABELS = new Set([
  'Sesso', 'Data di nascita', 'Codice fiscale', 'Nome Osti', 'Nazionalità', 'Extra UE / Italia', 'Email', 'Telefono',
  'Indirizzo (residenza)', 'Indirizzo', 'Città', 'Provincia', 'CAP', 'Matricola', 'Data assunzione',
  'Data cessazione / fine contratto', 'Fine contratto / cessazione', 'Mansione', 'Livello', 'Note', 'Note HR',
  'Badge', 'Transponder', 'Terminale di timbratura', 'Qualifica', 'Tempo indeterminato',
  'Data passaggio a indeterminato', 'Passaggio a indeterminato', 'Part-time', 'Luogo di nascita', 'Stato civile',
  'Reparto', 'Società', 'Plant / Sedi', 'Tipologia',   // ditta, filiale e reparto di Osti, abbinati per nome ai nostri elenchi
]);

export const isOstiLabel = (label: string) => OSTI_LABELS.has(label.replace(/\s*\*$/, '').trim());

export function OstiMark() {
  return (
    <span
      title="Dato che arriva da Osti"
      aria-label="Dato che arriva da Osti"
      className="inline-block w-2 h-2 rounded-full bg-accent ml-1.5 align-middle"
    />
  );
}

export function OstiLegend({ className = '' }: { className?: string }) {
  return (
    <p className={`text-xs text-muted flex items-center ${className}`}>
      <span className="inline-block w-2 h-2 rounded-full bg-accent mr-1.5" />
      Dati che arrivano da Osti
    </p>
  );
}
