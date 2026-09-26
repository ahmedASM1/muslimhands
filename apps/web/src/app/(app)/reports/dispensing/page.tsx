'use client';

import { ReportPage } from '@/components/reports/report-page';
import { useI18n } from '@/i18n';

export default function DispensingReportPage() {
  const { t } = useI18n();
  return (
    <ReportPage
      title={t('reports.dispensing.title')}
      description={t('reports.dispensing.description')}
      endpoint="/reports/dispensing"
      exportType="dispensing"
      filters={[
        { key: 'dateFrom', label: t('reports.filters.from'), type: 'date' },
        { key: 'dateTo', label: t('reports.filters.to'), type: 'date' },
        { key: 'search', label: t('reports.filters.search') },
        { key: 'dispensingNumber', label: t('reports.filters.dispensingNumber') },
      ]}
      columns={[
        { key: 'dispensingNumber', header: t('reports.columns.number') },
        {
          key: 'dispensedAt',
          header: t('reports.columns.dateTime'),
          render: (row) => String(row.dispensedAt).replace('T', ' ').slice(0, 16),
        },
        { key: 'pharmacy', header: t('table.pharmacy') },
        { key: 'beneficiaryNumber', header: t('reports.columns.beneficiaryNumber') },
        { key: 'beneficiaryName', header: t('reports.columns.beneficiaryName') },
        { key: 'medicine', header: t('table.medicine') },
        { key: 'batch', header: t('reports.columns.batch') },
        { key: 'quantity', header: t('reports.columns.qty') },
        { key: 'estimatedValue', header: t('reports.columns.estimatedValue') },
        { key: 'dispensedBy', header: t('reports.columns.staff') },
      ]}
    />
  );
}
