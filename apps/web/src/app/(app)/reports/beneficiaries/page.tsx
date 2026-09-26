'use client';

import { ReportPage } from '@/components/reports/report-page';
import { useI18n } from '@/i18n';

export default function BeneficiariesReportPage() {
  const { t } = useI18n();
  return (
    <ReportPage
      title={t('reports.beneficiaries.title')}
      description={t('reports.beneficiaries.description')}
      endpoint="/reports/beneficiaries"
      exportType="beneficiaries"
      filters={[
        { key: 'search', label: t('reports.filters.search') },
        {
          key: 'status',
          label: t('reports.filters.status'),
          type: 'select',
          options: [
            { value: 'ACTIVE', label: t('status.ACTIVE') },
            { value: 'INACTIVE', label: t('status.INACTIVE') },
          ],
        },
        { key: 'dateFrom', label: t('reports.filters.registeredFrom'), type: 'date' },
        { key: 'dateTo', label: t('reports.filters.registeredTo'), type: 'date' },
      ]}
      columns={[
        { key: 'beneficiaryNumber', header: t('reports.columns.number') },
        { key: 'fullName', header: t('reports.columns.fullName') },
        { key: 'phone', header: t('reports.columns.phone') },
        { key: 'status', header: t('table.status') },
        {
          key: 'createdDate',
          header: t('reports.columns.created'),
          render: (row) => String(row.createdDate).slice(0, 10),
        },
        { key: 'dispensingCount', header: t('reports.columns.dispensings') },
        {
          key: 'lastDispensingDate',
          header: t('reports.columns.lastDispensing'),
          render: (row) => String(row.lastDispensingDate ?? t('common.emDash')).slice(0, 10),
        },
      ]}
    />
  );
}
