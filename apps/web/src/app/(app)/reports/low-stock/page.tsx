'use client';

import { ReportPage } from '@/components/reports/report-page';
import { useI18n } from '@/i18n';

export default function LowStockReportPage() {
  const { t } = useI18n();
  return (
    <ReportPage
      title={t('reports.lowStock.title')}
      description={t('reports.lowStock.description')}
      endpoint="/reports/low-stock"
      exportType="low-stock"
      filters={[{ key: 'search', label: t('reports.filters.search') }]}
      columns={[
        { key: 'medicine', header: t('table.medicine') },
        { key: 'location', header: t('reports.columns.location') },
        { key: 'locationType', header: t('reports.columns.type') },
        { key: 'quantity', header: t('reports.columns.currentQty') },
        { key: 'unit', header: t('table.unit') },
        { key: 'threshold', header: t('reports.columns.threshold') },
        { key: 'stockStatus', header: t('table.status') },
      ]}
    />
  );
}
