// Icone SVG per le pagine delle schede (niente emoji ne' simboli di testo).

type P = { className?: string };
const base = { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

export const IconaIndietro = ({ className = 'h-4 w-4' }: P) => <svg {...base} className={className}><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></svg>;
export const IconaChiudi = ({ className = 'h-3.5 w-3.5' }: P) => <svg {...base} className={className}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>;
export const IconaMatita = ({ className = 'h-3.5 w-3.5' }: P) => <svg {...base} className={className}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>;
export const IconaGiu = ({ className = 'h-4 w-4' }: P) => <svg {...base} className={className}><path d="m6 9 6 6 6-6" /></svg>;
export const IconaDestra = ({ className = 'h-4 w-4' }: P) => <svg {...base} className={className}><path d="m9 18 6-6-6-6" /></svg>;
export const IconaSinistra = ({ className = 'h-4 w-4' }: P) => <svg {...base} className={className}><path d="m15 18-6-6 6-6" /></svg>;
export const IconaOk = ({ className = 'h-4 w-4' }: P) => <svg {...base} className={className}><path d="M20 6 9 17l-5-5" /></svg>;
export const IconaAvviso = ({ className = 'h-3.5 w-3.5' }: P) => (
  <svg {...base} className={className}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
);
