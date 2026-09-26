'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Legacy admin path — user settings live at /settings. */
export default function AdministrationSettingsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/settings');
  }, [router]);
  return null;
}
