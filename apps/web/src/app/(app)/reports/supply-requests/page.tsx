'use client';

import { ReportPage } from '@/components/reports/report-page';
import { useI18n } from '@/i18n';

export default function SupplyRequestsReportPage() {
  const { t } = useI18n();
  return (
    <ReportPage
      title={t('reports.supplyRequests.title')}
      description={t('reports.supplyRequests.description')}
      endpoint="/reports/supply-requests"
      exportType="supply-requests"
      filters={[
        { key: 'dateFrom', label: t('reports.filters.from'), type: 'date' },
        { key: 'dateTo', label: t('reports.filters.to'), type: 'date' },
        { key: 'status', label: t('reports.filters.status') },
        { key: 'search', label: t('reports.filters.requestNumber') },
      ]}
      columns={[
        { key: 'requestNumber', header: t('reports.columns.requestNumber') },
        { key: 'pharmacy', header: t('table.pharmacy') },
        { key: 'status', header: t('table.status') },
        {
          key: 'createdDate',
          header: t('reports.columns.created'),
          render: (row) => String(row.createdDate).slice(0, 10),
        },
        { key: 'requestedQuantities', header: t('reports.columns.requested') },
        { key: 'approvedQuantities', header: t('reports.columns.approved') },
        { key: 'requestedBy', header: t('reports.columns.requestedBy') },
        { key: 'rejectionReason', header: t('reports.columns.rejection') },
      ]}
    />
  );
}
