'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useI18n } from '@/i18n';
import { apiList, apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { hasPermission } from '@/lib/permissions';
import { useToast } from '@/lib/toast';

interface BatchRow {
  id: string;
  batchNumber: string;
  manufacturingDate?: string | null;
  expiryDate: string;
  expiryStatus: 'VALID' | 'EXPIRING_SOON' | 'EXPIRED';
  createdAt: string;
  medicine?: { id: string; name: string; sku: string; category?: { id: string; name: string } };
}

const statusClass: Record<BatchRow['expiryStatus'], string> = {
  VALID: 'bg-emerald-100 text-emerald-800',
  EXPIRING_SOON: 'bg-amber-100 text-amber-800',
  EXPIRED: 'bg-red-100 text-red-800',
};

function statusLabel(t: (key: string) => string, code: string) {
  const key = `status.${code}`;
  const label = t(key);
  return label !== key ? label : code.replaceAll('_', ' ');
}

export default function BatchesPage() {
  const { t } = useI18n();
  const client = useQueryClient();
  const { user } = useAuth();
  const toast = useToast();
  const canCreate = hasPermission(user, 'batches:create');
  const canUpdate = hasPermission(user, 'batches:update');
  const [search, setSearch] = useState('');
  const [medicineId, setMedicineId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [expiryStatus, setExpiryStatus] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BatchRow | null>(null);
  const [form, setForm] = useState({
    medicineId: '',
    batchNumber: '',
    manufacturingDate: '',
    expiryDate: '',
  });

  const emDash = t('common.emDash');

  const tableHeaders = useMemo(
    () => [
      t('table.medicine'),
      t('table.batchNumber'),
      t('table.manufacturingDate'),
      t('table.expiryDate'),
      t('table.status'),
      t('table.createdDate'),
      t('table.actions'),
    ],
    [t],
  );

  const path = useMemo(() => {
    const params = new URLSearchParams({ limit: '30', sortBy: 'expiryDate' });
    if (search) params.set('search', search);
    if (medicineId) params.set('medicineId', medicineId);
    if (categoryId) params.set('categoryId', categoryId);
    if (expiryStatus) params.set('expiryStatus', expiryStatus);
    return `/batches?${params.toString()}`;
  }, [search, medicineId, categoryId, expiryStatus]);

  const batches = useQuery({
    queryKey: ['batches', path],
    queryFn: () => apiList<BatchRow>(path),
  });
  const medicines = useQuery({
    queryKey: ['medicines-options'],
    queryFn: () => apiList<{ id: string; name: string }>('/medicines?limit=100'),
  });
  const categories = useQuery({
    queryKey: ['categories-options'],
    queryFn: () => apiList<{ id: string; name: string }>('/categories?limit=100'),
  });

  const save = useMutation({
    mutationFn: () =>
      editing
        ? apiRequest(`/batches/${editing.id}`, {
            method: 'PATCH',
            body: {
              batchNumber: form.batchNumber,
              manufacturingDate: form.manufacturingDate || undefined,
              expiryDate: form.expiryDate,
            },
          })
        : apiRequest('/batches', {
            method: 'POST',
            body: {
              ...form,
              manufacturingDate: form.manufacturingDate || undefined,
            },
          }),
    onSuccess: () => {
      toast.push(editing ? t('toasts.batchUpdated') : t('toasts.batchCreated'));
      setOpen(false);
      setEditing(null);
      setForm({ medicineId: '', batchNumber: '', manufacturingDate: '', expiryDate: '' });
      client.invalidateQueries({ queryKey: ['batches'] });
    },
    onError: (error) => toast.push((error as Error).message, 'error'),
  });

  const rows = batches.data?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('inventory.batches.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('inventory.batches.subtitle')}</p>
        </div>
        {canCreate ? (
          <Button
            onClick={() => {
              setEditing(null);
              setForm({ medicineId: '', batchNumber: '', manufacturingDate: '', expiryDate: '' });
              setOpen(true);
            }}
          >
            {t('actions.addBatch')}
          </Button>
        ) : null}
      </div>

      <div className="grid gap-2 md:grid-cols-4">
        <Input
          placeholder={t('inventory.batches.searchPlaceholder')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select className="h-10 rounded-md border px-3 text-sm" value={medicineId} onChange={(event) => setMedicineId(event.target.value)}>
          <option value="">{t('inventory.batches.allMedicines')}</option>
          {(medicines.data?.items ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select className="h-10 rounded-md border px-3 text-sm" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
          <option value="">{t('common.allCategories')}</option>
          {(categories.data?.items ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select className="h-10 rounded-md border px-3 text-sm" value={expiryStatus} onChange={(event) => setExpiryStatus(event.target.value)}>
          <option value="">{t('inventory.batches.allExpiryStatuses')}</option>
          <option value="VALID">{t('status.VALID')}</option>
          <option value="EXPIRING_SOON">{t('status.EXPIRING_SOON')}</option>
          <option value="EXPIRED">{t('status.EXPIRED')}</option>
        </select>
      </div>

      {batches.isLoading ? <div className="h-40 animate-pulse rounded-lg bg-muted" /> : null}
      {batches.error ? <p className="text-sm text-destructive">{(batches.error as Error).message}</p> : null}

      {!batches.isLoading && rows.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 p-8 text-center">
            <p className="text-sm text-muted-foreground">{t('inventory.batches.empty')}</p>
            {canCreate ? (
              <Button onClick={() => setOpen(true)}>{t('actions.addBatch')}</Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                {tableHeaders.map((header) => (
                  <th key={header} className="px-3 py-2 font-medium">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="px-3 py-2">{row.medicine?.name ?? emDash}</td>
                  <td className="px-3 py-2 font-medium">{row.batchNumber}</td>
                  <td className="px-3 py-2">
                    {row.manufacturingDate ? String(row.manufacturingDate).slice(0, 10) : emDash}
                  </td>
                  <td className="px-3 py-2">{String(row.expiryDate).slice(0, 10)}</td>
                  <td className="px-3 py-2">
                    <Badge className={statusClass[row.expiryStatus]}>{statusLabel(t, row.expiryStatus)}</Badge>
                  </td>
                  <td className="px-3 py-2">{String(row.createdAt).slice(0, 10)}</td>
                  <td className="px-3 py-2">
                    {canUpdate ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditing(row);
                          setForm({
                            medicineId: row.medicine?.id ?? '',
                            batchNumber: row.batchNumber,
                            manufacturingDate: row.manufacturingDate ? String(row.manufacturingDate).slice(0, 10) : '',
                            expiryDate: String(row.expiryDate).slice(0, 10),
                          });
                          setOpen(true);
                        }}
                      >
                        {t('actions.edit')}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open ? (
        <Card>
          <CardHeader>
            <CardTitle>{editing ? t('actions.editBatch') : t('actions.addBatch')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3 md:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                save.mutate();
              }}
            >
              <div className="space-y-1 md:col-span-2">
                <Label>{t('table.medicine')}</Label>
                <select
                  className="h-10 w-full rounded-md border px-3 text-sm"
                  value={form.medicineId}
                  onChange={(event) => setForm({ ...form, medicineId: event.target.value })}
                  required
                  disabled={Boolean(editing)}
                >
                  <option value="">{t('common.selectMedicine')}</option>
                  {(medicines.data?.items ?? []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>{t('inventory.batches.batchNumberLabel')}</Label>
                <Input
                  value={form.batchNumber}
                  onChange={(event) => setForm({ ...form, batchNumber: event.target.value })}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label>{t('inventory.batches.manufacturingDateLabel')}</Label>
                <Input
                  type="date"
                  value={form.manufacturingDate}
                  onChange={(event) => setForm({ ...form, manufacturingDate: event.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>{t('inventory.batches.expiryDateLabel')}</Label>
                <Input
                  type="date"
                  value={form.expiryDate}
                  onChange={(event) => setForm({ ...form, expiryDate: event.target.value })}
                  required
                />
              </div>
              <div className="flex gap-2 md:col-span-2">
                <Button type="submit" disabled={save.isPending}>
                  {t('common.save')}
                </Button>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  {t('common.cancel')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
