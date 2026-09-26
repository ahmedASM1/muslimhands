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

interface CategoryRow {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  isActive: boolean;
  createdAt: string;
  _count?: { medicines: number };
}

export default function CategoriesPage() {
  const { t } = useI18n();
  const client = useQueryClient();
  const { user } = useAuth();
  const toast = useToast();
  const canManage = hasPermission(user, 'categories:create');
  const canUpdate = hasPermission(user, 'categories:update');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [form, setForm] = useState({ name: '', description: '' });

  const emDash = t('common.emDash');

  const tableHeaders = useMemo(
    () => [
      t('table.name'),
      t('table.description'),
      t('table.medicines'),
      t('table.status'),
      t('table.created'),
      t('table.actions'),
    ],
    [t],
  );

  const path = useMemo(() => {
    const params = new URLSearchParams({ limit: '20', sortBy: 'name' });
    if (search) params.set('search', search);
    if (status) params.set('isActive', status === 'ACTIVE' ? 'true' : 'false');
    return `/categories?${params.toString()}`;
  }, [search, status]);

  const categories = useQuery({
    queryKey: ['categories', path],
    queryFn: () => apiList<CategoryRow>(path),
  });

  const save = useMutation({
    mutationFn: () =>
      editing
        ? apiRequest(`/categories/${editing.id}`, { method: 'PATCH', body: form })
        : apiRequest('/categories', { method: 'POST', body: form }),
    onSuccess: () => {
      toast.push(editing ? t('toasts.categoryUpdated') : t('toasts.categoryCreated'));
      setOpen(false);
      setEditing(null);
      setForm({ name: '', description: '' });
      client.invalidateQueries({ queryKey: ['categories'] });
    },
    onError: (error) => toast.push((error as Error).message, 'error'),
  });

  const setActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiRequest(`/categories/${id}/status`, { method: 'PATCH', body: { isActive } }),
    onSuccess: () => {
      toast.push(t('toasts.categoryStatusUpdated'));
      client.invalidateQueries({ queryKey: ['categories'] });
    },
    onError: (error) => toast.push((error as Error).message, 'error'),
  });

  const rows = categories.data?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('inventory.categories.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('inventory.categories.subtitle')}</p>
        </div>
        {canManage ? (
          <Button
            onClick={() => {
              setEditing(null);
              setForm({ name: '', description: '' });
              setOpen(true);
            }}
          >
            {t('actions.createCategory')}
          </Button>
        ) : null}
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        <Input
          placeholder={t('inventory.categories.searchPlaceholder')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select className="h-10 rounded-md border px-3 text-sm" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">{t('common.allStatuses')}</option>
          <option value="ACTIVE">{t('status.ACTIVE')}</option>
          <option value="INACTIVE">{t('status.INACTIVE')}</option>
        </select>
      </div>

      {categories.isLoading ? <div className="h-32 animate-pulse rounded-lg bg-muted" /> : null}
      {categories.error ? <p className="text-sm text-destructive">{(categories.error as Error).message}</p> : null}

      {!categories.isLoading && rows.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 p-8 text-center">
            <p className="text-sm text-muted-foreground">{t('inventory.categories.empty')}</p>
            {canManage ? <Button onClick={() => setOpen(true)}>{t('actions.createCategory')}</Button> : null}
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
                  <td className="px-3 py-2 font-medium">{row.name}</td>
                  <td className="px-3 py-2">{row.description || emDash}</td>
                  <td className="px-3 py-2">{row._count?.medicines ?? 0}</td>
                  <td className="px-3 py-2">
                    <Badge>{row.status}</Badge>
                  </td>
                  <td className="px-3 py-2">{String(row.createdAt).slice(0, 10)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {canUpdate ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditing(row);
                            setForm({ name: row.name, description: row.description ?? '' });
                            setOpen(true);
                          }}
                        >
                          {t('actions.edit')}
                        </Button>
                      ) : null}
                      {canUpdate ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (
                              window.confirm(
                                row.isActive
                                  ? t('inventory.categories.confirmDeactivate')
                                  : t('inventory.categories.confirmActivate'),
                              )
                            ) {
                              setActive.mutate({ id: row.id, isActive: !row.isActive });
                            }
                          }}
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
      )}

      {open ? (
        <Card>
          <CardHeader>
            <CardTitle>{editing ? t('actions.editCategory') : t('actions.createCategory')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3 md:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                save.mutate();
              }}
            >
              <div className="space-y-1">
                <Label>{t('table.name')}</Label>
                <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required minLength={2} />
              </div>
              <div className="space-y-1">
                <Label>{t('table.description')}</Label>
                <Input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
              </div>
              <div className="flex gap-2 md:col-span-2">
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? t('common.saving') : t('common.save')}
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
