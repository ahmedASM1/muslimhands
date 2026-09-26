'use client';

import { ReportPage } from '@/components/reports/report-page';
import { useI18n } from '@/i18n';

export default function StockMovementsReportPage() {
  const { t } = useI18n();
  return (
    <ReportPage
      title={t('reports.stockMovements.title')}
      description={t('reports.stockMovements.description')}
      endpoint="/reports/stock-movements"
      exportType="stock-movements"
      filters={[
        { key: 'dateFrom', label: t('reports.filters.from'), type: 'date' },
        { key: 'dateTo', label: t('reports.filters.to'), type: 'date' },
        { key: 'movementType', label: t('reports.filters.movementType') },
        { key: 'search', label: t('reports.filters.search') },
      ]}
      columns={[
        {
          key: 'occurredAt',
          header: t('reports.columns.occurredAt'),
          render: (row) => String(row.occurredAt).replace('T', ' ').slice(0, 19),
        },
        { key: 'movementType', header: t('reports.columns.movementType') },
        { key: 'medicine', header: t('table.medicine') },
        { key: 'batch', header: t('reports.columns.batch') },
        { key: 'location', header: t('reports.columns.location') },
        { key: 'quantity', header: t('reports.columns.qty') },
        { key: 'direction', header: t('reports.columns.direction') },
        { key: 'performedBy', header: t('reports.columns.by') },
        { key: 'notes', header: t('reports.columns.notes') },
      ]}
    />
  );
}
