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

interface MedicineOption {
  id: string;
  name: string;
  isActive: boolean;
  unit?: { code: string };
}

interface RequestItem {
  id?: string;
  medicineId: string;
  requestedQty: number;
  approvedQty?: number | null;
  notes?: string | null;
  medicine?: MedicineOption;
}

interface SupplyRequest {
  id: string;
  requestNumber: string;
  status: string;
  notes?: string | null;
  rejectionReason?: string | null;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  itemCount?: number;
  pharmacy?: { name: string };
  warehouse?: { id: string; name: string };
  createdBy?: { firstName: string; lastName: string };
  items: RequestItem[];
}

interface DraftItem {
  medicineId: string;
  requestedQty: string;
  notes: string;
}

const emptyItem = (): DraftItem => ({ medicineId: '', requestedQty: '100', notes: '' });

export default function PharmacySupplyRequestsPage() {
  const { t } = useI18n();
  const dash = t('common.emDash');
  const { user } = useAuth();
  const toast = useToast();
  const client = useQueryClient();
  const canCreate = hasPermission(user, 'supply-request:create') || hasPermission(user, 'supply-requests:create');
  const canSubmit = hasPermission(user, 'supply-request:submit') || hasPermission(user, 'supply-requests:submit');
  const canCancel = hasPermission(user, 'supply-request:cancel') || hasPermission(user, 'supply-requests:cancel');

  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<'list' | 'create' | 'edit'>('list');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [warehouseId, setWarehouseId] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<DraftItem[]>([emptyItem()]);
  const [prefillApplied, setPrefillApplied] = useState(false);

  const params = useMemo(() => {
    const query = new URLSearchParams({ limit: '50' });
    if (status) query.set('status', status);
    if (search.trim()) query.set('search', search.trim());
    return query.toString();
  }, [status, search]);

  const warehouses = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => apiRequest<Array<{ id: string; name: string; code: string }>>('/warehouses'),
  });
  const medicines = useQuery({
    queryKey: ['medicines-sr'],
    queryFn: () => apiList<MedicineOption>('/medicines?limit=100&isActive=true'),
  });
  const requests = useQuery({
    queryKey: ['supply-requests', params],
    queryFn: () => apiList<SupplyRequest>(`/supply-requests?${params}`),
  });

  useEffect(() => {
    if (prefillApplied || !canCreate) return;
    if (typeof window === 'undefined') return;
    const query = new URLSearchParams(window.location.search);
    const wantsCreate = query.get('create') === '1';
    const medicineId = query.get('medicineId');
    if (!wantsCreate && !medicineId) return;
    if (!warehouses.data?.length) return;

    setEditingId(null);
    setWarehouseId(warehouses.data[0]?.id ?? '');
    setNotes(medicineId ? t('supply.prefillNotes') : '');
    setItems([
      {
        medicineId: medicineId ?? '',
        requestedQty: '100',
        notes: medicineId ? t('supply.prefillItemNotes') : '',
      },
    ]);
    setMode('create');
    setPrefillApplied(true);
  }, [canCreate, prefillApplied, warehouses.data, t]);

  useEffect(() => {
    if ((mode !== 'create' && mode !== 'edit') || warehouseId) return;
    const first = warehouses.data?.[0]?.id;
    if (first) setWarehouseId(first);
  }, [mode, warehouseId, warehouses.data]);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        warehouseId: warehouseId || warehouses.data?.[0]?.id,
        pharmacyId: user?.pharmacyId ?? undefined,
        notes: notes.trim() || undefined,
        items: items.map((item) => ({
          medicineId: item.medicineId,
          requestedQty: Number(item.requestedQty),
          notes: item.notes.trim() || undefined,
        })),
      };
      if (!body.warehouseId) throw new Error(t('supply.warehouseRequired'));
      if (editingId) {
        return apiRequest(`/supply-requests/${editingId}`, { method: 'PATCH', body });
      }
      return apiRequest<SupplyRequest>('/supply-requests', { method: 'POST', body });
    },
    onSuccess: async () => {
      toast.push(editingId ? t('toasts.draftUpdated') : t('toasts.draftCreated'));
      setMode('list');
      setEditingId(null);
      await client.invalidateQueries({ queryKey: ['supply-requests'] });
    },
    onError: (error: Error) => toast.push(error.message, 'error'),
  });

  const submit = useMutation({
    mutationFn: (id: string) => apiRequest(`/supply-requests/${id}/submit`, { method: 'POST' }),
    onSuccess: async () => {
      toast.push(t('toasts.requestSubmitted'));
      await client.invalidateQueries({ queryKey: ['supply-requests'] });
    },
    onError: (error: Error) => toast.push(error.message, 'error'),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => apiRequest(`/supply-requests/${id}/cancel`, { method: 'POST' }),
    onSuccess: async () => {
      toast.push(t('toasts.requestCancelled'));
      await client.invalidateQueries({ queryKey: ['supply-requests'] });
    },
    onError: (error: Error) => toast.push(error.message, 'error'),
  });

  function startCreate() {
    setEditingId(null);
    setWarehouseId(warehouses.data?.[0]?.id ?? '');
    setNotes('');
    setItems([emptyItem()]);
    setMode('create');
  }

  function startEdit(row: SupplyRequest) {
    setEditingId(row.id);
    setWarehouseId(row.warehouse?.id ?? '');
    setNotes(row.notes ?? '');
    setItems(
      row.items.map((item) => ({
        medicineId: item.medicineId,
        requestedQty: String(item.requestedQty),
        notes: item.notes ?? '',
      })),
    );
    setMode('edit');
  }

  if (mode === 'create' || mode === 'edit') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">
            {mode === 'edit' ? t('supply.editDraftRequest') : t('supply.createRequest')}
          </h1>
          <Button variant="outline" onClick={() => setMode('list')}>
            {t('common.back')}
          </Button>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{t('supply.requestDetails')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-1">
              <Label htmlFor="supply-warehouse">{t('table.warehouse')}</Label>
              {warehouses.isError ? (
                <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {t('supply.warehouseLoadFailed')}
                </p>
              ) : (
                <select
                  id="supply-warehouse"
                  className="flex h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  value={warehouseId}
                  disabled={warehouses.isLoading || (warehouses.data?.length ?? 0) === 0}
                  onChange={(e) => setWarehouseId(e.target.value)}
                >
                  <option value="">
                    {warehouses.isLoading
                      ? t('common.loading')
                      : (warehouses.data?.length ?? 0) === 0
                        ? t('supply.noWarehouses')
                        : t('warehouse.select')}
                  </option>
                  {(warehouses.data ?? []).map((wh) => (
                    <option key={wh.id} value={wh.id}>
                      {wh.name} ({wh.code})
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="grid gap-1 md:col-span-2">
              <Label>{t('table.notes')}</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t('supply.medicines')}</CardTitle>
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
                        prev.map((row, i) => (i === index ? { ...row, medicineId: e.target.value } : row)),
                      )
                    }
                  >
                    <option value="">{t('warehouse.select')}</option>
                    {(medicines.data?.items ?? []).filter((m) => m.isActive).map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1">
                  <Label>{t('supply.requestedQty')}</Label>
                  <Input
                    type="number"
                    min={1}
                    value={item.requestedQty}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((row, i) => (i === index ? { ...row, requestedQty: e.target.value } : row)),
                      )
                    }
                  />
                </div>
                <div className="grid gap-1">
                  <Label>{t('table.notes')}</Label>
                  <Input
                    value={item.notes}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((row, i) => (i === index ? { ...row, notes: e.target.value } : row)),
                      )
                    }
                  />
                  {items.length > 1 ? (
                    <Button size="sm" variant="ghost" onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}>
                      {t('actions.remove')}
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {t('actions.saveDraft')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('supply.requestsTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('supply.requestsSubtitle')}</p>
        </div>
        {canCreate ? (
          <Button onClick={startCreate}>{t('actions.createRequest')}</Button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          className="max-w-xs"
          placeholder={t('filters.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('filters.allStatuses')}</option>
          {['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'FULFILLED', 'CANCELLED', 'PARTIALLY_FULFILLED'].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">{t('table.number')}</th>
              <th className="px-3 py-2">{t('table.status')}</th>
              <th className="px-3 py-2">{t('table.items')}</th>
              <th className="px-3 py-2">{t('table.submitted')}</th>
              <th className="px-3 py-2">{t('table.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {(requests.data?.items ?? []).map((row) => (
              <tr key={row.id} className="border-t">
                <td className="px-3 py-2">
                  <Link href={`/pharmacy/supply-requests/${row.id}`} className="font-medium text-primary hover:underline">
                    {row.requestNumber}
                  </Link>
                </td>
                <td className="px-3 py-2"><Badge>{row.status}</Badge></td>
                <td className="px-3 py-2">{row.items?.length ?? row.itemCount ?? 0}</td>
                <td className="px-3 py-2">
                  {row.submittedAt ? String(row.submittedAt).slice(0, 10) : dash}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {row.status === 'DRAFT' && canCreate ? (
                      <Button size="sm" variant="outline" onClick={() => startEdit(row)}>
                        {t('actions.edit')}
                      </Button>
                    ) : null}
                    {row.status === 'DRAFT' && canSubmit ? (
                      <Button size="sm" onClick={() => submit.mutate(row.id)}>
                        {t('actions.submit')}
                      </Button>
                    ) : null}
                    {(row.status === 'DRAFT' || row.status === 'SUBMITTED') && canCancel ? (
                      <Button size="sm" variant="destructive" onClick={() => cancel.mutate(row.id)}>
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
    </div>
  );
}
