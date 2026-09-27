'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { FormModal } from '@/components/form-modal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useI18n } from '@/i18n';
import { apiList, apiRequest, apiUpload } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { hasPermission } from '@/lib/permissions';
import { useToast } from '@/lib/toast';

interface CategoryRow {
  id: string;
  name: string;
  description?: string | null;
  itemType: string;
  status: string;
  isActive: boolean;
  createdAt: string;
  _count?: { medicines: number };
}

interface ItemTypeOption {
  code: string;
  labelEn: string;
  labelAr: string;
  isSystem: boolean;
}

const CUSTOM_TYPE_VALUE = '__CUSTOM__';

export default function CategoriesPage() {
  const { t, locale } = useI18n();
  const client = useQueryClient();
  const { user } = useAuth();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const canManage = hasPermission(user, 'categories:create');
  const canUpdate = hasPermission(user, 'categories:update');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [form, setForm] = useState({ name: '', description: '', itemType: 'MEDICINE', customType: '' });
  const [typeSelect, setTypeSelect] = useState('MEDICINE');

  const emDash = t('common.emDash');

  const tableHeaders = useMemo(
    () => [
      t('table.name'),
      t('table.type'),
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

  const itemTypes = useQuery({
    queryKey: ['category-item-types'],
    queryFn: () =>
      apiRequest<{ system: ItemTypeOption[]; custom: ItemTypeOption[] }>('/categories/item-types'),
  });

  const typeOptions = useMemo(() => {
    const system = itemTypes.data?.system ?? [
      { code: 'MEDICINE', labelEn: 'Medicines', labelAr: 'أدوية', isSystem: true },
      { code: 'MEDICAL_SUPPLY', labelEn: 'Medical Supplies', labelAr: 'مستلزمات طبية', isSystem: true },
    ];
    return [...system, ...(itemTypes.data?.custom ?? [])];
  }, [itemTypes.data]);

  function typeLabel(code: string) {
    const found = typeOptions.find((item) => item.code === code);
    if (!found) return code.replaceAll('_', ' ');
    return locale === 'ar' ? found.labelAr : found.labelEn;
  }

  function resolvedItemType() {
    if (typeSelect === CUSTOM_TYPE_VALUE) {
      return form.customType.trim() || 'CUSTOM';
    }
    return typeSelect;
  }

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name.trim(),
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
        itemType: resolvedItemType(),
      };
      return editing
        ? apiRequest(`/categories/${editing.id}`, { method: 'PATCH', body })
        : apiRequest('/categories', { method: 'POST', body });
    },
    onSuccess: () => {
      toast.push(editing ? t('toasts.categoryUpdated') : t('toasts.categoryCreated'));
      setOpen(false);
      setEditing(null);
      setForm({ name: '', description: '', itemType: 'MEDICINE', customType: '' });
      setTypeSelect('MEDICINE');
      client.invalidateQueries({ queryKey: ['categories'] });
      client.invalidateQueries({ queryKey: ['categories-active'] });
      client.invalidateQueries({ queryKey: ['categories-options'] });
      client.invalidateQueries({ queryKey: ['category-item-types'] });
    },
    onError: (error) => toast.push((error as Error).message, 'error'),
  });

  const setActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiRequest(`/categories/${id}/status`, { method: 'PATCH', body: { isActive } }),
    onSuccess: () => {
      toast.push(t('toasts.categoryStatusUpdated'));
      client.invalidateQueries({ queryKey: ['categories'] });
      client.invalidateQueries({ queryKey: ['categories-active'] });
    },
    onError: (error) => toast.push((error as Error).message, 'error'),
  });

  const importFile = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return apiUpload<{ created: number; updated: number; skipped: number }>('/categories/import', formData);
    },
    onSuccess: (result) => {
      toast.push(
        t('inventory.categories.importResult', {
          created: result.created,
          updated: result.updated,
          skipped: result.skipped,
        }),
      );
      client.invalidateQueries({ queryKey: ['categories'] });
      client.invalidateQueries({ queryKey: ['categories-active'] });
      client.invalidateQueries({ queryKey: ['category-item-types'] });
    },
    onError: (error) => toast.push((error as Error).message, 'error'),
  });

  const rows = categories.data?.items ?? [];

  function openCreate() {
    setEditing(null);
    setForm({ name: '', description: '', itemType: 'MEDICINE', customType: '' });
    setTypeSelect('MEDICINE');
    setOpen(true);
  }

  function openEdit(row: CategoryRow) {
    setEditing(row);
    const known = typeOptions.some((item) => item.code === row.itemType);
    setTypeSelect(known ? row.itemType : CUSTOM_TYPE_VALUE);
    setForm({
      name: row.name,
      description: row.description ?? '',
      itemType: row.itemType,
      customType: known ? '' : row.itemType,
    });
    setOpen(true);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('inventory.categories.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('inventory.categories.subtitle')}</p>
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={importFile.isPending}>
              {importFile.isPending ? t('common.saving') : t('actions.import')}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) importFile.mutate(file);
                event.target.value = '';
              }}
            />
            <Button type="button" onClick={openCreate}>{t('actions.createCategory')}</Button>
          </div>
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

      {canManage ? (
        <p className="text-xs text-muted-foreground">{t('inventory.categories.importHint')}</p>
      ) : null}

      {categories.isLoading ? <div className="h-32 animate-pulse rounded-lg bg-muted" /> : null}
      {categories.error ? <p className="text-sm text-destructive">{(categories.error as Error).message}</p> : null}

      {!categories.isLoading && rows.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 p-8 text-center">
            <p className="text-sm text-muted-foreground">{t('inventory.categories.empty')}</p>
            {canManage ? <Button type="button" onClick={openCreate}>{t('actions.createCategory')}</Button> : null}
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
                  <td className="px-3 py-2">{typeLabel(row.itemType)}</td>
                  <td className="px-3 py-2">{row.description || emDash}</td>
                  <td className="px-3 py-2">{row._count?.medicines ?? 0}</td>
                  <td className="px-3 py-2">
                    <Badge>{row.status}</Badge>
                  </td>
                  <td className="px-3 py-2">{String(row.createdAt).slice(0, 10)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {canUpdate ? (
                        <Button size="sm" variant="outline" onClick={() => openEdit(row)}>
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

      <FormModal
        open={open}
        title={editing ? t('actions.editCategory') : t('actions.createCategory')}
        onClose={() => setOpen(false)}
      >
        <form
          className="grid gap-3 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (typeSelect === CUSTOM_TYPE_VALUE && form.customType.trim().length < 2) {
              toast.push(t('inventory.categories.customTypeRequired'), 'error');
              return;
            }
            save.mutate();
          }}
        >
          <div className="space-y-1">
            <Label>{t('table.name')}</Label>
            <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required minLength={2} />
          </div>
          <div className="space-y-1">
            <Label>{t('table.type')}</Label>
            <select
              className="h-10 w-full rounded-md border px-3 text-sm"
              value={typeSelect}
              onChange={(event) => setTypeSelect(event.target.value)}
            >
              {typeOptions.map((item) => (
                <option key={item.code} value={item.code}>
                  {locale === 'ar' ? item.labelAr : item.labelEn}
                </option>
              ))}
              <option value={CUSTOM_TYPE_VALUE}>{t('inventory.categories.customType')}</option>
            </select>
          </div>
          {typeSelect === CUSTOM_TYPE_VALUE ? (
            <div className="space-y-1 md:col-span-2">
              <Label>{t('inventory.categories.customTypeLabel')}</Label>
              <Input
                value={form.customType}
                onChange={(event) => setForm({ ...form, customType: event.target.value })}
                placeholder={t('inventory.categories.customTypePlaceholder')}
                required
                minLength={2}
              />
            </div>
          ) : null}
          <div className="space-y-1 md:col-span-2">
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
      </FormModal>
    </div>
  );
}
