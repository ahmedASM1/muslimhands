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

interface PharmacyRow {
  id: string;
  name: string;
  code: string;
  slug: string;
  location?: string | null;
  status: string;
  isActive: boolean;
  employeeCount?: number;
  stockQuantity?: number;
  todaysDispensing?: number;
  pendingSupplyRequests?: number;
  path: string;
}

function statusLabel(t: (key: string) => string, code: string) {
  const key = `status.${code}`;
  const label = t(key);
  return label !== key ? label : code;
}

export default function PharmaciesPage() {
  const { t } = useI18n();
  const client = useQueryClient();
  const { user } = useAuth();
  const canCreate = hasPermission(user, 'pharmacies:create');
  const canUpdate = hasPermission(user, 'pharmacies:update');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<PharmacyRow | null>(null);
  const [form, setForm] = useState({ name: '', code: '', slug: '', location: '' });

  const headers = useMemo(
    () => [
      t('table.pharmacy'),
      t('table.code'),
      t('table.location'),
      t('table.status'),
      t('table.employees'),
      t('table.stock'),
      t('table.todaysDispensing'),
      t('table.pendingRequests'),
      t('table.actions'),
    ],
    [t],
  );

  const pharmacies = useQuery({
    queryKey: ['pharmacies-admin'],
    queryFn: () => apiRequest<PharmacyRow[]>('/pharmacies'),
  });

  const create = useMutation({
    mutationFn: () =>
      apiRequest<PharmacyRow>('/pharmacies', {
        method: 'POST',
        body: form,
      }),
    onSuccess: () => {
      setForm({ name: '', code: '', slug: '', location: '' });
      setCreateOpen(false);
      client.invalidateQueries({ queryKey: ['pharmacies-admin'] });
    },
  });

  const update = useMutation({
    mutationFn: () =>
      apiRequest(`/pharmacies/${editing?.id}`, {
        method: 'PATCH',
        body: { name: form.name, location: form.location },
      }),
    onSuccess: () => {
      setEditing(null);
      client.invalidateQueries({ queryKey: ['pharmacies-admin'] });
    },
  });

  const setStatus = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiRequest(`/pharmacies/${id}/status`, { method: 'PATCH', body: { isActive } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['pharmacies-admin'] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('admin.pharmacies.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('admin.pharmacies.subtitle')}</p>
        </div>
        {canCreate ? (
          <Button onClick={() => setCreateOpen(true)}>{t('actions.createPharmacy')}</Button>
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
            {(pharmacies.data ?? []).map((row) => (
              <tr key={row.id} className="border-t">
                <td className="px-3 py-2">
                  <a className="underline" href={`/pharmacies/${row.slug}`}>
                    {row.name}
                  </a>
                </td>
                <td className="px-3 py-2">{row.code}</td>
                <td className="px-3 py-2">{row.location ?? t('common.emDash')}</td>
                <td className="px-3 py-2">
                  <Badge>{statusLabel(t, row.status)}</Badge>
                </td>
                <td className="px-3 py-2">{row.employeeCount ?? 0}</td>
                <td className="px-3 py-2">{row.stockQuantity ?? 0}</td>
                <td className="px-3 py-2">{row.todaysDispensing ?? 0}</td>
                <td className="px-3 py-2">{row.pendingSupplyRequests ?? 0}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.location.assign(`/pharmacies/${row.slug}`)}
                    >
                      {t('actions.portal')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.location.assign(`/pharmacies/${row.slug}/login`)}
                    >
                      {t('actions.loginLink')}
                    </Button>
                    {canUpdate ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditing(row);
                          setForm({ name: row.name, code: row.code, slug: row.slug, location: row.location ?? '' });
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
            <CardTitle>{editing ? t('actions.editPharmacy') : t('actions.createPharmacy')}</CardTitle>
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
                <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
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
              <div className="space-y-1">
                <Label>{t('table.slug')}</Label>
                <Input
                  value={form.slug}
                  onChange={(event) => setForm({ ...form, slug: event.target.value })}
                  disabled={Boolean(editing)}
                />
              </div>
              <div className="space-y-1">
                <Label>{t('table.location')}</Label>
                <Input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} />
              </div>
              <div className="flex gap-2 md:col-span-2">
                <Button type="submit">
                  {editing ? t('common.save') : t('actions.createPharmacySubmit')}
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
