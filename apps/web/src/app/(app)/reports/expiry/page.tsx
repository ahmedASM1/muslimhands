'use client';

import { ReportPage } from '@/components/reports/report-page';
import { useI18n } from '@/i18n';

export default function ExpiryReportPage() {
  const { t } = useI18n();
  return (
    <ReportPage
      title={t('reports.expiry.title')}
      description={t('reports.expiry.description')}
      endpoint="/reports/expiry"
      exportType="expiry"
      filters={[
        {
          key: 'expiryStatus',
          label: t('reports.filters.expiryStatus'),
          type: 'select',
          options: [
            { value: 'EXPIRED', label: t('status.EXPIRED') },
            { value: 'EXPIRING_SOON', label: t('status.EXPIRING_SOON') },
            { value: 'VALID', label: t('status.VALID') },
          ],
        },
        { key: 'search', label: t('reports.filters.search') },
      ]}
      columns={[
        { key: 'medicine', header: t('table.medicine') },
        { key: 'batch', header: t('reports.columns.batch') },
        { key: 'location', header: t('reports.columns.location') },
        { key: 'locationType', header: t('reports.columns.type') },
        { key: 'quantity', header: t('reports.columns.qty') },
        {
          key: 'expiryDate',
          header: t('reports.columns.expiry'),
          render: (row) => String(row.expiryDate).slice(0, 10),
        },
        { key: 'daysUntilExpiry', header: t('reports.columns.days') },
        { key: 'status', header: t('table.status') },
      ]}
    />
  );
}
