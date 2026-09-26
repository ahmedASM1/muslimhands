'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { movementLabel, useI18n } from '@/i18n';
import { apiList } from '@/lib/api';

interface MovementRow {
  id: string;
  occurredAt: string;
  movementType: string;
  quantity: number;
  referenceType?: string | null;
  referenceId?: string | null;
  reason?: string | null;
  medicine?: { name: string; sku: string };
  batch?: { batchNumber: string };
  performedBy?: { firstName: string; lastName: string } | null;
}

const MOVEMENT_TYPES = [
  'RECEIPT',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'DAMAGE',
  'EXPIRED',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'DISPENSE',
  'RETURN',
] as const;

export default function MovementsPage() {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [movementType, setMovementType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const params = useMemo(() => {
    const query = new URLSearchParams({ limit: '100', locationType: 'WAREHOUSE' });
    if (search.trim()) query.set('search', search.trim());
    if (movementType) query.set('movementType', movementType);
    if (from) query.set('from', new Date(from).toISOString());
    if (to) query.set('to', new Date(`${to}T23:59:59`).toISOString());
    return query.toString();
  }, [search, movementType, from, to]);

  const movements = useQuery({
    queryKey: ['movements', params],
    queryFn: () => apiList<MovementRow>(`/stock-movements?${params}`),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t('warehouse.movementsTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('warehouse.movementsSubtitle')}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          className="max-w-xs"
          placeholder={t('warehouse.searchMovement')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={movementType}
          onChange={(e) => setMovementType(e.target.value)}
        >
          <option value="">{t('filters.allTypes')}</option>
          {MOVEMENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {movementLabel(t, type)}
            </option>
          ))}
        </select>
        <Input type="date" className="max-w-[10rem]" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" className="max-w-[10rem]" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">{t('table.date')}</th>
              <th className="px-3 py-2 font-medium">{t('table.medicine')}</th>
              <th className="px-3 py-2 font-medium">{t('table.batch')}</th>
              <th className="px-3 py-2 font-medium">{t('warehouse.movementType')}</th>
              <th className="px-3 py-2 font-medium">{t('table.quantity')}</th>
              <th className="px-3 py-2 font-medium">{t('table.reference')}</th>
              <th className="px-3 py-2 font-medium">{t('table.performedBy')}</th>
            </tr>
          </thead>
          <tbody>
            {(movements.data?.items ?? []).map((row) => (
              <tr key={row.id} className="border-t">
                <td className="px-3 py-2">{String(row.occurredAt).replace('T', ' ').slice(0, 16)}</td>
                <td className="px-3 py-2">
                  <p className="font-medium">{row.medicine?.name}</p>
                  <p className="text-xs text-muted-foreground">{row.medicine?.sku}</p>
                </td>
                <td className="px-3 py-2">{row.batch?.batchNumber ?? t('common.emDash')}</td>
                <td className="px-3 py-2">
                  <Badge variant="outline">{movementLabel(t, row.movementType)}</Badge>
                </td>
                <td className={`px-3 py-2 font-medium ${row.quantity < 0 ? 'text-destructive' : 'text-emerald-700'}`}>
                  {row.quantity > 0 ? `+${row.quantity}` : row.quantity}
                </td>
                <td className="px-3 py-2">
                  {row.referenceType ?? t('common.emDash')}
                  {row.reason ? <p className="text-xs text-muted-foreground">{row.reason}</p> : null}
                </td>
                <td className="px-3 py-2">
                  {row.performedBy
                    ? `${row.performedBy.firstName} ${row.performedBy.lastName}`
                    : t('common.emDash')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(movements.data?.items.length ?? 0) === 0 && !movements.isLoading ? (
          <p className="p-6 text-sm text-muted-foreground">{t('warehouse.noMovements')}</p>
        ) : null}
      </div>
    </div>
  );
}
