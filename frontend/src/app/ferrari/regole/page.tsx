'use client';

import { useAuth } from '@/lib/auth';
import { RegoleComponenti } from '@/components/ferrari/RegoleComponenti';

export default function RegoleComponentiPage() {
  const { canManage } = useAuth();
  return <RegoleComponenti puoModificare={canManage('ferrari_schede')} />;
}
