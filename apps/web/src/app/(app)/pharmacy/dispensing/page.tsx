'use client';

import Link from 'next/link';
import { Plus, Trash2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiList, apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { hasPermission } from '@/lib/permissions';
import { useToast } from '@/lib/toast';
import { useI18n } from '@/i18n';
import { CATALOG_ITEM_TYPE } from '@mh/shared';

type CatalogMode = typeof CATALOG_ITEM_TYPE.MEDICINE | typeof CATALOG_ITEM_TYPE.MEDICAL_SUPPLY;

interface Beneficiary {
  id: string;
  beneficiaryNumber: string;
  fullName?: string | null;
  name?: string | null;
  phone?: string | null;
  status: string;
  isActive: boolean;
}

interface Medicine {
  id: string;
  name: string;
  referenceValue?: string | number | null;
}

interface StockRow {
  id: string;
  medicineId: string;
  quantity: number;
  medicine?: Medicine;
  batch?: { batchNumber: string; expiryDate: string };
}

interface LineItem {
  medicineId: string;
  medicineName: string;
  itemType: CatalogMode;
  quantity: number;
  available: number;
  estimatedUnitValue: number | null;
}

interface DispenseResult {
  id: string;
  dispensingNumber: string;
  medicines: Array<{
    medicineName: string;
    quantity: number;
    batches: Array<{ batchNumber: string; quantity: number }>;
  }>;
}

interface CategoryAdder {
  id: string;
  catalogType: CatalogMode;
  search: string;
  medicineId: string;
  quantity: string;
}

function newAdderId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `adder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createAdder(catalogType: CatalogMode = CATALOG_ITEM_TYPE.MEDICINE): CategoryAdder {
  return {
    id: newAdderId(),
    catalogType,
    search: '',
    medicineId: '',
    quantity: '1',
  };
}

export default function DispensingPage() {
  const { t } = useI18n();
  const dash = t('common.emDash');
  const client = useQueryClient();
  const { push } = useToast();
  const { user } = useAuth();
  const canRequestStock =
    hasPermission(user, 'supply-requests:create') || hasPermission(user, 'supply-request:create');

  const [beneficiarySearch, setBeneficiarySearch] = useState('');
  const [selectedBeneficiary, setSelectedBeneficiary] = useState<Beneficiary | null>(null);
  const [adders, setAdders] = useState<CategoryAdder[]>([createAdder(CATALOG_ITEM_TYPE.MEDICINE)]);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineItem[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<DispenseResult | null>(null);

  const beneficiaries = useQuery({
    queryKey: ['beneficiaries-search', beneficiarySearch],
    queryFn: () =>
      apiList<Beneficiary>(
        `/beneficiaries?limit=20&status=ACTIVE&search=${encodeURIComponent(beneficiarySearch)}`,
      ),
  });

  const medicineCatalog = useQuery({
    queryKey: ['medicines-disp', CATALOG_ITEM_TYPE.MEDICINE],
    queryFn: () =>
      apiList<Medicine>(
        `/medicines?limit=100&isActive=true&itemType=${encodeURIComponent(CATALOG_ITEM_TYPE.MEDICINE)}`,
      ),
  });

  const supplyCatalog = useQuery({
    queryKey: ['medicines-disp', CATALOG_ITEM_TYPE.MEDICAL_SUPPLY],
    queryFn: () =>
      apiList<Medicine>(
        `/medicines?limit=100&isActive=true&itemType=${encodeURIComponent(CATALOG_ITEM_TYPE.MEDICAL_SUPPLY)}`,
      ),
  });

  const stock = useQuery({
    queryKey: ['pharmacy-stock-disp'],
    queryFn: () => apiList<StockRow>('/pharmacy-stock?limit=100'),
  });

  const todayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const availableByMedicine = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of stock.data?.items ?? []) {
      const expiry = row.batch?.expiryDate ? new Date(row.batch.expiryDate) : null;
      if (expiry && expiry < todayStart) continue;
      map.set(row.medicineId, (map.get(row.medicineId) ?? 0) + Number(row.quantity || 0));
    }
    return map;
  }, [stock.data, todayStart]);

  const expiredOnlyMedicineIds = useMemo(() => {
    const expired = new Set<string>();
    const hasValid = new Set<string>();
    for (const row of stock.data?.items ?? []) {
      const expiry = row.batch?.expiryDate ? new Date(row.batch.expiryDate) : null;
      const qty = Number(row.quantity || 0);
      if (qty <= 0) continue;
      if (expiry && expiry < todayStart) expired.add(row.medicineId);
      else hasValid.add(row.medicineId);
    }
    for (const id of hasValid) expired.delete(id);
    return expired;
  }, [stock.data, todayStart]);

  const linesWithLiveAvailability = useMemo(
    () =>
      lines.map((line) => ({
        ...line,
        available: availableByMedicine.get(line.medicineId) ?? 0,
        insufficient: (availableByMedicine.get(line.medicineId) ?? 0) < line.quantity,
      })),
    [lines, availableByMedicine],
  );

  const hasInsufficientStock = linesWithLiveAvailability.some((line) => line.insufficient);

  const catalogFor = (type: CatalogMode) =>
    type === CATALOG_ITEM_TYPE.MEDICAL_SUPPLY
      ? (supplyCatalog.data?.items ?? [])
      : (medicineCatalog.data?.items ?? []);

  const filteredFor = (adder: CategoryAdder) => {
    const q = adder.search.trim().toLowerCase();
    return catalogFor(adder.catalogType).filter((item) =>
      !q ? true : item.name.toLowerCase().includes(q),
    );
  };

  const dispense = useMutation({
    mutationFn: async () => {
      const key =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `disp-${Date.now()}`;
      return apiRequest<DispenseResult>('/dispensings', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: {
          beneficiaryId: selectedBeneficiary!.id,
          notes: notes || undefined,
          items: lines.map((line) => ({
            medicineId: line.medicineId,
            quantity: line.quantity,
          })),
        },
      });
    },
    onSuccess: (data) => {
      setResult(data);
      setConfirmOpen(false);
      setLines([]);
      setNotes('');
      setAdders([createAdder(CATALOG_ITEM_TYPE.MEDICINE)]);
      push(t('toasts.dispensingCompleted'), 'success');
      client.invalidateQueries({ queryKey: ['pharmacy-stock'] });
      client.invalidateQueries({ queryKey: ['pharmacy-stock-disp'] });
      client.invalidateQueries({ queryKey: ['dispensing'] });
      client.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (error) => {
      push((error as Error).message || t('toasts.dispensingFailed'), 'error');
    },
  });

  function updateAdder(id: string, patch: Partial<CategoryAdder>) {
    setAdders((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function addLineFrom(adder: CategoryAdder) {
    const items = filteredFor(adder);
    const selected = items.find((item) => item.id === adder.medicineId);
    if (!selected || Number(adder.quantity) < 1) return;
    const liveAvail = availableByMedicine.get(selected.id) ?? 0;
    if (liveAvail <= 0) return;
    const qty = Number(adder.quantity);
    setLines((prev) => {
      const existing = prev.find((row) => row.medicineId === selected.id);
      if (existing) {
        return prev.map((row) =>
          row.medicineId === selected.id ? { ...row, quantity: row.quantity + qty } : row,
        );
      }
      const unit = selected.referenceValue != null ? Number(selected.referenceValue) : null;
      return [
        ...prev,
        {
          medicineId: selected.id,
          medicineName: selected.name,
          itemType: adder.catalogType,
          quantity: qty,
          available: liveAvail,
          estimatedUnitValue: Number.isFinite(unit as number) ? unit : null,
        },
      ];
    });
    updateAdder(adder.id, { medicineId: '', search: '', quantity: '1' });
  }

  function addCategoryRow() {
    const hasSupply = adders.some((row) => row.catalogType === CATALOG_ITEM_TYPE.MEDICAL_SUPPLY);
    setAdders((prev) => [
      ...prev,
      createAdder(hasSupply ? CATALOG_ITEM_TYPE.MEDICINE : CATALOG_ITEM_TYPE.MEDICAL_SUPPLY),
    ]);
  }

  const insufficientMedicineIds = linesWithLiveAvailability
    .filter((line) => line.insufficient)
    .map((line) => line.medicineId);
  const requestStockHref =
    insufficientMedicineIds.length > 0
      ? `/pharmacy/supply-requests?create=1&medicineId=${encodeURIComponent(insufficientMedicineIds[0]!)}`
      : '/pharmacy/supply-requests?create=1';

  const totalQty = lines.reduce((sum, row) => sum + row.quantity, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('dispensing.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('dispensing.subtitle')}</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/pharmacy/dispensing-history">{t('dispensing.historyLink')}</Link>
        </Button>
      </div>

      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="font-medium">{t('dispensing.beneficiary')}</h2>
        {selectedBeneficiary ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-sm">
            <div>
              <div className="font-medium">
                {selectedBeneficiary.fullName ?? selectedBeneficiary.name}
              </div>
              <div className="text-muted-foreground">
                <span dir="ltr" className="dir-ltr inline-block">
                  {selectedBeneficiary.beneficiaryNumber}
                </span>
                {selectedBeneficiary.phone ? (
                  <>
                    {' · '}
                    <span dir="ltr" className="dir-ltr inline-block">
                      {selectedBeneficiary.phone}
                    </span>
                  </>
                ) : null}
              </div>
            </div>
            <Button type="button" variant="ghost" onClick={() => setSelectedBeneficiary(null)}>
              {t('actions.change')}
            </Button>
          </div>
        ) : (
          <>
            <Input
              placeholder={t('dispensing.searchBeneficiary')}
              value={beneficiarySearch}
              onChange={(e) => setBeneficiarySearch(e.target.value)}
            />
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {(beneficiaries.data?.items ?? []).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="flex w-full items-center justify-between rounded-md px-3 py-2 text-start text-sm hover:bg-muted"
                  onClick={() => setSelectedBeneficiary(item)}
                >
                  <span>{item.fullName ?? item.name}</span>
                  <span className="dir-ltr text-muted-foreground" dir="ltr">
                    {item.beneficiaryNumber}
                  </span>
                </button>
              ))}
            </div>
            <Link href="/pharmacy/beneficiaries" className="text-sm text-primary hover:underline">
              {t('dispensing.manageBeneficiaries')}
            </Link>
          </>
        )}
      </section>

      <section className="space-y-4 rounded-lg border p-4">
        <div>
          <h2 className="font-medium">{t('dispensing.items')}</h2>
          <p className="text-sm text-muted-foreground">{t('dispensing.itemsHint')}</p>
        </div>

        {stock.isError ? (
          <p className="text-sm text-destructive">{t('dispensing.stockLoadError')}</p>
        ) : null}

        <div className="space-y-3">
          {adders.map((adder) => {
            const isSupplies = adder.catalogType === CATALOG_ITEM_TYPE.MEDICAL_SUPPLY;
            const options = filteredFor(adder);
            const selected = options.find((item) => item.id === adder.medicineId);
            const avail = adder.medicineId ? (availableByMedicine.get(adder.medicineId) ?? 0) : 0;
            return (
              <div key={adder.id} className="space-y-2 rounded-md border bg-muted/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-sm font-medium">{t('dispensing.category')}</label>
                  {adders.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setAdders((prev) => prev.filter((row) => row.id !== adder.id))}
                    >
                      <Trash2 className="me-1 h-4 w-4" />
                      {t('dispensing.removeCategoryRow')}
                    </Button>
                  ) : null}
                </div>
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.4fr)_auto]">
                  <select
                    className="h-10 rounded-md border bg-background px-3 text-sm"
                    value={adder.catalogType}
                    onChange={(e) =>
                      updateAdder(adder.id, {
                        catalogType: e.target.value as CatalogMode,
                        medicineId: '',
                        search: '',
                      })
                    }
                  >
                    <option value={CATALOG_ITEM_TYPE.MEDICINE}>
                      {t('catalogTypes.MEDICINE')}
                    </option>
                    <option value={CATALOG_ITEM_TYPE.MEDICAL_SUPPLY}>
                      {t('catalogTypes.MEDICAL_SUPPLY')}
                    </option>
                  </select>
                  <Input
                    placeholder={t(
                      isSupplies ? 'dispensing.searchSupply' : 'dispensing.searchMedicine',
                    )}
                    value={adder.search}
                    onChange={(e) => updateAdder(adder.id, { search: e.target.value })}
                  />
                  <select
                    className="h-10 rounded-md border bg-background px-3 text-sm"
                    value={adder.medicineId}
                    onChange={(e) => updateAdder(adder.id, { medicineId: e.target.value })}
                  >
                    <option value="">
                      {t(isSupplies ? 'dispensing.selectSupply' : 'dispensing.selectMedicine')}
                    </option>
                    {options.map((item) => {
                      const itemAvail = availableByMedicine.get(item.id) ?? 0;
                      const expiredOnly = expiredOnlyMedicineIds.has(item.id);
                      const disabled = itemAvail <= 0;
                      const label = expiredOnly
                        ? t('dispensing.medicineExpiredOnly', { name: item.name })
                        : t('dispensing.medicineAvail', { name: item.name, avail: itemAvail });
                      return (
                        <option key={item.id} value={item.id} disabled={disabled}>
                          {label}
                        </option>
                      );
                    })}
                  </select>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min={1}
                      className="w-20"
                      value={adder.quantity}
                      onChange={(e) => updateAdder(adder.id, { quantity: e.target.value })}
                    />
                    <Button
                      type="button"
                      onClick={() => addLineFrom(adder)}
                      disabled={!adder.medicineId || avail <= 0}
                    >
                      {t('actions.add')}
                    </Button>
                  </div>
                </div>
                {adder.medicineId ? (
                  <p className="text-sm text-muted-foreground">
                    {t('dispensing.availableNonExpired', { avail })}
                    {selected?.referenceValue != null
                      ? t('dispensing.estimatedUnitValue', { value: selected.referenceValue })
                      : ''}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>

        <Button type="button" variant="outline" onClick={addCategoryRow}>
          <Plus className="me-1 h-4 w-4" />
          {t('dispensing.addCategoryRow')}
        </Button>

        {linesWithLiveAvailability.length > 0 ? (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-3 py-2 text-start">{t('table.type')}</th>
                  <th className="px-3 py-2 text-start">{t('dispensing.item')}</th>
                  <th className="px-3 py-2 text-start">{t('dispensing.requested')}</th>
                  <th className="px-3 py-2 text-start">{t('dispensing.available')}</th>
                  <th className="px-3 py-2 text-start">{t('dispensing.estUnitValue')}</th>
                  <th className="px-3 py-2 text-start">{t('dispensing.estTotalValue')}</th>
                  <th className="px-3 py-2 text-start" />
                </tr>
              </thead>
              <tbody>
                {linesWithLiveAvailability.map((line) => (
                  <tr key={line.medicineId} className="border-t">
                    <td className="px-3 py-2 text-start text-xs text-muted-foreground">
                      {t(
                        line.itemType === CATALOG_ITEM_TYPE.MEDICAL_SUPPLY
                          ? 'catalogTypes.MEDICAL_SUPPLY'
                          : 'catalogTypes.MEDICINE',
                      )}
                    </td>
                    <td className="px-3 py-2 text-start">
                      <div>{line.medicineName}</div>
                      {line.insufficient ? (
                        <div className="mt-0.5 text-xs text-destructive">
                          {t('dispensing.insufficientStock')}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-start">{line.quantity}</td>
                    <td
                      className={`px-3 py-2 text-start ${line.insufficient ? 'text-destructive' : ''}`}
                    >
                      {line.available}
                    </td>
                    <td className="px-3 py-2 text-start">
                      {line.estimatedUnitValue != null ? line.estimatedUnitValue : dash}
                    </td>
                    <td className="px-3 py-2 text-start">
                      {line.estimatedUnitValue != null
                        ? (line.estimatedUnitValue * line.quantity).toFixed(2)
                        : dash}
                    </td>
                    <td className="px-3 py-2 text-start">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setLines((prev) =>
                            prev.filter((row) => row.medicineId !== line.medicineId),
                          )
                        }
                      >
                        {t('actions.remove')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('dispensing.noItemsSelected')}</p>
        )}

        {hasInsufficientStock ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <p>{t('dispensing.insufficientBanner')}</p>
            {canRequestStock ? (
              <p className="mt-1">
                <Link href={requestStockHref} className="font-medium underline underline-offset-2">
                  {t('dispensing.requestFromWarehouse')}
                </Link>
              </p>
            ) : (
              <p className="mt-1 text-muted-foreground">{t('dispensing.askManagerSupply')}</p>
            )}
          </div>
        ) : null}

        <Input
          placeholder={t('dispensing.optionalNotes')}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {t('dispensing.totalQuantity', { qty: totalQty })}
          </p>
          <div className="flex flex-wrap gap-2">
            {hasInsufficientStock && canRequestStock ? (
              <Button asChild variant="outline">
                <Link href={requestStockHref}>{t('actions.requestStock')}</Link>
              </Button>
            ) : null}
            <Button
              type="button"
              disabled={!selectedBeneficiary || lines.length === 0 || hasInsufficientStock}
              onClick={() => setConfirmOpen(true)}
            >
              {t('actions.reviewConfirm')}
            </Button>
          </div>
        </div>
      </section>

      {confirmOpen ? (
        <section className="space-y-3 rounded-lg border border-primary/30 bg-muted/20 p-4">
          <h2 className="font-medium">{t('dispensing.confirmTitle')}</h2>
          <p className="text-sm">
            {t('dispensing.confirmBeneficiary')}{' '}
            <strong>{selectedBeneficiary?.fullName ?? selectedBeneficiary?.name}</strong> (
            <span dir="ltr" className="dir-ltr inline-block">
              {selectedBeneficiary?.beneficiaryNumber}
            </span>
            )
          </p>
          <ul className="space-y-2 text-sm">
            {linesWithLiveAvailability.map((line) => (
              <li
                key={line.medicineId}
                className="flex flex-wrap items-baseline justify-between gap-2"
              >
                <span>
                  <span className="text-xs text-muted-foreground">
                    {t(
                      line.itemType === CATALOG_ITEM_TYPE.MEDICAL_SUPPLY
                        ? 'catalogTypes.MEDICAL_SUPPLY'
                        : 'catalogTypes.MEDICINE',
                    )}
                    {' · '}
                  </span>
                  {line.medicineName}
                  <span className="text-muted-foreground">
                    {' '}
                    {t('dispensing.confirmLineDetail', {
                      requested: line.quantity,
                      available: line.available,
                    })}
                  </span>
                </span>
                {line.insufficient ? (
                  <span className="text-xs font-medium text-destructive">
                    {t('dispensing.insufficientStock')}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{t('dispensing.fefoHint')}</p>
          {hasInsufficientStock ? (
            <div className="space-y-2 text-sm text-destructive">
              <p>{t('dispensing.insufficientBanner')}</p>
              {canRequestStock ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={requestStockHref}>{t('actions.requestStock')}</Link>
                </Button>
              ) : null}
            </div>
          ) : null}
          {dispense.error ? (
            <p className="text-sm text-destructive">{(dispense.error as Error).message}</p>
          ) : null}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              {t('common.back')}
            </Button>
            <Button
              type="button"
              disabled={dispense.isPending || hasInsufficientStock}
              onClick={() => dispense.mutate()}
            >
              {dispense.isPending ? t('dispensing.dispensing') : t('actions.confirmDispensing')}
            </Button>
          </div>
        </section>
      ) : null}

      {result ? (
        <section className="space-y-3 rounded-lg border p-4">
          <h2 className="font-medium">
            {t('dispensing.dispensedTitle', { number: result.dispensingNumber })}
          </h2>
          {(result.medicines ?? []).map((med) => (
            <div key={med.medicineName} className="text-sm">
              <div className="font-medium">
                {med.medicineName} {dash} {med.quantity}
              </div>
              <ul className="ms-4 list-disc text-muted-foreground">
                {med.batches.map((batch) => (
                  <li key={`${batch.batchNumber}-${batch.quantity}`}>
                    {t('dispensing.batchLine', {
                      batchNumber: batch.batchNumber,
                      quantity: batch.quantity,
                    })}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <Button asChild variant="outline">
            <Link href={`/pharmacy/dispensing/${result.id}`}>{t('actions.viewDetails')}</Link>
          </Button>
        </section>
      ) : null}
    </div>
  );
}
