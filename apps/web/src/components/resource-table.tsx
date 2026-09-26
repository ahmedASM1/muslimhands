'use client';

import { useQuery } from '@tanstack/react-query';
import { EmptyState } from '@/components/empty-state';
import { TableSkeleton } from '@/components/skeleton';
import { useI18n } from '@/i18n';
import { apiList } from '@/lib/api';

interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
}

export function ResourceTable<T extends Record<string, unknown>>({
  queryKey,
  path,
  columns,
  empty,
  emptyActionHref,
  emptyActionLabel,
}: {
  queryKey: string;
  path: string;
  columns: Column<T>[];
  empty: string;
  emptyActionHref?: string;
  emptyActionLabel?: string;
}) {
  const { t } = useI18n();
  const query = useQuery({
    queryKey: [queryKey, path],
    queryFn: () => apiList<T>(path),
  });

  if (query.isLoading) {
    return <TableSkeleton rows={6} cols={Math.min(columns.length, 5)} />;
  }
  if (query.error) {
    return (
      <EmptyState
        title={t('common.unableToLoad')}
        description={(query.error as Error).message}
      />
    );
  }

  const rows = query.data?.items ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        title={empty}
        actionHref={emptyActionHref}
        actionLabel={emptyActionLabel}
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-muted/50 text-left">
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className="px-3 py-2 font-medium">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={String(row.id ?? index)} className="border-t">
              {columns.map((column) => (
                <td key={column.key} className="px-3 py-2 align-top">
                  {column.render ? column.render(row) : String(row[column.key] ?? t('common.emDash'))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
