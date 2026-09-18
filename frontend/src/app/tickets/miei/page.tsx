'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function MieiTicketRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/tickets/stato'); }, [router]);
  return null;
}
