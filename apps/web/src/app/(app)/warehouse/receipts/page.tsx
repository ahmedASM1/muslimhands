'use client';

import { useMemo, useState } from 'react';
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

interface Warehouse {
  id: string;
  name: string;
  code: string;
}

interface PackLevel {
  code: string;
  label: string;
  factorToBase: number;
}

interface MedicineOption {
  id: string;
  name: string;
  sku: string;
  isActive: boolean;
  unit?: { code: string; name: string };
  packLevels?: PackLevel[];
  batches?: Array<{ id: string; batchNumber: string; expiryDate: string }>;
}

interface ReceiptItem {
  id?: string;
  medicineId: string;
  batchId: string;
  quantity: number;
  packBreakdown?: Array<{ code: string; quantity: number }> | null;
  unitCost?: number | null;
  notes?: string | null;
  medicine?: MedicineOption;
  batch?: { id: string; batchNumber: string; expiryDate: string };
}

interface ReceiptRow {
  id: string;
  receiptNumber: string;
  status: 'DRAFT' | 'POSTED' | 'CANCELLED';
  supplierName?: string | null;
  supplierRef?: string | null;
  notes?: string | null;
  receivedAt?: string | null;
  postedAt?: string | null;
  itemCount: number;
  totalUnits: number;
  estimatedCost: number;
  warehouse?: Warehouse;
  createdBy?: { firstName: string; lastName: string };
  postedBy?: { firstName: string; lastName: string } | null;
  items: ReceiptItem[];
}

interface DraftItem {
  medicineId: string;
  batchMode: 'existing' | 'new';
  batchId: string;
  batchNumber: string;
  manufacturingDate: string;
  expiryDate: string;
  qtyMode: 'base' | 'packs';
  quantity: string;
  packQtys: Record<string, string>;
  unitCost: string;
  notes: string;
}

const emptyItem = (): DraftItem => ({
  medicineId: '',
  batchMode: 'existing',
  batchId: '',
  batchNumber: '',
  manufacturingDate: '',
  expiryDate: '',
  qtyMode: 'base',
  quantity: '1',
  packQtys: {},
  unitCost: '',
  notes: '',
});

function packEntriesFromDraft(item: DraftItem, levels: PackLevel[]) {
  return levels
    .map((level) => ({
      code: level.code,
      quantity: Number(item.packQtys[level.code] || 0),
    }))
    .filter((entry) => entry.quantity > 0);
}

function baseUnitsFromDraft(item: DraftItem, levels: PackLevel[]) {
  if (item.qtyMode === 'packs' && levels.length) {
    return packEntriesFromDraft(item, levels).reduce(
      (sum, entry) =>
        sum +
        entry.quantity * (levels.find((l) => l.code === entry.code)?.factorToBase ?? 1),
      0,
    );
  }
  return Number(item.quantity) || 0;
}

export default function ReceiptsPage() {
  const { t } = useI18n();
  const dash = t('common.emDash');
  const { user } = useAuth();
  const toast = useToast();
  const client = useQueryClient();
  const canCreate = hasPermission(user, 'receipt:create') || hasPermission(user, 'receipts:create');
  const canPost = hasPermission(user, 'receipt:post') || hasPermission(user, 'receipts:post');
  const canCancel = hasPermission(user, 'receipt:cancel');

  const [status, setStatus] = useState('');
  const [supplier, setSupplier] = useState('');
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<'list' | 'create' | 'edit' | 'review'>('list');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);

  const [warehouseId, setWarehouseId] = useState('');
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10));
  const [supplierName, setSupplierName] = useState('');
  const [supplierRef, setSupplierRef] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<DraftItem[]>([emptyItem()]);

  const listParams = useMemo(() => {
    const params = new URLSearchParams({ limit: '50' });
    if (status) params.set('status', status);
    if (supplier.trim()) params.set('supplier', supplier.trim());
    if (search.trim()) params.set('search', search.trim());
    return params.toString();
  }, [status, supplier, search]);

  const warehouses = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => apiRequest<Warehouse[]>('/warehouses'),
  });

  const medicines = useQuery({
    queryKey: ['medicines-receipt'],
    queryFn: () => apiList<MedicineOption>('/medicines?limit=100&isActive=true'),
  });

  const allBatches = useQuery({
    queryKey: ['batches-receipt'],
    queryFn: () =>
      apiList<{ id: string; medicineId: string; batchNumber: string; expiryDate: string }>(
        '/batches?limit=100',
      ),
  });

  const receipts = useQuery({
    queryKey: ['receipts', listParams],
    queryFn: () => apiList<ReceiptRow>(`/receipts?${listParams}`),
  });

  const review = useQuery({
    queryKey: ['receipt', reviewId],
    queryFn: () => apiRequest<ReceiptRow>(`/receipts/${reviewId}`),
    enabled: Boolean(reviewId) && mode === 'review',
  });

  const saveDraft = useMutation({
    mutationFn: async () => {
      const payload = {
        warehouseId: warehouseId || warehouses.data?.[0]?.id,
        receivedAt: receiptDate ? new Date(receiptDate).toISOString() : undefined,
        supplierName: supplierName.trim() || undefined,
        supplierRef: supplierRef.trim() || undefined,
        notes: notes.trim() || undefined,
        items: items.map((item) => {
          const medicine = medicines.data?.items.find((row) => row.id === item.medicineId);
          const levels = medicine?.packLevels ?? [];
          const packEntries =
            item.qtyMode === 'packs' && levels.length ? packEntriesFromDraft(item, levels) : undefined;
          const quantity = packEntries?.length
            ? undefined
            : Number(item.quantity) || 0;
          const base: Record<string, unknown> = {
            medicineId: item.medicineId,
            unitCost: item.unitCost ? Number(item.unitCost) : undefined,
            notes: item.notes.trim() || undefined,
            ...(packEntries?.length ? { packEntries } : { quantity }),
          };
          if (item.batchMode === 'new') {
            base.batchNumber = item.batchNumber.trim();
            base.manufacturingDate = item.manufacturingDate
              ? new Date(item.manufacturingDate).toISOString()
              : undefined;
            base.expiryDate = item.expiryDate
              ? new Date(item.expiryDate).toISOString()
              : undefined;
          } else {
            base.batchId = item.batchId;
          }
          return base;
        }),
      };
      if (!payload.warehouseId) throw new Error(t('supply.warehouseRequired'));
      if (editingId) {
        return apiRequest(`/receipts/${editingId}`, { method: 'PATCH', body: payload });
      }
      return apiRequest<ReceiptRow>('/receipts', { method: 'POST', body: payload });
    },
    onSuccess: async (result) => {
      toast.push(editingId ? t('toasts.draftUpdated') : t('toasts.draftReceiptCreated'));
      await client.invalidateQueries({ queryKey: ['receipts'] });
      const id = (result as ReceiptRow).id ?? editingId;
      if (id) {
        setReviewId(id);
        setMode('review');
      } else {
        setMode('list');
      }
    },
    onError: (error: Error) => toast.push(error.message, 'error'),
  });

  const postReceipt = useMutation({
    mutationFn: (id: string) => apiRequest(`/receipts/${id}/post`, { method: 'POST' }),
    onSuccess: async () => {
      toast.push(t('toasts.receiptPosted'));
      setMode('list');
      setReviewId(null);
      await client.invalidateQueries({ queryKey: ['receipts'] });
      await client.invalidateQueries({ queryKey: ['warehouse-stock'] });
      await client.invalidateQueries({ queryKey: ['dashboard'] });
      await client.invalidateQueries({ queryKey: ['movements'] });
    },
    onError: (error: Error) => toast.push(error.message, 'error'),
  });

  const cancelReceipt = useMutation({
    mutationFn: (id: string) => apiRequest(`/receipts/${id}/cancel`, { method: 'POST' }),
    onSuccess: async () => {
      toast.push(t('toasts.draftReceiptCancelled'));
      await client.invalidateQueries({ queryKey: ['receipts'] });
    },
    onError: (error: Error) => toast.push(error.message, 'error'),
  });

  function startCreate() {
    setEditingId(null);
    setWarehouseId(warehouses.data?.[0]?.id ?? '');
    setReceiptDate(new Date().toISOString().slice(0, 10));
    setSupplierName('');
    setSupplierRef('');
    setNotes('');
    setItems([emptyItem()]);
    setMode('create');
  }

  function startEdit(row: ReceiptRow) {
    setEditingId(row.id);
    setWarehouseId(row.warehouse?.id ?? '');
    setReceiptDate((row.receivedAt ?? new Date().toISOString()).slice(0, 10));
    setSupplierName(row.supplierName ?? '');
    setSupplierRef(row.supplierRef ?? '');
    setNotes(row.notes ?? '');
    setItems(
      row.items.map((item) => {
        const levels = item.medicine?.packLevels ?? [];
        const breakdown = Array.isArray(item.packBreakdown) ? item.packBreakdown : [];
        const packQtys: Record<string, string> = {};
        for (const entry of breakdown) {
          if (entry?.code) packQtys[entry.code] = String(entry.quantity ?? '');
        }
        return {
          medicineId: item.medicineId,
          batchMode: 'existing' as const,
          batchId: item.batchId,
          batchNumber: '',
          manufacturingDate: '',
          expiryDate: '',
          qtyMode: breakdown.length && levels.length ? ('packs' as const) : ('base' as const),
          quantity: String(item.quantity),
          packQtys,
          unitCost: item.unitCost == null ? '' : String(item.unitCost),
          notes: item.notes ?? '',
        };
      }),
    );
    setMode('edit');
  }

  function medicineBatches(medicineId: string) {
    return (allBatches.data?.items ?? []).filter((item) => item.medicineId === medicineId);
  }

  function isExpired(expiryDate: string) {
    return new Date(expiryDate) < new Date(new Date().toISOString().slice(0, 10));
  }

  const estimatedCost = items.reduce((sum, item) => {
    const medicine = medicines.data?.items.find((row) => row.id === item.medicineId);
    const qty = baseUnitsFromDraft(item, medicine?.packLevels ?? []);
    const cost = Number(item.unitCost) || 0;
    return sum + qty * cost;
  }, 0);

  if (mode === 'create' || mode === 'edit') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">
            {mode === 'edit' ? t('warehouse.editDraftReceipt') : t('warehouse.createReceipt')}
          </h1>
          <Button variant="outline" onClick={() => setMode('list')}>
            {t('actions.backToList')}
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t('warehouse.receiptHeader')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-1">
              <Label>{t('table.warehouse')}</Label>
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
              >
                {(warehouses.data ?? []).map((wh) => (
                  <option key={wh.id} value={wh.id}>
                    {wh.code} {dash} {wh.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <Label>{t('warehouse.receiptDate')}</Label>
              <Input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>{t('warehouse.supplierOptional')}</Label>
              <Input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>{t('warehouse.supplierRefOptional')}</Label>
              <Input value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} />
            </div>
            <div className="grid gap-1 md:col-span-2">
              <Label>{t('table.notes')}</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t('warehouse.items')}</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setItems((prev) => [...prev, emptyItem()])}>
              {t('actions.addItem')}
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {items.map((item, index) => {
              const medicine = medicines.data?.items.find((row) => row.id === item.medicineId);
              const levels = medicine?.packLevels ?? [];
              const batch = medicineBatches(item.medicineId).find((row) => row.id === item.batchId);
              const qty = baseUnitsFromDraft(item, levels);
              const cost = Number(item.unitCost) || 0;
              return (
                <div key={index} className="space-y-3 rounded-md border p-3">
                  <div className="grid gap-2 md:grid-cols-2">
                    <div className="grid gap-1">
                      <Label>{t('table.medicine')}</Label>
                      <select
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                        value={item.medicineId}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((row, i) =>
                              i === index
                                ? {
                                    ...row,
                                    medicineId: e.target.value,
                                    batchId: '',
                                    packQtys: {},
                                    qtyMode:
                                      (medicines.data?.items.find((m) => m.id === e.target.value)
                                        ?.packLevels?.length ?? 0) > 0
                                        ? 'packs'
                                        : 'base',
                                  }
                                : row,
                            ),
                          )
                        }
                      >
                        <option value="">{t('warehouse.selectMedicine')}</option>
                        {(medicines.data?.items ?? [])
                          .filter((row) => row.isActive)
                          .map((row) => (
                            <option key={row.id} value={row.id}>
                              {row.name}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="grid gap-1">
                      <Label>{t('table.batch')}</Label>
                      <select
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                        value={item.batchMode}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((row, i) =>
                              i === index
                                ? {
                                    ...row,
                                    batchMode: e.target.value as 'existing' | 'new',
                                    batchId: '',
                                  }
                                : row,
                            ),
                          )
                        }
                      >
                        <option value="existing">{t('warehouse.existingBatch')}</option>
                        <option value="new">{t('warehouse.newBatch')}</option>
                      </select>
                    </div>
                  </div>

                  {item.batchMode === 'existing' ? (
                    <div className="grid gap-1 md:max-w-md">
                      <Label>{t('warehouse.selectBatch')}</Label>
                      <select
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                        value={item.batchId}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((row, i) =>
                              i === index ? { ...row, batchId: e.target.value } : row,
                            ),
                          )
                        }
                      >
                        <option value="">{t('warehouse.selectBatch')}</option>
                        {medicineBatches(item.medicineId).map((row) => (
                          <option key={row.id} value={row.id} disabled={isExpired(row.expiryDate)}>
                            {t('warehouse.batchExp', {
                              batchNumber: row.batchNumber,
                              date: row.expiryDate.slice(0, 10),
                            })}
                            {isExpired(row.expiryDate) ? t('warehouse.batchExpiredSuffix') : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="grid gap-2 md:grid-cols-3">
                      <div className="grid gap-1">
                        <Label>{t('warehouse.batchNumber')}</Label>
                        <Input
                          value={item.batchNumber}
                          onChange={(e) =>
                            setItems((prev) =>
                              prev.map((row, i) =>
                                i === index ? { ...row, batchNumber: e.target.value } : row,
                              ),
                            )
                          }
                        />
                      </div>
                      <div className="grid gap-1">
                        <Label>{t('warehouse.manufacturingDate')}</Label>
                        <Input
                          type="date"
                          value={item.manufacturingDate}
                          onChange={(e) =>
                            setItems((prev) =>
                              prev.map((row, i) =>
                                i === index ? { ...row, manufacturingDate: e.target.value } : row,
                              ),
                            )
                          }
                        />
                      </div>
                      <div className="grid gap-1">
                        <Label>{t('warehouse.expiryDate')}</Label>
                        <Input
                          type="date"
                          value={item.expiryDate}
                          onChange={(e) =>
                            setItems((prev) =>
                              prev.map((row, i) =>
                                i === index ? { ...row, expiryDate: e.target.value } : row,
                              ),
                            )
                          }
                        />
                      </div>
                    </div>
                  )}

                  {levels.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={item.qtyMode === 'base' ? 'default' : 'outline'}
                        onClick={() =>
                          setItems((prev) =>
                            prev.map((row, i) => (i === index ? { ...row, qtyMode: 'base' } : row)),
                          )
                        }
                      >
                        {t('warehouse.qtyModeBase')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={item.qtyMode === 'packs' ? 'default' : 'outline'}
                        onClick={() =>
                          setItems((prev) =>
                            prev.map((row, i) => (i === index ? { ...row, qtyMode: 'packs' } : row)),
                          )
                        }
                      >
                        {t('warehouse.qtyModePacks')}
                      </Button>
                    </div>
                  ) : null}

                  {item.qtyMode === 'packs' && levels.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">{t('warehouse.packQtyHint')}</p>
                      <div className="grid gap-2 md:grid-cols-3">
                        {levels.map((level) => (
                          <div key={level.code} className="grid gap-1">
                            <Label>
                              {level.label} (×{level.factorToBase})
                            </Label>
                            <Input
                              type="number"
                              min={0}
                              value={item.packQtys[level.code] ?? ''}
                              onChange={(e) =>
                                setItems((prev) =>
                                  prev.map((row, i) =>
                                    i === index
                                      ? {
                                          ...row,
                                          packQtys: {
                                            ...row.packQtys,
                                            [level.code]: e.target.value,
                                          },
                                        }
                                      : row,
                                  ),
                                )
                              }
                            />
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t('warehouse.baseUnitsTotal', { qty })}
                      </p>
                    </div>
                  ) : (
                    <div className="grid gap-1 md:max-w-xs">
                      <Label>{t('table.quantity')}</Label>
                      <Input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((row, i) =>
                              i === index ? { ...row, quantity: e.target.value } : row,
                            ),
                          )
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        {medicine?.unit?.code ?? t('stock.units')}
                      </p>
                    </div>
                  )}

                  <div className="grid gap-2 md:grid-cols-2">
                    <div className="grid gap-1">
                      <Label>{t('warehouse.unitCostOptional')}</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={item.unitCost}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((row, i) =>
                              i === index ? { ...row, unitCost: e.target.value } : row,
                            ),
                          )
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        {t('warehouse.subtotal', { amount: qty * cost })}
                      </p>
                    </div>
                    <div className="grid gap-1">
                      <Label>{t('table.notes')}</Label>
                      <Input
                        value={item.notes}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((row, i) =>
                              i === index ? { ...row, notes: e.target.value } : row,
                            ),
                          )
                        }
                      />
                      {items.length > 1 ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                        >
                          {t('actions.remove')}
                        </Button>
                      ) : null}
                      {batch && isExpired(batch.expiryDate) ? (
                        <p className="text-xs text-destructive">{t('warehouse.cannotReceiveExpired')}</p>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
            <p className="text-sm text-muted-foreground">
              {t('warehouse.estimatedCostTotal', { amount: estimatedCost.toFixed(2) })}
            </p>
            <Button onClick={() => saveDraft.mutate()} disabled={saveDraft.isPending}>
              {t('actions.saveDraftReview')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (mode === 'review' && review.data) {
    const receipt = review.data;
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">
            {t('warehouse.reviewReceipt', { number: receipt.receiptNumber })}
          </h1>
          <Button variant="outline" onClick={() => setMode('list')}>
            {t('actions.backToList')}
          </Button>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{t('warehouse.receiptDetails')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm md:grid-cols-2">
            <p>
              {t('warehouse.statusLabel')} <Badge>{receipt.status}</Badge>
            </p>
            <p>
              {t('supply.warehouseLabel')} {receipt.warehouse?.name}
            </p>
            <p>
              {t('warehouse.supplier')} {receipt.supplierName ?? dash}
            </p>
            <p>
              {t('warehouse.supplierRef')} {receipt.supplierRef ?? dash}
            </p>
            <p>
              {t('warehouse.dateLabel')} {(receipt.receivedAt ?? '').slice(0, 10) || dash}
            </p>
            <p>
              {t('warehouse.totalUnits')} {receipt.totalUnits}
            </p>
            <p>
              {t('warehouse.estimatedCost')} {Number(receipt.estimatedCost).toFixed(2)}
            </p>
            <p>
              {t('warehouse.notesLabel')} {receipt.notes ?? dash}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('warehouse.items')}</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="min-w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2">{t('table.medicine')}</th>
                  <th className="px-3 py-2">{t('table.batch')}</th>
                  <th className="px-3 py-2">{t('table.qty')}</th>
                  <th className="px-3 py-2">{t('table.unit')}</th>
                  <th className="px-3 py-2">{t('table.unitCost')}</th>
                </tr>
              </thead>
              <tbody>
                {receipt.items.map((item) => (
                  <tr key={item.id} className="border-t">
                    <td className="px-3 py-2">{item.medicine?.name}</td>
                    <td className="px-3 py-2">{item.batch?.batchNumber}</td>
                    <td className="px-3 py-2">{item.quantity}</td>
                    <td className="px-3 py-2">{item.medicine?.unit?.code ?? dash}</td>
                    <td className="px-3 py-2">{item.unitCost ?? dash}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
        {receipt.status === 'DRAFT' ? (
          <Card>
            <CardContent className="flex flex-col gap-3 py-6">
              <p className="text-sm">{t('warehouse.postReceiptHint')}</p>
              <div className="flex flex-wrap gap-2">
                {canPost ? (
                  <Button
                    onClick={() => {
                      if (window.confirm(t('confirm.postReceipt'))) {
                        postReceipt.mutate(receipt.id);
                      }
                    }}
                    disabled={postReceipt.isPending}
                  >
                    {t('actions.postReceipt')}
                  </Button>
                ) : null}
                {canCreate ? (
                  <Button variant="outline" onClick={() => startEdit(receipt)}>
                    {t('actions.editDraft')}
                  </Button>
                ) : null}
                {canCancel ? (
                  <Button
                    variant="destructive"
                    onClick={() => cancelReceipt.mutate(receipt.id)}
                    disabled={cancelReceipt.isPending}
                  >
                    {t('actions.cancelDraft')}
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('warehouse.receiptsTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('warehouse.receiptsSubtitle')}</p>
        </div>
        {canCreate ? (
          <Button onClick={startCreate}>{t('warehouse.createReceipt')}</Button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          className="max-w-xs"
          placeholder={t('warehouse.searchReference')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Input
          className="max-w-xs"
          placeholder={t('warehouse.supplierFilter')}
          value={supplier}
          onChange={(e) => setSupplier(e.target.value)}
        />
        <select
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">{t('filters.allStatuses')}</option>
          <option value="DRAFT">DRAFT</option>
          <option value="POSTED">POSTED</option>
          <option value="CANCELLED">CANCELLED</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">{t('table.referenceNo')}</th>
              <th className="px-3 py-2">{t('table.date')}</th>
              <th className="px-3 py-2">{t('table.supplier')}</th>
              <th className="px-3 py-2">{t('table.items')}</th>
              <th className="px-3 py-2">{t('table.totalUnits')}</th>
              <th className="px-3 py-2">{t('table.status')}</th>
              <th className="px-3 py-2">{t('table.createdBy')}</th>
              <th className="px-3 py-2">{t('table.postedAt')}</th>
              <th className="px-3 py-2">{t('table.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {(receipts.data?.items ?? []).map((row) => (
              <tr key={row.id} className="border-t">
                <td className="px-3 py-2 font-medium">{row.receiptNumber}</td>
                <td className="px-3 py-2">{(row.receivedAt ?? '').slice(0, 10) || dash}</td>
                <td className="px-3 py-2">{row.supplierName ?? dash}</td>
                <td className="px-3 py-2">{row.itemCount}</td>
                <td className="px-3 py-2">{row.totalUnits}</td>
                <td className="px-3 py-2">
                  <Badge>{row.status}</Badge>
                </td>
                <td className="px-3 py-2">
                  {row.createdBy ? `${row.createdBy.firstName} ${row.createdBy.lastName}` : dash}
                </td>
                <td className="px-3 py-2">
                  {row.postedAt ? String(row.postedAt).replace('T', ' ').slice(0, 16) : dash}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setReviewId(row.id);
                        setMode('review');
                      }}
                    >
                      {t('actions.view')}
                    </Button>
                    {row.status === 'DRAFT' && canCreate ? (
                      <Button size="sm" variant="outline" onClick={() => startEdit(row)}>
                        {t('actions.editDraft')}
                      </Button>
                    ) : null}
                    {row.status === 'DRAFT' && canPost ? (
                      <Button
                        size="sm"
                        onClick={() => {
                          setReviewId(row.id);
                          setMode('review');
                        }}
                      >
                        {t('actions.post')}
                      </Button>
                    ) : null}
                    {row.status === 'DRAFT' && canCancel ? (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => cancelReceipt.mutate(row.id)}
                      >
                        {t('actions.cancelDraft')}
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(receipts.data?.items.length ?? 0) === 0 && !receipts.isLoading ? (
          <p className="p-6 text-sm text-muted-foreground">{t('warehouse.noReceipts')}</p>
        ) : null}
      </div>
    </div>
  );
}
