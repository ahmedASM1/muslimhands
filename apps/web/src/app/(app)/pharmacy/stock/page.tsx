'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { movementLabel, useI18n } from '@/i18n';
import { apiList, apiRequest } from '@/lib/api';

interface StockRow {
  id: string;
  medicineId: string;
  quantity: number;
  stockStatus: string;
  expiryStatus: string;
  medicine?: { name: string; sku: string; unit?: { code: string } };
  batch?: { batchNumber: string; expiryDate: string };
  lastMovement?: { movementType: string; occurredAt: string } | null;
}

interface MedicineDetails {
  medicine: { name: string; sku: string; minimumStock: number; unit?: { name: string } };
  totalQuantity: number;
  batches: Array<{
    id: string;
    quantity: number;
    stockStatus: string;
    batch: { batchNumber: string; expiryDate: string };
  }>;
  movements: Array<{
    id: string;
    occurredAt: string;
    movementType: string;
    quantity: number;
    batch?: { batchNumber: string };
    performedBy?: { firstName: string; lastName: string } | null;
  }>;
}

export default function PharmacyStockPage() {
  const { t } = useI18n();
  const dash = t('common.emDash');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [selectedMedicineId, setSelectedMedicineId] = useState<string | null>(null);

  const params = useMemo(() => {
    const query = new URLSearchParams({ limit: '100' });
    if (search.trim()) query.set('search', search.trim());
    if (filter === 'low') query.set('lowStock', 'true');
    if (filter === 'expired') query.set('expired', 'true');
    if (filter === 'expiring') query.set('expiringSoon', 'true');
    if (filter === 'out') query.set('outOfStock', 'true');
    return query.toString();
  }, [search, filter]);

  const stock = useQuery({
    queryKey: ['pharmacy-stock', params],
    queryFn: () => apiList<StockRow>(`/pharmacy-stock?${params}`),
  });

  const details = useQuery({
    queryKey: ['pharmacy-stock-medicine', selectedMedicineId],
    queryFn: () => apiRequest<MedicineDetails>(`/pharmacy-stock/medicines/${selectedMedicineId}`),
    enabled: Boolean(selectedMedicineId),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t('stock.pharmacyTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('pharmacy.stockReadOnlyNote')}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          className="max-w-xs"
          placeholder={t('filters.searchMedicineOrBatch')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="">{t('filters.allStatuses')}</option>
          <option value="low">{t('filters.lowStock')}</option>
          <option value="out">{t('filters.outOfStock')}</option>
          <option value="expiring">{t('filters.expiringSoon')}</option>
          <option value="expired">{t('filters.expired')}</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">{t('table.medicine')}</th>
              <th className="px-3 py-2">{t('table.batch')}</th>
              <th className="px-3 py-2">{t('table.expiry')}</th>
              <th className="px-3 py-2">{t('table.quantity')}</th>
              <th className="px-3 py-2">{t('table.unit')}</th>
              <th className="px-3 py-2">{t('table.status')}</th>
              <th className="px-3 py-2">{t('table.lastMovement')}</th>
            </tr>
          </thead>
          <tbody>
            {(stock.data?.items ?? []).map((row) => (
              <tr key={row.id} className="border-t">
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="font-medium text-primary hover:underline"
                    onClick={() => setSelectedMedicineId(row.medicineId)}
                  >
                    {row.medicine?.name}
                  </button>
                </td>
                <td className="px-3 py-2">{row.batch?.batchNumber}</td>
                <td className="px-3 py-2">
                  {row.batch?.expiryDate?.slice(0, 10)}
                  <div className="mt-1">
                    <StatusBadge status={row.expiryStatus} kind="stock" />
                  </div>
                </td>
                <td className="px-3 py-2 font-medium">{row.quantity}</td>
                <td className="px-3 py-2">{row.medicine?.unit?.code ?? dash}</td>
                <td className="px-3 py-2">
                  <StatusBadge status={row.stockStatus} kind="stock" />
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {row.lastMovement
                    ? `${movementLabel(t, row.lastMovement.movementType)} · ${String(row.lastMovement.occurredAt).slice(0, 10)}`
                    : dash}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(stock.data?.items.length ?? 0) === 0 && !stock.isLoading ? (
          <p className="p-6 text-sm text-muted-foreground">
            {t('stock.pharmacyEmpty')}
          </p>
        ) : null}
      </div>

      {selectedMedicineId && details.data ? (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between">
            <div>
              <CardTitle>{details.data.medicine.name}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {t('pharmacy.totalMinShort', {
                  total: details.data.totalQuantity,
                  min: details.data.medicine.minimumStock,
                })}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setSelectedMedicineId(null)}>
              {t('actions.close')}
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-x-auto rounded-md border">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="px-3 py-2">{t('table.batch')}</th>
                    <th className="px-3 py-2">{t('table.expiry')}</th>
                    <th className="px-3 py-2">{t('table.qty')}</th>
                    <th className="px-3 py-2">{t('table.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {details.data.batches.map((row) => (
                    <tr key={row.id} className="border-t">
                      <td className="px-3 py-2">{row.batch.batchNumber}</td>
                      <td className="px-3 py-2">{row.batch.expiryDate.slice(0, 10)}</td>
                      <td className="px-3 py-2">{row.quantity}</td>
                      <td className="px-3 py-2">
                        <StatusBadge status={row.stockStatus} kind="stock" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="overflow-x-auto rounded-md border">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="px-3 py-2">{t('table.date')}</th>
                    <th className="px-3 py-2">{t('table.type')}</th>
                    <th className="px-3 py-2">{t('table.qty')}</th>
                    <th className="px-3 py-2">{t('table.batch')}</th>
                    <th className="px-3 py-2">{t('pharmacy.by')}</th>
                  </tr>
                </thead>
                <tbody>
                  {details.data.movements.map((row) => (
                    <tr key={row.id} className="border-t">
                      <td className="px-3 py-2">{String(row.occurredAt).replace('T', ' ').slice(0, 16)}</td>
                      <td className="px-3 py-2">{movementLabel(t, row.movementType)}</td>
                      <td className="px-3 py-2">{row.quantity > 0 ? `+${row.quantity}` : row.quantity}</td>
                      <td className="px-3 py-2">{row.batch?.batchNumber ?? dash}</td>
                      <td className="px-3 py-2">
                        {row.performedBy
                          ? `${row.performedBy.firstName} ${row.performedBy.lastName}`
                          : dash}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
