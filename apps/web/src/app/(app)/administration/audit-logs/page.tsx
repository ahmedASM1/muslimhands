'use client';

import { ResourceTable } from '@/components/resource-table';
import { useI18n } from '@/i18n';

export default function AuditLogsPage() {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t('admin.auditLogs.title')}</h1>
      <ResourceTable
        queryKey="audit"
        path="/audit-logs?limit=50"
        empty={t('admin.auditLogs.empty')}
        columns={[
          {
            key: 'createdAt',
            header: t('table.time'),
            render: (row) => String(row.createdAt).replace('T', ' ').slice(0, 16),
          },
          { key: 'action', header: t('table.action') },
          { key: 'entityType', header: t('table.entity') },
          {
            key: 'actor',
            header: t('table.user'),
            render: (row) => {
              const actor = row.actor as { email?: string } | null;
              return actor?.email ?? t('common.system');
            },
          },
        ]}
      />
    </div>
  );
}
