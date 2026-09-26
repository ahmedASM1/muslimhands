'use client';

import { ReportPage } from '@/components/reports/report-page';
import { useI18n } from '@/i18n';

export default function InventoryReportPage() {
  const { t } = useI18n();
  return (
    <ReportPage
      title={t('reports.inventoryReport.title')}
      description={t('reports.inventoryReport.description')}
      endpoint="/reports/inventory"
      exportType="inventory"
      filters={[
        { key: 'search', label: t('reports.filters.search') },
        {
          key: 'stockStatus',
          label: t('reports.filters.stockStatus'),
          type: 'select',
          options: [
            { value: 'LOW_STOCK', label: t('status.LOW_STOCK') },
            { value: 'IN_STOCK', label: t('status.IN_STOCK') },
            { value: 'OUT_OF_STOCK', label: t('status.OUT_OF_STOCK') },
            { value: 'EXPIRED', label: t('status.EXPIRED') },
            { value: 'EXPIRING_SOON', label: t('status.EXPIRING_SOON') },
          ],
        },
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
        { key: 'sku', header: t('table.sku') },
        { key: 'batch', header: t('reports.columns.batch') },
        { key: 'location', header: t('reports.columns.location') },
        { key: 'locationType', header: t('reports.columns.type') },
        { key: 'quantity', header: t('reports.columns.qty') },
        { key: 'stockStatus', header: t('table.status') },
        { key: 'estimatedStockValue', header: t('reports.columns.estimatedValue') },
      ]}
    />
  );
}
