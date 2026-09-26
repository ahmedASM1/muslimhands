'use client';

import { ReportPage } from '@/components/reports/report-page';
import { useI18n } from '@/i18n';

export default function PharmacyStockReportPage() {
  const { t } = useI18n();
  return (
    <ReportPage
      title={t('reports.pharmacyStock.title')}
      description={t('reports.pharmacyStock.description')}
      endpoint="/reports/pharmacy-stock"
      exportType="pharmacy-stock"
      backHref="/pharmacy/reports"
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
        { key: 'pharmacy', header: t('table.pharmacy') },
        { key: 'medicine', header: t('table.medicine') },
        { key: 'batch', header: t('reports.columns.batch') },
        {
          key: 'expiryDate',
          header: t('reports.columns.expiry'),
          render: (row) => String(row.expiryDate).slice(0, 10),
        },
        { key: 'quantity', header: t('reports.columns.qty') },
        { key: 'stockStatus', header: t('table.status') },
        { key: 'estimatedStockValue', header: t('reports.columns.estimatedValue') },
      ]}
    />
  );
}
