'use client';

import { ReportPage } from '@/components/reports/report-page';
import { useI18n } from '@/i18n';

export default function TransfersReportPage() {
  const { t } = useI18n();
  return (
    <ReportPage
      title={t('reports.transfers.title')}
      description={t('reports.transfers.description')}
      endpoint="/reports/transfers"
      exportType="transfers"
      filters={[
        { key: 'dateFrom', label: t('reports.filters.from'), type: 'date' },
        { key: 'dateTo', label: t('reports.filters.to'), type: 'date' },
        { key: 'status', label: t('reports.filters.status') },
        { key: 'search', label: t('reports.filters.transferNumber') },
      ]}
      columns={[
        { key: 'transferNumber', header: t('reports.columns.transferNumber') },
        { key: 'warehouse', header: t('reports.columns.warehouse') },
        { key: 'pharmacy', header: t('table.pharmacy') },
        { key: 'status', header: t('table.status') },
        { key: 'medicine', header: t('table.medicine') },
        { key: 'batch', header: t('reports.columns.batch') },
        { key: 'quantity', header: t('reports.columns.qty') },
        {
          key: 'shippedDate',
          header: t('reports.columns.shipped'),
          render: (row) => String(row.shippedDate ?? t('common.emDash')).slice(0, 10),
        },
        {
          key: 'receivedDate',
          header: t('reports.columns.received'),
          render: (row) => String(row.receivedDate ?? t('common.emDash')).slice(0, 10),
        },
        { key: 'custodyNote', header: t('reports.columns.custody') },
      ]}
    />
  );
}
