'use client';

import { ResourceTable } from '@/components/resource-table';
import { useI18n } from '@/i18n';

export default function PharmacyStockAdminPage() {
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t('stock.pharmacyTitle')}</h1>
      <ResourceTable
        queryKey="pharmacy-stock"
        path="/pharmacy-stock?limit=50"
        empty={t('warehouse.pharmacyStockAdminEmpty')}
        columns={[
          {
            key: 'pharmacy',
            header: t('table.pharmacy'),
            render: (row) => String((row.pharmacy as { name?: string })?.name ?? ''),
          },
          {
            key: 'medicine',
            header: t('table.medicine'),
            render: (row) => String((row.medicine as { name?: string })?.name ?? ''),
          },
          { key: 'quantity', header: t('table.qty') },
          { key: 'stockStatus', header: t('table.status') },
        ]}
      />
    </div>
  );
}
