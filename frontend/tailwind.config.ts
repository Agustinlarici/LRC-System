import type { Config } from 'tailwindcss';

// Design tokens STR. Il rosso del logo (#E00010) è solo l'accento di marca
// (voce attiva, dettagli); l'azione primaria è grigio scuro, come la sidebar.
// Il "pericolo" usa un rosso più spento (danger) per non confondersi col brand.
const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#E00010',
          dark:    '#B8000D',
          soft:    '#FDECEE',
        },
        ink: {
          950: '#141416',
          900: '#1C1C1F',
          800: '#27272A',
          700: '#3F3F46',
        },
        canvas: '#F4F4F2',
        line:   '#E7E5E4',
        muted:  '#636369',
        success: { DEFAULT: '#166534', soft: '#E4F4EA' },
        warning: { DEFAULT: '#92400E', soft: '#FEF1D6' },
        danger:  { DEFAULT: '#B42318', soft: '#FEE4E2' },
        info:    { DEFAULT: '#1D4ED8', soft: '#E6EEFF' },
      },
      borderRadius: {
        card: '20px',
        ctl:  '12px',
      },
      boxShadow: {
        card:  '0 1px 2px rgba(20, 20, 22, 0.04)',
        float: '0 8px 24px rgba(20, 20, 22, 0.10)',
      },
    },
  },
  plugins: [],
};

export default config;
