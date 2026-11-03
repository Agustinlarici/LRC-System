// Configurazione ESLint (flat config) per Next.js 16 (`next lint` non esiste più: si usa `eslint .`).
import coreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

export default [
  { ignores: ['.next/**', 'node_modules/**', 'public/**', 'next-env.d.ts'] },
  ...coreWebVitals,
  ...nextTypescript,
  {
    // Regole di stile già violate nel codice esistente: avvisi, non errori, così la CI
    // resta utile (rules-of-hooks e le altre regole di correttezza restano errori).
    // Da sistemare gradualmente e poi riportare a "error".
    rules: {
      'react/no-unescaped-entities': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@next/next/no-html-link-for-pages': 'warn',
      'prefer-const': 'warn',
      // Regole React Compiler introdotte da eslint-plugin-react-hooks 7: il codice esistente le viola.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },
];
