'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/empty-state';
import { TableSkeleton } from '@/components/skeleton';
import { useI18n } from '@/i18n';
import { apiDownload, apiList } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { hasPermission } from '@/lib/permissions';
import { reportsHomePath } from '@/lib/reports-home';

export interface ReportColumn {
  key: string;
  header: string;
  render?: (row: Record<string, unknown>) => React.ReactNode;
}

export interface ReportFilterField {
  key: string;
  label: string;
  type?: 'text' | 'date' | 'select';
  options?: Array<{ value: string; label: string }>;
}

type ReportScope = 'all' | 'current' | 'custom';

function buildQuery(params: Record<string, string>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  return search.toString();
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function hasDateRangeFilters(filters: ReportFilterField[]) {
  const keys = new Set(filters.map((f) => f.key));
  return (
    (keys.has('dateFrom') && keys.has('dateTo')) ||
    (keys.has('registeredFrom') && keys.has('registeredTo'))
  );
}

function dateFromKey(filters: ReportFilterField[]) {
  return filters.some((f) => f.key === 'registeredFrom') ? 'registeredFrom' : 'dateFrom';
}

function dateToKey(filters: ReportFilterField[]) {
  return filters.some((f) => f.key === 'registeredTo') ? 'registeredTo' : 'dateTo';
}

export function ReportPage({
  title,
  description,
  endpoint,
  exportType,
  columns,
  filters = [],
  backHref,
}: {
  title: string;
  description: string;
  endpoint: string;
  exportType: string;
  columns: ReportColumn[];
  filters?: ReportFilterField[];
  backHref?: string;
}) {
  const { user } = useAuth();
  const { t } = useI18n();
  const resolvedBackHref = backHref ?? reportsHomePath(user);
  const canExport = hasPermission(user, 'report:export') || hasPermission(user, 'reports:export');
  const emDash = t('common.emDash');
  const supportsScope = hasDateRangeFilters(filters);
  const fromKey = dateFromKey(filters);
  const toKey = dateToKey(filters);

  const [scope, setScope] = useState<ReportScope>('all');
  const [values, setValues] = useState<Record<string, string>>({});
  const [applied, setApplied] = useState<Record<string, string>>(
    supportsScope ? { period: 'ALL' } : {},
  );
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const queryString = useMemo(() => {
    return buildQuery({ ...applied, page: String(page), limit: '20' });
  }, [applied, page]);

  const query = useQuery({
    queryKey: ['report', endpoint, queryString],
    queryFn: () => apiList<Record<string, unknown>>(`${endpoint}?${queryString}`),
  });

  const activeFilters = Object.entries(applied).filter(([, v]) => v);

  const nonDateFilters = filters.filter(
    (field) => field.key !== fromKey && field.key !== toKey,
  );
  const dateFilters = filters.filter(
    (field) => field.key === fromKey || field.key === toKey,
  );

  function buildScopedValues(nextScope: ReportScope, nextValues: Record<string, string>) {
    const base = { ...nextValues };
    delete base.period;
    delete base[fromKey];
    delete base[toKey];

    if (!supportsScope) return nextValues;

    if (nextScope === 'all') {
      return { ...base, period: 'ALL' };
    }
    if (nextScope === 'current') {
      const today = todayIsoDate();
      return { ...base, period: 'TODAY', [fromKey]: today, [toKey]: today };
    }
    return {
      ...base,
      period: 'CUSTOM',
      [fromKey]: nextValues[fromKey] ?? '',
      [toKey]: nextValues[toKey] ?? '',
    };
  }

  function applyScope(nextScope: ReportScope) {
    setScope(nextScope);
    const nextValues =
      nextScope === 'current'
        ? { ...values, [fromKey]: todayIsoDate(), [toKey]: todayIsoDate() }
        : nextScope === 'all'
          ? { ...values, [fromKey]: '', [toKey]: '' }
          : values;
    setValues(nextValues);
    setPage(1);
    setApplied(buildScopedValues(nextScope, nextValues));
  }

  async function doExport(format: 'csv' | 'xlsx' | 'pdf') {
    setExportError(null);
    setExporting(format);
    try {
      const qs = buildQuery({ ...applied, format, limit: '5000' });
      await apiDownload(`/reports/${exportType}/export?${qs}`, `${exportType}.${format === 'xlsx' ? 'xlsx' : format}`);
    } catch (error) {
      setExportError((error as Error).message);
    } finally {
      setExporting(null);
    }
  }

  const items = query.data?.items ?? [];
  const totalPages = query.data?.meta?.totalPages ?? 1;
  const total = query.data?.meta?.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button asChild variant="outline">
          <Link href={resolvedBackHref}>{t('common.back')}</Link>
        </Button>
      </div>

      {supportsScope ? (
        <div className="flex flex-wrap gap-2">
          {(
            [
              { id: 'all', label: t('reports.scopeAll') },
              { id: 'current', label: t('reports.scopeCurrent') },
              { id: 'custom', label: t('reports.scopeCustom') },
            ] as const
          ).map((item) => (
            <Button
              key={item.id}
              type="button"
              variant={scope === item.id ? 'default' : 'outline'}
              onClick={() => applyScope(item.id)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 rounded-lg border p-3">
        {nonDateFilters.map((field) =>
          field.type === 'select' ? (
            <select
              key={field.key}
              className="h-10 rounded-md border px-3 text-sm"
              value={values[field.key] ?? ''}
              onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
            >
              <option value="">{field.label}</option>
              {(field.options ?? []).map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : (
            <Input
              key={field.key}
              type={field.type === 'date' ? 'date' : 'text'}
              placeholder={field.label}
              className="max-w-[180px]"
              value={values[field.key] ?? ''}
              onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
            />
          ),
        )}
        {supportsScope && scope === 'custom'
          ? dateFilters.map((field) => (
              <Input
                key={field.key}
                type="date"
                placeholder={field.label}
                className="max-w-[180px]"
                value={values[field.key] ?? ''}
                onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
              />
            ))
          : null}
        {!supportsScope
          ? dateFilters.map((field) => (
              <Input
                key={field.key}
                type="date"
                placeholder={field.label}
                className="max-w-[180px]"
                value={values[field.key] ?? ''}
                onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
              />
            ))
          : null}
        <Button
          type="button"
          onClick={() => {
            setPage(1);
            setApplied(buildScopedValues(scope, values));
          }}
        >
          {t('common.apply')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setValues({});
            setScope('all');
            setApplied(supportsScope ? { period: 'ALL' } : {});
            setPage(1);
          }}
        >
          {t('reports.reset')}
        </Button>
        <Button type="button" variant="ghost" onClick={() => query.refetch()}>
          {t('common.refresh')}
        </Button>
      </div>

      {activeFilters.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('reports.activeFilters', {
            filters: activeFilters.map(([k, v]) => `${k}=${v}`).join(' · '),
          })}
        </p>
      ) : null}

      {canExport ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" disabled={!!exporting} onClick={() => doExport('csv')}>
            {exporting === 'csv' ? t('reports.exporting') : t('reports.exportCsv')}
          </Button>
          <Button type="button" variant="outline" disabled={!!exporting} onClick={() => doExport('xlsx')}>
            {exporting === 'xlsx' ? t('reports.exporting') : t('reports.exportExcel')}
          </Button>
          <Button type="button" variant="outline" disabled={!!exporting} onClick={() => doExport('pdf')}>
            {exporting === 'pdf' ? t('reports.exporting') : t('reports.exportPdf')}
          </Button>
          {exportError ? <span className="text-sm text-destructive">{exportError}</span> : null}
        </div>
      ) : null}

      <p className="text-sm text-muted-foreground">
        {total === 1 ? t('reports.recordCount', { count: total }) : t('reports.recordCountPlural', { count: total })}
      </p>

      {query.isLoading ? <TableSkeleton rows={8} cols={Math.min(columns.length, 5)} /> : null}
      {query.error ? (
        <EmptyState
          title={t('common.unableToLoad')}
          description={(query.error as Error).message}
        />
      ) : null}
      {!query.isLoading && items.length === 0 ? (
        <EmptyState title={t('reports.noRecords')} />
      ) : null}

      {items.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                {columns.map((col) => (
                  <th key={col.key} scope="col" className="px-3 py-2 font-medium">
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((row, index) => (
                <tr key={String(row.id ?? index)} className="border-t">
                  {columns.map((col) => (
                    <td key={col.key} className="px-3 py-2 align-top">
                      {col.render
                        ? col.render(row)
                        : row[col.key] == null
                          ? emDash
                          : String(row[col.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {totalPages > 1 ? (
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t('common.previous')}
          </Button>
          <span className="text-sm text-muted-foreground">
            {t('reports.pageOf', { page, totalPages })}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t('common.next')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
