// Configurazione ESLint (flat config) per Next.js.
// Senza questo file `next lint` si fermava su un prompt interattivo e la CI falliva.
import { FlatCompat } from '@eslint/eslintrc';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

export default [
  { ignores: ['.next/**', 'node_modules/**', 'public/**', 'next-env.d.ts'] },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    // Regole di stile già violate nel codice esistente: avvisi, non errori, così la CI
    // resta utile (rules-of-hooks e le altre regole di correttezza restano errori).
    // Da sistemare gradualmente e poi riportare a "error".
    rules: {
      'react/no-unescaped-entities': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@next/next/no-html-link-for-pages': 'warn',
      'prefer-const': 'warn',
    },
  },
];
