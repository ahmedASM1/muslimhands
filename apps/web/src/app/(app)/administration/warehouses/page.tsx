'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useI18n } from '@/i18n';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { hasPermission } from '@/lib/permissions';

interface WarehouseRow {
  id: string;
  name: string;
  code: string;
  address?: string | null;
  location?: string | null;
  status: string;
  isActive: boolean;
  employeeCount?: number;
  stockQuantity?: number;
}

function statusLabel(t: (key: string) => string, code: string) {
  const key = `status.${code}`;
  const label = t(key);
  return label !== key ? label : code;
}

export default function WarehousesAdminPage() {
  const { t } = useI18n();
  const client = useQueryClient();
  const { user } = useAuth();
  const canCreate = hasPermission(user, 'warehouses:create');
  const canUpdate = hasPermission(user, 'warehouses:update');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<WarehouseRow | null>(null);
  const [form, setForm] = useState({ name: '', code: '', location: '', address: '' });

  const headers = useMemo(
    () => [
      t('table.warehouse'),
      t('table.code'),
      t('table.location'),
      t('table.status'),
      t('table.employees'),
      t('table.stock'),
      t('table.actions'),
    ],
    [t],
  );

  const warehouses = useQuery({
    queryKey: ['warehouses-admin'],
    queryFn: () => apiRequest<WarehouseRow[]>('/warehouses'),
  });

  const create = useMutation({
    mutationFn: () =>
      apiRequest<WarehouseRow>('/warehouses', {
        method: 'POST',
        body: {
          name: form.name,
          code: form.code,
          location: form.location || undefined,
          address: form.address || form.location || undefined,
        },
      }),
    onSuccess: () => {
      setForm({ name: '', code: '', location: '', address: '' });
      setCreateOpen(false);
      client.invalidateQueries({ queryKey: ['warehouses-admin'] });
    },
  });

  const update = useMutation({
    mutationFn: () =>
      apiRequest(`/warehouses/${editing?.id}`, {
        method: 'PATCH',
        body: {
          name: form.name,
          location: form.location || null,
          address: form.address || form.location || null,
        },
      }),
    onSuccess: () => {
      setEditing(null);
      client.invalidateQueries({ queryKey: ['warehouses-admin'] });
    },
  });

  const setStatus = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiRequest(`/warehouses/${id}/status`, { method: 'PATCH', body: { isActive } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['warehouses-admin'] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('admin.warehouses.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('admin.warehouses.subtitle')}</p>
        </div>
        {canCreate ? (
          <Button onClick={() => setCreateOpen(true)}>{t('actions.createWarehouse')}</Button>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              {headers.map((header) => (
                <th key={header} className="px-3 py-2 font-medium">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(warehouses.data ?? []).map((row) => (
              <tr key={row.id} className="border-t">
                <td className="px-3 py-2 font-medium">{row.name}</td>
                <td className="px-3 py-2">{row.code}</td>
                <td className="px-3 py-2">{row.location ?? row.address ?? t('common.emDash')}</td>
                <td className="px-3 py-2">
                  <Badge>{statusLabel(t, row.status)}</Badge>
                </td>
                <td className="px-3 py-2">{row.employeeCount ?? 0}</td>
                <td className="px-3 py-2">{row.stockQuantity ?? 0}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {canUpdate ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditing(row);
                          setForm({
                            name: row.name,
                            code: row.code,
                            location: row.location ?? '',
                            address: row.address ?? '',
                          });
                        }}
                      >
                        {t('actions.edit')}
                      </Button>
                    ) : null}
                    {canUpdate ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setStatus.mutate({ id: row.id, isActive: !row.isActive })}
                      >
                        {row.isActive ? t('actions.deactivate') : t('actions.activate')}
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {createOpen || editing ? (
        <Card>
          <CardHeader>
            <CardTitle>{editing ? t('actions.editWarehouse') : t('actions.createWarehouse')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3 md:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (editing) update.mutate();
                else create.mutate();
              }}
            >
              <div className="space-y-1">
                <Label>{t('table.name')}</Label>
                <Input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label>{t('table.code')}</Label>
                <Input
                  value={form.code}
                  onChange={(event) => setForm({ ...form, code: event.target.value })}
                  required
                  disabled={Boolean(editing)}
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label>{t('table.location')}</Label>
                <Input
                  value={form.location}
                  onChange={(event) => setForm({ ...form, location: event.target.value })}
                />
              </div>
              <div className="flex gap-2 md:col-span-2">
                <Button type="submit">
                  {editing ? t('common.save') : t('actions.createWarehouseSubmit')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setCreateOpen(false);
                    setEditing(null);
                  }}
                >
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
