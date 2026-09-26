'use client';

import { ReportPage } from '@/components/reports/report-page';
import { useI18n } from '@/i18n';

export default function ReceiptsReportPage() {
  const { t } = useI18n();
  return (
    <ReportPage
      title={t('reports.receipts.title')}
      description={t('reports.receipts.description')}
      endpoint="/reports/receipts"
      exportType="receipts"
      filters={[
        { key: 'dateFrom', label: t('reports.filters.from'), type: 'date' },
        { key: 'dateTo', label: t('reports.filters.to'), type: 'date' },
        {
          key: 'status',
          label: t('reports.filters.status'),
          type: 'select',
          options: [
            { value: 'DRAFT', label: t('status.DRAFT') },
            { value: 'POSTED', label: t('status.POSTED') },
            { value: 'CANCELLED', label: t('status.CANCELLED') },
          ],
        },
        { key: 'search', label: t('reports.filters.search') },
      ]}
      columns={[
        { key: 'receiptNumber', header: t('reports.columns.receiptNumber') },
        {
          key: 'receiptDate',
          header: t('reports.columns.date'),
          render: (row) => String(row.receiptDate ?? t('common.emDash')).slice(0, 10),
        },
        { key: 'warehouse', header: t('reports.columns.warehouse') },
        { key: 'supplierReference', header: t('reports.columns.supplierReference') },
        { key: 'medicine', header: t('table.medicine') },
        { key: 'batch', header: t('reports.columns.batch') },
        { key: 'quantity', header: t('reports.columns.qty') },
        { key: 'status', header: t('table.status') },
        { key: 'postedBy', header: t('reports.columns.postedBy') },
      ]}
    />
  );
}
