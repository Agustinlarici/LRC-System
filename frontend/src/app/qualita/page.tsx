import { Metadata } from 'next';
import { QualitaMenu } from './QualitaMenu';
import { TabletModeLink } from './TabletModeLink';

export const metadata: Metadata = { title: 'Qualità' };

export default function QualitaPage() {
  return (
    <div>
      <div className="mb-8 flex items-start justify-end">
        <TabletModeLink />
      </div>
      <QualitaMenu />
    </div>
  );
}
