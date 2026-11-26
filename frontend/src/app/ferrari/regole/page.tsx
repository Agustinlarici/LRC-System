'use client';

import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/ui/PageHeader';
import { RegoleComponenti } from '@/components/ferrari/RegoleComponenti';

export default function RegoleComponentiPage() {
  const { canManage } = useAuth();
  return (
    <div>
      <PageHeader
        back={{ label: 'Per componente', href: '/ferrari/componenti' }}
        title="Regole dei componenti"
        description="Si applicano in ordine, dall'alto: SE la scheda ha (o non ha) certe sigle, ALLORA aggiungi un valore a un componente."
      />
      <RegoleComponenti puoModificare={canManage('ferrari_schede')} />
    </div>
  );
}
