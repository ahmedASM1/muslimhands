'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useI18n } from '@/i18n';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { FormModal } from '@/components/form-modal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiList, apiRequest, apiUpload } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { DOSAGE_FORMS, dosageFormLabel } from '@/lib/catalog';
import { hasPermission } from '@/lib/permissions';
import { useToast } from '@/lib/toast';
import { CATALOG_ITEM_TYPE } from '@mh/shared';

type CatalogMode = typeof CATALOG_ITEM_TYPE.MEDICINE | typeof CATALOG_ITEM_TYPE.MEDICAL_SUPPLY;

interface NamedRef {
  id: string;
  name: string;
  code?: string;
  itemType?: string;
}

interface BatchRow {
  id: string;
  batchNumber: string;
  manufacturingDate?: string | null;
  expiryDate: string;
}

interface MedicineRow {
  id: string;
  name: string;
  genericName?: string | null;
  brandName?: string | null;
  strength?: string | null;
  dosageForm: string;
  sku: string;
  barcode?: string | null;
  minimumStock: number;
  reorderQuantity: number;
  referenceValue?: string | number | null;
  description?: string | null;
  status: string;
  isActive: boolean;
  category?: NamedRef;
  unit?: NamedRef;
  batches?: BatchRow[];
}

type MedicineForm = {
  name: string;
  genericName?: string;
  brandName?: string;
  categoryId: string;
  dosageForm: (typeof DOSAGE_FORMS)[number];
  strength?: string;
  unitId: string;
  sku?: string;
  barcode?: string;
  minimumStock: number;
  reorderQuantity: number;
  referenceValue?: string;
  description?: string;
};

function needsStrength(dosageForm: string, itemType?: string | null) {
  if (itemType && itemType !== 'MEDICINE') return false;
  return dosageForm !== 'OTHER';
}

export default function MedicinesPage() {
  const { t } = useI18n();
  const client = useQueryClient();
  const { user } = useAuth();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const catalogMode: CatalogMode = useMemo(() => {
    const fromQuery = searchParams.get('type')?.toUpperCase();
    if (fromQuery === CATALOG_ITEM_TYPE.MEDICAL_SUPPLY || pathname.includes('medical-supplies')) {
      return CATALOG_ITEM_TYPE.MEDICAL_SUPPLY;
    }
    return CATALOG_ITEM_TYPE.MEDICINE;
  }, [pathname, searchParams]);

  const isSupplies = catalogMode === CATALOG_ITEM_TYPE.MEDICAL_SUPPLY;

  const medicineSchema = useMemo(
    () =>
      z.object({
        name: z.string().min(2, t('inventory.medicines.validation.nameRequired')),
        genericName: z.string().optional(),
        brandName: z.string().optional(),
        categoryId: z.string().uuid(t('inventory.medicines.validation.categoryRequired')),
        dosageForm: z.enum(DOSAGE_FORMS),
        strength: z.string().optional(),
        unitId: z.string().uuid(t('inventory.medicines.validation.unitRequired')),
        sku: z.string().optional(),
        barcode: z.string().optional(),
        minimumStock: z.coerce.number().min(0, t('inventory.medicines.validation.minimumStock')),
        reorderQuantity: z.coerce.number().min(0, t('inventory.medicines.validation.reorderQuantity')),
        referenceValue: z.string().optional(),
        description: z.string().optional(),
      }),
    [t],
  );
  const canCreate = hasPermission(user, 'medicines:create');
  const canUpdate = hasPermission(user, 'medicines:update');
  const [search, setSearch] = useState(() => searchParams.get('search') ?? '');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState('');
  const [dosageForm, setDosageForm] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MedicineRow | null>(null);
  const [selected, setSelected] = useState<MedicineRow | null>(null);

  const path = useMemo(() => {
    const params = new URLSearchParams({
      limit: '15',
      page: String(page),
      sortBy: 'name',
      itemType: catalogMode,
    });
    if (search) params.set('search', search);
    if (categoryId) params.set('categoryId', categoryId);
    if (status) params.set('isActive', status === 'ACTIVE' ? 'true' : 'false');
    if (dosageForm) params.set('dosageForm', dosageForm);
    return `/medicines?${params.toString()}`;
  }, [search, categoryId, status, dosageForm, page, catalogMode]);

  const medicines = useQuery({
    queryKey: ['medicines', path],
    queryFn: () => apiList<MedicineRow>(path),
  });
  const categories = useQuery({
    queryKey: ['categories-active', catalogMode],
    queryFn: () =>
      apiList<NamedRef>(`/categories?limit=100&isActive=true&itemType=${encodeURIComponent(catalogMode)}`),
  });
  const units = useQuery({
    queryKey: ['units-active'],
    queryFn: () => apiList<NamedRef>('/units?limit=100&isActive=true'),
  });
  const details = useQuery({
    queryKey: ['medicine', selected?.id],
    enabled: Boolean(selected?.id),
    queryFn: () => apiRequest<MedicineRow>(`/medicines/${selected!.id}`),
  });

  const form = useForm<MedicineForm>({
    resolver: zodResolver(medicineSchema),
    defaultValues: {
      name: '',
      genericName: '',
      brandName: '',
      categoryId: '',
      dosageForm: isSupplies ? 'OTHER' : 'TABLET',
      strength: '',
      unitId: '',
      sku: '',
      barcode: '',
      minimumStock: 0,
      reorderQuantity: 0,
      referenceValue: '',
      description: '',
    },
  });

  const watchedCategoryId = useWatch({ control: form.control, name: 'categoryId' });
  const watchedDosageForm = useWatch({ control: form.control, name: 'dosageForm' });
  const selectedCategory = (categories.data?.items ?? []).find((item) => item.id === watchedCategoryId);
  const strengthRequired = needsStrength(watchedDosageForm, selectedCategory?.itemType ?? catalogMode);

  useEffect(() => {
    if (isSupplies) {
      setDosageForm('');
      if (form.getValues('dosageForm') !== 'OTHER') {
        form.setValue('dosageForm', 'OTHER');
      }
    }
  }, [isSupplies, form]);

  useEffect(() => {
    if (!selectedCategory) return;
    if (selectedCategory.itemType && selectedCategory.itemType !== 'MEDICINE') {
      if (form.getValues('dosageForm') !== 'OTHER') {
        form.setValue('dosageForm', 'OTHER');
      }
    }
  }, [selectedCategory, form]);

  const save = useMutation({
    mutationFn: (values: MedicineForm) => {
      const category = (categories.data?.items ?? []).find((item) => item.id === values.categoryId);
      if (
        needsStrength(values.dosageForm, category?.itemType ?? catalogMode) &&
        !(values.strength ?? '').trim()
      ) {
        throw new Error(t('inventory.medicines.validation.strengthRequired'));
      }
      const body = {
        ...values,
        sku: values.sku || undefined,
        barcode: values.barcode || undefined,
        genericName: values.genericName || undefined,
        brandName: values.brandName || undefined,
        strength: values.strength || undefined,
        description: values.description || undefined,
        referenceValue: values.referenceValue ? Number(values.referenceValue) : undefined,
        dosageForm: isSupplies ? 'OTHER' : values.dosageForm,
      };
      return editing
        ? apiRequest(`/medicines/${editing.id}`, { method: 'PATCH', body })
        : apiRequest('/medicines', { method: 'POST', body });
    },
    onSuccess: () => {
      toast.push(
        editing
          ? t(isSupplies ? 'toasts.supplyUpdated' : 'toasts.medicineUpdated')
          : t(isSupplies ? 'toasts.supplyCreated' : 'toasts.medicineCreated'),
      );
      setOpen(false);
      setEditing(null);
      form.reset({
        name: '',
        genericName: '',
        brandName: '',
        categoryId: '',
        dosageForm: isSupplies ? 'OTHER' : 'TABLET',
        strength: '',
        unitId: '',
        sku: '',
        barcode: '',
        minimumStock: 0,
        reorderQuantity: 0,
        referenceValue: '',
        description: '',
      });
      client.invalidateQueries({ queryKey: ['medicines'] });
    },
    onError: (error) => toast.push((error as Error).message, 'error'),
  });

  const setActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiRequest(`/medicines/${id}/status`, { method: 'PATCH', body: { isActive } }),
    onSuccess: () => {
      toast.push(t('toasts.medicineStatusUpdated'));
      client.invalidateQueries({ queryKey: ['medicines'] });
    },
    onError: (error) => toast.push((error as Error).message, 'error'),
  });

  const importFile = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return apiUpload<{ created: number; updated: number; skipped: number }>('/medicines/import', formData);
    },
    onSuccess: (result) => {
      toast.push(
        t('inventory.medicines.importResult', {
          created: result.created,
          updated: result.updated,
          skipped: result.skipped,
        }),
      );
      client.invalidateQueries({ queryKey: ['medicines'] });
      client.invalidateQueries({ queryKey: ['categories'] });
      client.invalidateQueries({ queryKey: ['categories-active'] });
    },
    onError: (error) => toast.push((error as Error).message, 'error'),
  });

  const rows = medicines.data?.items ?? [];
  const meta = medicines.data?.meta;
  const emDash = t('common.emDash');

  const tableHeaders = useMemo(
    () =>
      isSupplies
        ? [
            t('table.supply'),
            t('table.category'),
            t('table.unit'),
            t('table.sku'),
            t('table.barcode'),
            t('table.minimumStock'),
            t('table.reorderQuantity'),
            t('table.status'),
            t('table.actions'),
          ]
        : [
            t('table.medicine'),
            t('table.genericName'),
            t('table.strength'),
            t('table.dosageForm'),
            t('table.category'),
            t('table.unit'),
            t('table.sku'),
            t('table.barcode'),
            t('table.minimumStock'),
            t('table.reorderQuantity'),
            t('table.status'),
            t('table.actions'),
          ],
    [t, isSupplies],
  );

  function startCreate() {
    setEditing(null);
    form.reset({
      name: '',
      genericName: '',
      brandName: '',
      categoryId: '',
      dosageForm: isSupplies ? 'OTHER' : 'TABLET',
      strength: '',
      unitId: '',
      sku: '',
      barcode: '',
      minimumStock: 0,
      reorderQuantity: 0,
      referenceValue: '',
      description: '',
    });
    setOpen(true);
  }

  function startEdit(row: MedicineRow) {
    setEditing(row);
    form.reset({
      name: row.name,
      genericName: row.genericName ?? '',
      brandName: row.brandName ?? '',
      categoryId: row.category?.id ?? '',
      dosageForm: (row.dosageForm as MedicineForm['dosageForm']) || 'TABLET',
      strength: row.strength ?? '',
      unitId: row.unit?.id ?? '',
      sku: row.sku,
      barcode: row.barcode ?? '',
      minimumStock: row.minimumStock,
      reorderQuantity: row.reorderQuantity,
      referenceValue: row.referenceValue == null ? '' : String(row.referenceValue),
      description: row.description ?? '',
    });
    setOpen(true);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {t(isSupplies ? 'inventory.supplies.title' : 'inventory.medicines.title')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t(isSupplies ? 'inventory.supplies.subtitle' : 'inventory.medicines.subtitle')}
          </p>
        </div>
        {canCreate ? (
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
            <Button type="button" onClick={startCreate}>
              {t(isSupplies ? 'actions.addSupply' : 'actions.addMedicine')}
            </Button>
          </div>
        ) : null}
      </div>

      {canCreate ? <p className="text-xs text-muted-foreground">{t('inventory.medicines.importHint')}</p> : null}

      <div className={`grid gap-2 ${isSupplies ? 'md:grid-cols-3' : 'md:grid-cols-4'}`}>
        <Input
          placeholder={t('inventory.medicines.searchPlaceholder')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
        <select
          className="h-10 rounded-md border px-3 text-sm"
          value={categoryId}
          onChange={(event) => {
            setCategoryId(event.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('common.allCategories')}</option>
          {(categories.data?.items ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select
          className="h-10 rounded-md border px-3 text-sm"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('common.allStatuses')}</option>
          <option value="ACTIVE">{t('status.ACTIVE')}</option>
          <option value="INACTIVE">{t('status.INACTIVE')}</option>
        </select>
        {!isSupplies ? (
          <select
            className="h-10 rounded-md border px-3 text-sm"
            value={dosageForm}
            onChange={(event) => {
              setDosageForm(event.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('inventory.medicines.allDosageForms')}</option>
            {DOSAGE_FORMS.map((item) => (
              <option key={item} value={item}>
                {dosageFormLabel(t, item)}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {medicines.isLoading ? <div className="h-32 animate-pulse rounded-lg bg-muted" /> : null}
      {medicines.error ? <p className="text-sm text-destructive">{(medicines.error as Error).message}</p> : null}

      {!medicines.isLoading && rows.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              {t(isSupplies ? 'inventory.supplies.empty' : 'inventory.medicines.empty')}
            </p>
            {canCreate ? (
              <Button type="button" onClick={startCreate}>
                {t(isSupplies ? 'actions.addSupply' : 'actions.addMedicine')}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                {tableHeaders.map((header) => (
                  <th key={header} className="px-3 py-2 font-medium">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="px-3 py-2 font-medium">
                    <button type="button" className="text-left hover:underline" onClick={() => setSelected(row)}>
                      {row.name}
                    </button>
                  </td>
                  {!isSupplies ? (
                    <>
                      <td className="px-3 py-2">{row.genericName || emDash}</td>
                      <td className="px-3 py-2">{row.strength || emDash}</td>
                      <td className="px-3 py-2">{dosageFormLabel(t, row.dosageForm)}</td>
                    </>
                  ) : null}
                  <td className="px-3 py-2">{row.category?.name ?? emDash}</td>
                  <td className="px-3 py-2">{row.unit?.name ?? emDash}</td>
                  <td className="px-3 py-2">{row.sku}</td>
                  <td className="px-3 py-2">{row.barcode || emDash}</td>
                  <td className="px-3 py-2">{row.minimumStock}</td>
                  <td className="px-3 py-2">{row.reorderQuantity}</td>
                  <td className="px-3 py-2"><Badge>{row.status}</Badge></td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {canUpdate ? (
                        <Button size="sm" variant="outline" onClick={() => startEdit(row)}>{t('actions.edit')}</Button>
                      ) : null}
                      {canUpdate ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (window.confirm(row.isActive ? t('inventory.medicines.confirmDeactivate') : t('inventory.medicines.confirmActivate'))) {
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

      {meta && meta.totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <span>{t('reports.pageOf', { page: meta.page, totalPages: meta.totalPages })}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>{t('common.previous')}</Button>
            <Button size="sm" variant="outline" disabled={page >= meta.totalPages} onClick={() => setPage((value) => value + 1)}>{t('common.next')}</Button>
          </div>
        </div>
      ) : null}

      <FormModal
        open={open}
        title={
          editing
            ? t(isSupplies ? 'actions.editSupply' : 'actions.editMedicine')
            : t(isSupplies ? 'actions.addSupply' : 'actions.addMedicine')
        }
        onClose={() => setOpen(false)}
        className="max-w-4xl"
      >
        <form
          className="space-y-6"
          onSubmit={form.handleSubmit(
            (values) => save.mutate(values),
            () => toast.push(t('inventory.medicines.validation.formIncomplete'), 'error'),
          )}
        >
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">{t('inventory.medicines.basicInfo')}</h2>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <Label>{t('table.name')}</Label>
                <Input {...form.register('name')} />
                {form.formState.errors.name ? <p className="text-sm text-destructive">{form.formState.errors.name.message}</p> : null}
              </div>
              <div className="space-y-1">
                <Label>{t('table.genericName')}</Label>
                <Input {...form.register('genericName')} />
              </div>
              <div className="space-y-1">
                <Label>{t('inventory.medicines.brandName')}</Label>
                <Input {...form.register('brandName')} />
              </div>
            </div>
          </section>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">{t('inventory.medicines.classification')}</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="medicine-category">{t('table.category')}</Label>
                <select
                  id="medicine-category"
                  className="h-10 w-full rounded-md border px-3 text-sm"
                  {...form.register('categoryId')}
                >
                  <option value="">{t('common.selectCategory')}</option>
                  {(categories.data?.items ?? []).map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
                {categories.isError ? (
                  <p className="text-sm text-destructive">{(categories.error as Error).message}</p>
                ) : null}
                {form.formState.errors.categoryId ? <p className="text-sm text-destructive">{form.formState.errors.categoryId.message}</p> : null}
              </div>
              <div className="space-y-1">
                <Label htmlFor="medicine-unit">{t('table.unit')}</Label>
                <select
                  id="medicine-unit"
                  className="h-10 w-full rounded-md border px-3 text-sm"
                  {...form.register('unitId')}
                >
                  <option value="">{t('common.selectUnit')}</option>
                  {(units.data?.items ?? []).map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
                {units.isError ? (
                  <p className="text-sm text-destructive">{(units.error as Error).message}</p>
                ) : null}
                {form.formState.errors.unitId ? <p className="text-sm text-destructive">{form.formState.errors.unitId.message}</p> : null}
              </div>
              <div className="space-y-1">
                <Label htmlFor="medicine-dosage">{t('table.dosageForm')}</Label>
                <select
                  id="medicine-dosage"
                  className="h-10 w-full rounded-md border px-3 text-sm"
                  disabled={isSupplies}
                  {...form.register('dosageForm')}
                >
                  {DOSAGE_FORMS.map((item) => (
                    <option key={item} value={item}>{dosageFormLabel(t, item)}</option>
                  ))}
                </select>
                {isSupplies ? (
                  <p className="text-xs text-muted-foreground">{t('inventory.supplies.dosageHint')}</p>
                ) : null}
              </div>
              <div className="space-y-1">
                <Label htmlFor="medicine-strength">
                  {t('table.strength')}
                  {strengthRequired ? ' *' : ''}
                </Label>
                <Input
                  id="medicine-strength"
                  {...form.register('strength')}
                  placeholder={strengthRequired ? t('inventory.medicines.strengthPlaceholder') : t('common.optional')}
                />
                {strengthRequired ? (
                  <p className="text-xs text-muted-foreground">{t('inventory.medicines.strengthRequiredHint')}</p>
                ) : null}
              </div>
            </div>
          </section>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">{t('inventory.medicines.identification')}</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>{t('table.sku')}</Label>
                <Input {...form.register('sku')} placeholder={t('inventory.medicines.skuPlaceholder')} />
              </div>
              <div className="space-y-1">
                <Label>{t('table.barcode')}</Label>
                <Input {...form.register('barcode')} placeholder={t('inventory.medicines.barcodePlaceholder')} />
              </div>
            </div>
          </section>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">{t('inventory.medicines.inventoryRules')}</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>{t('table.minimumStock')}</Label>
                <Input type="number" min={0} {...form.register('minimumStock')} />
                {form.formState.errors.minimumStock ? <p className="text-sm text-destructive">{form.formState.errors.minimumStock.message}</p> : null}
              </div>
              <div className="space-y-1">
                <Label>{t('table.reorderQuantity')}</Label>
                <Input type="number" min={0} {...form.register('reorderQuantity')} />
                {form.formState.errors.reorderQuantity ? <p className="text-sm text-destructive">{form.formState.errors.reorderQuantity.message}</p> : null}
              </div>
            </div>
          </section>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">{t('inventory.medicines.optionalValue')}</h2>
            <div className="space-y-1 md:w-1/2">
              <Label>{t('inventory.medicines.estimatedUnitValue')}</Label>
              <Input type="number" min={0} step="0.01" {...form.register('referenceValue')} />
              <p className="text-xs text-muted-foreground">{t('inventory.medicines.estimatedUnitValueHint')}</p>
            </div>
          </section>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">{t('inventory.medicines.additionalInfo')}</h2>
            <div className="space-y-1">
              <Label>{t('table.description')}</Label>
              <Input {...form.register('description')} />
            </div>
          </section>
          <div className="flex gap-2">
            <Button type="submit" disabled={save.isPending}>{save.isPending ? t('common.saving') : t('common.save')}</Button>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
          </div>
        </form>
      </FormModal>

      {selected ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('inventory.medicines.detailsTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {details.isLoading ? <div className="h-24 animate-pulse rounded bg-muted" /> : null}
            {details.data ? (
              <>
                <div className="grid gap-2 md:grid-cols-2">
                  <p><strong>{t('inventory.medicines.fields.medicine')}</strong> {details.data.name}</p>
                  <p><strong>{t('inventory.medicines.fields.generic')}</strong> {details.data.genericName || emDash}</p>
                  <p><strong>{t('inventory.medicines.fields.brand')}</strong> {details.data.brandName || emDash}</p>
                  <p><strong>{t('table.category')}:</strong> {details.data.category?.name ?? emDash}</p>
                  <p><strong>{t('table.unit')}:</strong> {details.data.unit?.name ?? emDash}</p>
                  <p><strong>{t('table.sku')}:</strong> {details.data.sku}</p>
                  <p><strong>{t('table.barcode')}:</strong> {details.data.barcode || emDash}</p>
                  <p><strong>{t('inventory.medicines.fields.minimumStock')}</strong> {details.data.minimumStock}</p>
                  <p><strong>{t('inventory.medicines.fields.reorderQuantity')}</strong> {details.data.reorderQuantity}</p>
                  <p><strong>{t('inventory.medicines.fields.estimatedUnitValue')}</strong> {details.data.referenceValue ?? emDash}</p>
                  <p><strong>{t('table.status')}:</strong> {details.data.status}</p>
                </div>
                <div>
                  <h3 className="mb-2 font-medium">{t('inventory.medicines.batchesTitle')}</h3>
                  {(details.data.batches ?? []).length === 0 ? (
                    <p className="text-muted-foreground">{t('inventory.medicines.noBatches')}</p>
                  ) : (
                    <ul className="space-y-1">
                      {(details.data.batches ?? []).map((batch) => (
                        <li key={batch.id}>
                          {t('inventory.medicines.batchLine', {
                            batch: batch.batchNumber,
                            expiry: String(batch.expiryDate).slice(0, 10),
                            mfg: batch.manufacturingDate
                              ? t('inventory.medicines.batchMfg', {
                                  date: String(batch.manufacturingDate).slice(0, 10),
                                })
                              : '',
                          })}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => setSelected(null)}>{t('common.close')}</Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
