import { Metadata } from 'next';
import { QualitaMenu } from './QualitaMenu';
import { FullscreenButton } from './FullscreenButton';

export const metadata: Metadata = { title: 'Qualità' };

export default function QualitaPage() {
  return (
    <div>
      <div className="mb-8 flex items-start justify-end">
        <FullscreenButton href="/qualita/tablet" />
      </div>
      <QualitaMenu />
    </div>
  );
}
