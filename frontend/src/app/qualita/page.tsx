import { Metadata } from 'next';
import Link from 'next/link';
import { QualitaMenu } from './QualitaMenu';

export const metadata: Metadata = { title: 'Qualità' };

export default function QualitaPage() {
  return (
    <div>
      <div className="mb-8 flex items-start justify-end">
        <Link
          href="/qualita/tablet"
          className="flex items-center gap-2 text-sm text-gray-500 border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50 transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4">
            <rect x="5" y="2" width="14" height="20" rx="2" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="12" cy="18" r="0.5" fill="currentColor" />
          </svg>
          Modalità Tablet
        </Link>
      </div>
      <QualitaMenu />
    </div>
  );
}
