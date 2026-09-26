'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiList, apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { hasPermission } from '@/lib/permissions';
import { useToast } from '@/lib/toast';
import { useI18n } from '@/i18n';

interface Transfer {
  id: string;
  transferNumber: string;
  status: string;
  notes?: string | null;
  preparedAt?: string | null;
  dispatchedAt?: string | null;
  receivedAt?: string | null;
  pharmacy?: { id: string; name: string };
  warehouse?: { id: string; name: string };
  supplyRequestId?: string | null;
  items: Array<{
    id: string;
    medicineId: string;
    batchId: string;
    quantity: number;
    medicine?: { name: string; unit?: { code: string } };
    batch?: { batchNumber: string; expiryDate: string };
  }>;
}

interface DraftItem {
  medicineId: string;
  batchId: string;
  quantity: string;
}

const emptyItem = (): DraftItem => ({ medicineId: '', batchId: '', quantity: '50' });

export default function WarehouseTransfersPage() {
  const { t } = useI18n();
  const dash = t('common.emDash');
  const { user } = useAuth();
  const toast = useToast();
  const client = useQueryClient();

  const canCreate = hasPermission(user, 'transfer:create') || hasPermission(user, 'transfers:create');
  const canPrepare = hasPermission(user, 'transfer:prepare') || hasPermission(user, 'transfers:prepare');
  const canShip = hasPermission(user, 'transfer:ship') || hasPermission(user, 'transfers:dispatch');
  const canCancel = hasPermission(user, 'transfer:cancel');

  const [status, setStatus] = useState('');
  const [mode, setMode] = useState<'list' | 'create'>('list');
  const [warehouseId, setWarehouseId] = useState('');
  const [pharmacyId, setPharmacyId] = useState('');
  const [supplyRequestId, setSupplyRequestId] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<DraftItem[]>([emptyItem()]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const fromRequest = new URLSearchParams(window.location.search).get('fromRequest');
    if (fromRequest) {
      setSupplyRequestId(fromRequest);
      setMode('create');
    }
  }, []);

  const params = useMemo(() => {
    const query = new URLSearchParams({ limit: '50' });
    if (status) query.set('status', status);
    return query.toString();
  }, [status]);

  const warehouses = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => apiRequest<Array<{ id: string; name: string; code: string }>>('/warehouses'),
  });
  const pharmacies = useQuery({
    queryKey: ['pharmacies'],
    queryFn: () => apiRequest<Array<{ id: string; name: string; code: string }>>('/pharmacies'),
  });
  const stock = useQuery({
    queryKey: ['wh-stock-transfer'],
    queryFn: () =>
      apiList<{
        medicineId: string;
        batchId: string;
        quantity: number;
        medicine?: { id: string; name: string };
        batch?: { id: string; batchNumber: string; expiryDate: string };
      }>('/warehouse-stock?limit=100'),
  });
  const transfers = useQuery({
    queryKey: ['transfers', params],
    queryFn: () => apiList<Transfer>(`/transfers?${params}`),
  });
  const linkedRequest = useQuery({
    queryKey: ['sr-for-transfer', supplyRequestId],
    queryFn: () =>
      apiRequest<{
        id: string;
        pharmacyId: string;
        warehouseId: string;
        pharmacy?: { id: string };
        warehouse?: { id: string };
        items: Array<{
          medicineId: string;
          requestedQty: number;
          approvedQty?: number | null;
          fulfilledQty?: number;
          medicine?: { name: string };
        }>;
      }>(`/supply-requests/${supplyRequestId}`),
    enabled: Boolean(supplyRequestId),
  });

  useEffect(() => {
    if (linkedRequest.data) {
      setPharmacyId(linkedRequest.data.pharmacyId);
      setWarehouseId(linkedRequest.data.warehouseId);
    }
  }, [linkedRequest.data]);

  const detail = useQuery({
    queryKey: ['transfer', selectedId],
    queryFn: () => apiRequest<Transfer>(`/transfers/${selectedId}`),
    enabled: Boolean(selectedId),
  });

  const create = useMutation({
    mutationFn: () =>
      apiRequest('/transfers', {
        method: 'POST',
        body: {
          warehouseId: warehouseId || warehouses.data?.[0]?.id,
          pharmacyId,
          supplyRequestId: supplyRequestId || undefined,
          notes: notes.trim() || undefined,
          items: items.map((item) => ({
            medicineId: item.medicineId,
            batchId: item.batchId,
            quantity: Number(item.quantity),
          })),
        },
      }),
    onSuccess: async () => {
      toast.push(t('toasts.draftTransferCreated'));
      setMode('list');
      await client.invalidateQueries({ queryKey: ['transfers'] });
    },
    onError: (error: Error) => toast.push(error.message, 'error'),
  });

  const action = useMutation({
    mutationFn: ({ id, path }: { id: string; path: string }) =>
      apiRequest(`/transfers/${id}/${path}`, { method: 'POST' }),
    onSuccess: async (_, vars) => {
      toast.push(t('toasts.transferActionCompleted', { action: vars.path }));
      await client.invalidateQueries({ queryKey: ['transfers'] });
      await client.invalidateQueries({ queryKey: ['transfer'] });
      await client.invalidateQueries({ queryKey: ['warehouse-stock'] });
      await client.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (error: Error) => toast.push(error.message, 'error'),
  });

  const batchesForMedicine = (medicineId: string) =>
    (stock.data?.items ?? []).filter(
      (row) => row.medicineId === medicineId && row.quantity > 0 && new Date(row.batch?.expiryDate ?? 0) >= new Date(new Date().toISOString().slice(0, 10)),
    );

  const medicines = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of stock.data?.items ?? []) {
      if (row.medicine) map.set(row.medicineId, row.medicine.name);
    }
    return [...map.entries()];
  }, [stock.data]);

  if (mode === 'create') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">{t('warehouse.createTransfer')}</h1>
          <Button variant="outline" onClick={() => setMode('list')}>
            {t('common.back')}
          </Button>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{t('warehouse.header')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-1">
              <Label>{t('table.warehouse')}</Label>
              <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                {(warehouses.data ?? []).map((wh) => (
                  <option key={wh.id} value={wh.id}>{wh.code} — {wh.name}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <Label>{t('warehouse.destinationPharmacy')}</Label>
              <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={pharmacyId} onChange={(e) => setPharmacyId(e.target.value)}>
                <option value="">{t('warehouse.select')}</option>
                {(pharmacies.data ?? []).map((ph) => (
                  <option key={ph.id} value={ph.id}>{ph.code} — {ph.name}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-1 md:col-span-2">
              <Label>{t('warehouse.linkedSupplyRequest')}</Label>
              <Input
                value={supplyRequestId}
                onChange={(e) => setSupplyRequestId(e.target.value)}
                placeholder={t('warehouse.linkedRequestPlaceholder')}
              />
              {linkedRequest.data ? (
                <p className="text-xs text-muted-foreground">
                  {t('warehouse.linkedRequestLoaded', { count: linkedRequest.data.items.length })}
                </p>
              ) : null}
            </div>
            <div className="grid gap-1 md:col-span-2">
              <Label>{t('table.notes')}</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        {linkedRequest.data ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('warehouse.approvedQuantities')}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              {linkedRequest.data.items.map((item, index) => (
                <p key={index}>
                  {t('warehouse.approvedLineSummary', {
                    name: item.medicine?.name ?? '',
                    requested: item.requestedQty,
                    approved: item.approvedQty ?? 0,
                    fulfilled: item.fulfilledQty ?? 0,
                    remaining: (item.approvedQty ?? 0) - (item.fulfilledQty ?? 0),
                  })}
                </p>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t('warehouse.items')}</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setItems((prev) => [...prev, emptyItem()])}>
              {t('actions.addItem')}
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {items.map((item, index) => (
              <div key={index} className="grid gap-2 rounded-md border p-3 md:grid-cols-4">
                <div className="grid gap-1 md:col-span-2">
                  <Label>{t('table.medicine')}</Label>
                  <select
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={item.medicineId}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((row, i) => (i === index ? { ...row, medicineId: e.target.value, batchId: '' } : row)),
                      )
                    }
                  >
                    <option value="">{t('warehouse.select')}</option>
                    {medicines.map(([id, name]) => (
                      <option key={id} value={id}>{name}</option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1">
                  <Label>{t('table.batch')}</Label>
                  <select
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={item.batchId}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((row, i) => (i === index ? { ...row, batchId: e.target.value } : row)),
                      )
                    }
                  >
                    <option value="">{t('warehouse.select')}</option>
                    {batchesForMedicine(item.medicineId).map((row) => (
                      <option key={row.batchId} value={row.batchId}>
                        {t('warehouse.batchOption', {
                          batchNumber: row.batch?.batchNumber ?? '',
                          avail: row.quantity,
                          date: row.batch?.expiryDate?.slice(0, 10) ?? '',
                        })}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1">
                  <Label>{t('table.quantity')}</Label>
                  <Input
                    type="number"
                    min={1}
                    value={item.quantity}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((row, i) => (i === index ? { ...row, quantity: e.target.value } : row)),
                      )
                    }
                  />
                </div>
              </div>
            ))}
            {canCreate ? (
              <Button onClick={() => create.mutate()} disabled={create.isPending || !pharmacyId}>
                {t('actions.saveDraftTransfer')}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('warehouse.transfersTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('warehouse.transfersSubtitle')}</p>
        </div>
        {canCreate ? (
          <Button onClick={() => setMode('create')}>{t('warehouse.createTransfer')}</Button>
        ) : null}
      </div>

      <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">{t('filters.allStatuses')}</option>
        {['DRAFT', 'PREPARED', 'SHIPPED', 'RECEIVED', 'CANCELLED'].map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>

      <div className="overflow-x-auto rounded-md border">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">{t('table.number')}</th>
              <th className="px-3 py-2">{t('table.pharmacy')}</th>
              <th className="px-3 py-2">{t('table.status')}</th>
              <th className="px-3 py-2">{t('table.items')}</th>
              <th className="px-3 py-2">{t('table.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {(transfers.data?.items ?? []).map((row) => (
              <tr key={row.id} className="border-t">
                <td className="px-3 py-2">
                  <button type="button" className="font-medium text-primary hover:underline" onClick={() => setSelectedId(row.id)}>
                    {row.transferNumber}
                  </button>
                </td>
                <td className="px-3 py-2">{row.pharmacy?.name}</td>
                <td className="px-3 py-2"><Badge>{row.status}</Badge></td>
                <td className="px-3 py-2">{row.items.length}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/warehouse/transfers/${row.id}`}>{t('actions.open')}</Link>
                    </Button>
                    {row.status === 'DRAFT' && canPrepare ? (
                      <Button size="sm" onClick={() => action.mutate({ id: row.id, path: 'prepare' })}>
                        {t('actions.prepare')}
                      </Button>
                    ) : null}
                    {row.status === 'PREPARED' && canShip ? (
                      <Button size="sm" onClick={() => {
                        if (window.confirm(t('confirm.shipTransfer'))) {
                          action.mutate({ id: row.id, path: 'ship' });
                        }
                      }}>
                        {t('actions.ship')}
                      </Button>
                    ) : null}
                    {(row.status === 'DRAFT' || row.status === 'PREPARED') && canCancel ? (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => action.mutate({ id: row.id, path: 'cancel' })}
                      >
                        {t('actions.cancel')}
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedId && detail.data ? (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between">
            <div>
              <CardTitle>{detail.data.transferNumber}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {detail.data.pharmacy?.name} · <Badge>{detail.data.status}</Badge>
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setSelectedId(null)}>
              {t('common.close')}
            </Button>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid gap-1 md:grid-cols-4">
              <p>{t('warehouse.createdTimeline')}</p>
              <p>
                {t('warehouse.preparedLabel')}{' '}
                {detail.data.preparedAt ? String(detail.data.preparedAt).slice(0, 16) : dash}
              </p>
              <p>
                {t('warehouse.shippedLabel')}{' '}
                {detail.data.dispatchedAt ? String(detail.data.dispatchedAt).slice(0, 16) : dash}
              </p>
              <p>
                {t('warehouse.receivedLabel')}{' '}
                {detail.data.receivedAt ? String(detail.data.receivedAt).slice(0, 16) : dash}
              </p>
            </div>
            <table className="min-w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2">{t('table.medicine')}</th>
                  <th className="px-3 py-2">{t('table.batch')}</th>
                  <th className="px-3 py-2">{t('table.qty')}</th>
                </tr>
              </thead>
              <tbody>
                {detail.data.items.map((item) => (
                  <tr key={item.id} className="border-t">
                    <td className="px-3 py-2">{item.medicine?.name}</td>
                    <td className="px-3 py-2">{item.batch?.batchNumber}</td>
                    <td className="px-3 py-2">{item.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
