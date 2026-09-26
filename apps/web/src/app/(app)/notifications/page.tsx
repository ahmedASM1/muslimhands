'use client';

import { Suspense } from 'react';
import { TableSkeleton } from '@/components/skeleton';
import NotificationsClient from './notifications-client';

export default function NotificationsPage() {
  return (
    <Suspense fallback={<TableSkeleton rows={6} cols={1} />}>
      <NotificationsClient />
    </Suspense>
  );
}
