'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/status-badge';
import { movementLabel, reasonLabel, useI18n } from '@/i18n';
import { apiList, apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { hasPermission } from '@/lib/permissions';
import { useToast } from '@/lib/toast';

interface StockRow {
  id: string;
  quantity: number;
  medicineId: string;
  batchId: string;
  warehouseId: string;
  stockStatus: string;
  expiryStatus: string;
  medicineTotal: number;
  medicine?: {
    id: string;
    name: string;
    sku: string;
    minimumStock: number;
    unit?: { name: string; code: string };
  };
  batch?: { id: string; batchNumber: string; expiryDate: string };
  lastMovement?: { occurredAt: string; movementType: string; quantity: number } | null;
}

interface MedicineDetails {
  medicine: {
    id: string;
    name: string;
    sku: string;
    minimumStock: number;
    unit?: { name: string };
    category?: { name: string };
  };
  totalQuantity: number;
  stockStatus: string;
  batches: Array<{
    id: string;
    quantity: number;
    warehouseId: string;
    stockStatus: string;
    expiryStatus: string;
    batch: { id: string; batchNumber: string; expiryDate: string };
  }>;
  movements: Array<{
    id: string;
    occurredAt: string;
    movementType: string;
    quantity: number;
    referenceType?: string | null;
    referenceId?: string | null;
    performedBy?: { firstName: string; lastName: string } | null;
    batch?: { batchNumber: string };
  }>;
}

export default function WarehouseStockPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const toast = useToast();
  const client = useQueryClient();
  const canAdjust = hasPermission(user, 'warehouse-stock:adjust');
  const canDamage = hasPermission(user, 'stock:damage');
  const canExpire = hasPermission(user, 'stock:expire');

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedMedicineId, setSelectedMedicineId] = useState<string | null>(null);
  const [action, setAction] = useState<{
    type: 'adjust' | 'damage' | 'expire';
    row: StockRow;
  } | null>(null);
  const [qty, setQty] = useState('1');
  const [direction, setDirection] = useState<'IN' | 'OUT'>('OUT');
  const [reason, setReason] = useState('PHYSICAL_COUNT');
  const [notes, setNotes] = useState('');

  const queryParams = useMemo(() => {
    const params = new URLSearchParams({ limit: '100' });
    if (search.trim()) params.set('search', search.trim());
    if (statusFilter === 'low') params.set('lowStock', 'true');
    if (statusFilter === 'expired') params.set('expired', 'true');
    if (statusFilter === 'expiring') params.set('expiringSoon', 'true');
    if (statusFilter === 'out') params.set('outOfStock', 'true');
    return params.toString();
  }, [search, statusFilter]);

  const stock = useQuery({
    queryKey: ['warehouse-stock', queryParams],
    queryFn: () => apiList<StockRow>(`/warehouse-stock?${queryParams}`),
  });

  const details = useQuery({
    queryKey: ['warehouse-stock-medicine', selectedMedicineId],
    queryFn: () => apiRequest<MedicineDetails>(`/warehouse-stock/medicines/${selectedMedicineId}`),
    enabled: Boolean(selectedMedicineId),
  });

  const mutate = useMutation({
    mutationFn: async () => {
      if (!action) return;
      const quantity = Number(qty);
      const base = {
        warehouseId: action.row.warehouseId,
        medicineId: action.row.medicineId,
        batchId: action.row.batchId,
        quantity,
        notes: notes.trim() || undefined,
      };
      if (action.type === 'adjust') {
        return apiRequest('/warehouse-stock/adjust', {
          method: 'POST',
          body: { ...base, direction, reason, notes: notes.trim() || undefined },
        });
      }
      if (action.type === 'damage') {
        return apiRequest('/warehouse-stock/damage', {
          method: 'POST',
          body: { ...base, notes: notes.trim() },
        });
      }
      return apiRequest('/warehouse-stock/expire', {
        method: 'POST',
        body: base,
      });
    },
    onSuccess: async () => {
      toast.push(t('stock.updated'));
      setAction(null);
      setNotes('');
      setQty('1');
      await client.invalidateQueries({ queryKey: ['warehouse-stock'] });
      await client.invalidateQueries({ queryKey: ['warehouse-stock-medicine'] });
      await client.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (error: Error) => toast.push(error.message, 'error'),
  });

  const dash = t('common.emDash');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('stock.warehouseTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('stock.warehouseSubtitle')}</p>
        </div>
        <Button asChild>
          <Link href="/warehouse/receipts">{t('stock.receiveStock')}</Link>
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          className="max-w-xs"
          placeholder={t('filters.searchMedicineOrBatch')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
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
          <thead className="bg-muted/50 text-start">
            <tr>
              <th className="px-3 py-2 font-medium">{t('table.medicine')}</th>
              <th className="px-3 py-2 font-medium">{t('table.batch')}</th>
              <th className="px-3 py-2 font-medium">{t('table.expiry')}</th>
              <th className="px-3 py-2 font-medium">{t('table.quantity')}</th>
              <th className="px-3 py-2 font-medium">{t('table.unit')}</th>
              <th className="px-3 py-2 font-medium">{t('table.stockStatus')}</th>
              <th className="px-3 py-2 font-medium">{t('table.lastMovement')}</th>
              <th className="px-3 py-2 font-medium">{t('table.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {(stock.data?.items ?? []).map((row) => (
              <tr key={row.id} className="border-t">
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="text-start font-medium text-primary hover:underline"
                    onClick={() => setSelectedMedicineId(row.medicineId)}
                  >
                    {row.medicine?.name}
                  </button>
                  <p className="text-xs text-muted-foreground" dir="ltr">
                    {row.medicine?.sku}
                  </p>
                </td>
                <td className="px-3 py-2" dir="ltr">
                  {row.batch?.batchNumber}
                </td>
                <td className="px-3 py-2">
                  <span dir="ltr">{row.batch?.expiryDate?.slice(0, 10)}</span>
                  <div className="mt-1">
                    <StatusBadge status={row.expiryStatus} kind="stock" />
                  </div>
                </td>
                <td className="px-3 py-2 font-medium" dir="ltr">
                  {row.quantity}
                </td>
                <td className="px-3 py-2" dir="ltr">
                  {row.medicine?.unit?.code ?? row.medicine?.unit?.name ?? dash}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={row.stockStatus} kind="stock" />
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {row.lastMovement
                    ? `${movementLabel(t, row.lastMovement.movementType)} · ${String(row.lastMovement.occurredAt).slice(0, 10)}`
                    : dash}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {canAdjust ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setAction({ type: 'adjust', row });
                          setNotes('');
                        }}
                      >
                        {t('stock.adjust')}
                      </Button>
                    ) : null}
                    {canDamage ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setAction({ type: 'damage', row });
                          setNotes('');
                        }}
                      >
                        {t('stock.damage')}
                      </Button>
                    ) : null}
                    {canExpire ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setAction({ type: 'expire', row });
                          setNotes('');
                        }}
                      >
                        {t('stock.expire')}
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(stock.data?.items.length ?? 0) === 0 && !stock.isLoading ? (
          <p className="p-6 text-sm text-muted-foreground">
            {t('stock.warehouseEmpty')}{' '}
            <Link href="/warehouse/receipts" className="text-primary hover:underline">
              {t('stock.receiveStock')}
            </Link>
          </p>
        ) : null}
      </div>

      {selectedMedicineId && details.data ? (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle>{details.data.medicine.name}</CardTitle>
              <p className="text-sm text-muted-foreground">
                <span dir="ltr">{details.data.medicine.sku}</span>
                {' · '}
                {t('stock.totalMin', {
                  total: details.data.totalQuantity,
                  unit: details.data.medicine.unit?.name ?? t('stock.units'),
                  min: details.data.medicine.minimumStock,
                })}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setSelectedMedicineId(null)}>
              {t('common.close')}
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="mb-2 text-sm font-semibold">{t('stock.batchBreakdown')}</h3>
              <div className="overflow-x-auto rounded-md border">
                <table className="min-w-full text-sm">
                  <thead className="bg-muted/40 text-start">
                    <tr>
                      <th className="px-3 py-2">{t('table.batch')}</th>
                      <th className="px-3 py-2">{t('table.expiry')}</th>
                      <th className="px-3 py-2">{t('table.quantity')}</th>
                      <th className="px-3 py-2">{t('table.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {details.data.batches.map((row) => (
                      <tr key={row.id} className="border-t">
                        <td className="px-3 py-2" dir="ltr">
                          {row.batch.batchNumber}
                        </td>
                        <td className="px-3 py-2" dir="ltr">
                          {row.batch.expiryDate.slice(0, 10)}
                        </td>
                        <td className="px-3 py-2" dir="ltr">
                          {row.quantity}
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge status={row.stockStatus} kind="stock" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold">{t('stock.movementHistory')}</h3>
              <div className="overflow-x-auto rounded-md border">
                <table className="min-w-full text-sm">
                  <thead className="bg-muted/40 text-start">
                    <tr>
                      <th className="px-3 py-2">{t('table.date')}</th>
                      <th className="px-3 py-2">{t('table.type')}</th>
                      <th className="px-3 py-2">{t('table.qty')}</th>
                      <th className="px-3 py-2">{t('table.batch')}</th>
                      <th className="px-3 py-2">{t('table.reference')}</th>
                      <th className="px-3 py-2">{t('table.performedBy')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {details.data.movements.map((row) => (
                      <tr key={row.id} className="border-t">
                        <td className="px-3 py-2" dir="ltr">
                          {String(row.occurredAt).replace('T', ' ').slice(0, 16)}
                        </td>
                        <td className="px-3 py-2">{movementLabel(t, row.movementType)}</td>
                        <td className="px-3 py-2" dir="ltr">
                          {row.quantity > 0 ? `+${row.quantity}` : row.quantity}
                        </td>
                        <td className="px-3 py-2" dir="ltr">
                          {row.batch?.batchNumber ?? dash}
                        </td>
                        <td className="px-3 py-2">{row.referenceType ?? dash}</td>
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
            </div>
          </CardContent>
        </Card>
      ) : null}

      {action ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {action.type === 'adjust'
                ? t('stock.adjustStock')
                : action.type === 'damage'
                  ? t('stock.markDamaged')
                  : t('stock.markExpired')}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid max-w-xl gap-3">
            <p className="text-sm text-muted-foreground">
              {action.row.medicine?.name} · {action.row.batch?.batchNumber} ·{' '}
              {t('stock.available', { qty: action.row.quantity })}
            </p>
            <div className="grid gap-1">
              <Label htmlFor="qty">{t('stock.quantity')}</Label>
              <Input
                id="qty"
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </div>
            {action.type === 'adjust' ? (
              <>
                <div className="grid gap-1">
                  <Label htmlFor="direction">{t('stock.direction')}</Label>
                  <select
                    id="direction"
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={direction}
                    onChange={(e) => setDirection(e.target.value as 'IN' | 'OUT')}
                  >
                    <option value="IN">{t('stock.directionIn')}</option>
                    <option value="OUT">{t('stock.directionOut')}</option>
                  </select>
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="reason">{t('stock.reason')}</Label>
                  <select
                    id="reason"
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  >
                    {(['PHYSICAL_COUNT', 'DAMAGE', 'EXPIRED', 'LOST', 'CORRECTION'] as const).map(
                      (code) => (
                        <option key={code} value={code}>
                          {reasonLabel(t, code)}
                        </option>
                      ),
                    )}
                  </select>
                </div>
              </>
            ) : null}
            <div className="grid gap-1">
              <Label htmlFor="notes">
                {action.type === 'damage' ? t('stock.notesRequired') : t('stock.notes')}
              </Label>
              <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button onClick={() => mutate.mutate()} disabled={mutate.isPending}>
                {t('common.confirm')}
              </Button>
              <Button variant="outline" onClick={() => setAction(null)}>
                {t('common.cancel')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
