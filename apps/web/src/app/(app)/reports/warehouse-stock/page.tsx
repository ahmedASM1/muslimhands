'use client';

import { ReportPage } from '@/components/reports/report-page';
import { useI18n } from '@/i18n';

export default function WarehouseStockReportPage() {
  const { t } = useI18n();
  return (
    <ReportPage
      title={t('reports.warehouseStock.title')}
      description={t('reports.warehouseStock.description')}
      endpoint="/reports/warehouse-stock"
      exportType="warehouse-stock"
      backHref="/warehouse/reports"
      filters={[
        { key: 'search', label: t('reports.filters.search') },
        {
          key: 'expiryStatus',
          label: t('reports.filters.expiry'),
          type: 'select',
          options: [
            { value: 'EXPIRED', label: t('status.EXPIRED') },
            { value: 'EXPIRING_SOON', label: t('status.EXPIRING_SOON') },
            { value: 'VALID', label: t('status.VALID') },
          ],
        },
      ]}
      columns={[
        { key: 'medicine', header: t('table.medicine') },
        { key: 'batch', header: t('reports.columns.batch') },
        {
          key: 'expiryDate',
          header: t('reports.columns.expiry'),
          render: (row) => String(row.expiryDate).slice(0, 10),
        },
        { key: 'quantity', header: t('reports.columns.qty') },
        { key: 'unit', header: t('table.unit') },
        { key: 'stockStatus', header: t('table.status') },
        { key: 'estimatedStockValue', header: t('reports.columns.estimatedValue') },
        {
          key: 'lastMovementDate',
          header: t('reports.columns.lastMovement'),
          render: (row) => String(row.lastMovementDate ?? t('common.emDash')).slice(0, 10),
        },
      ]}
    />
  );
}
