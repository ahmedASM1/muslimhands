'use client';

import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-muted', className)}
      aria-hidden="true"
    />
  );
}

export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  const { t } = useI18n();
  return (
    <div className="space-y-2" role="status" aria-label={t('common.loadingTable')}>
      <Skeleton className="h-10 w-full" />
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="flex gap-2">
          {Array.from({ length: cols }).map((__, col) => (
            <Skeleton key={col} className="h-8 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" role="status" aria-label={t('common.loading')}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}
