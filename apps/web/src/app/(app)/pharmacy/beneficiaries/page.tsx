'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiList, apiRequest } from '@/lib/api';
import { useI18n } from '@/i18n';

interface Beneficiary {
  id: string;
  beneficiaryNumber: string;
  fullName?: string | null;
  name?: string | null;
  phone?: string | null;
  externalReference?: string | null;
  status: string;
  isActive: boolean;
}

export default function BeneficiariesPage() {
  const { t } = useI18n();
  const dash = t('common.emDash');
  const client = useQueryClient();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get('search') ?? '');
  const [status, setStatus] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [page, setPage] = useState(1);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const query = useQuery({
    queryKey: ['beneficiaries', search, status, page],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: '20',
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });
      if (search.trim()) params.set('search', search.trim());
      if (status !== 'ALL') params.set('status', status);
      return apiList<Beneficiary>(`/beneficiaries?${params.toString()}`);
    },
  });

  const create = useMutation({
    mutationFn: () =>
      apiRequest('/beneficiaries', {
        method: 'POST',
        body: {
          fullName,
          phone: phone || undefined,
        },
      }),
    onSuccess: () => {
      setFullName('');
      setPhone('');
      setShowCreate(false);
      client.invalidateQueries({ queryKey: ['beneficiaries'] });
    },
  });

  const toggle = useMutation({
    mutationFn: ({ id, activate }: { id: string; activate: boolean }) =>
      apiRequest(`/beneficiaries/${id}/${activate ? 'activate' : 'deactivate'}`, {
        method: 'POST',
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['beneficiaries'] }),
  });

  const items = query.data?.items ?? [];
  const totalPages = query.data?.meta?.totalPages ?? 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('beneficiaries.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('beneficiaries.subtitle')}</p>
        </div>
        <Button type="button" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? t('actions.close') : t('actions.newBeneficiary')}
        </Button>
      </div>

      {showCreate ? (
        <form
          className="grid max-w-xl gap-3 rounded-lg border p-4 md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Input
            placeholder={t('beneficiaries.fullName')}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
          <Input
            type="tel"
            dir="ltr"
            className="dir-ltr"
            placeholder={t('beneficiaries.phoneOptional')}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          {create.error ? (
            <p className="text-sm text-destructive md:col-span-2">
              {(create.error as Error).message}
            </p>
          ) : null}
          <Button type="submit" disabled={create.isPending} className="md:col-span-2">
            {t('common.create')}
          </Button>
        </form>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Input
          className="max-w-sm"
          placeholder={t('beneficiaries.searchPlaceholder')}
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
        />
        <select
          className="h-10 rounded-md border px-3 text-sm"
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value as typeof status);
          }}
        >
          <option value="ALL">{t('filters.allStatuses')}</option>
          <option value="ACTIVE">{t('beneficiaries.filterActive')}</option>
          <option value="INACTIVE">{t('beneficiaries.filterInactive')}</option>
        </select>
      </div>

      {query.isLoading ? <p className="text-sm text-muted-foreground">{t('common.loading')}</p> : null}
      {query.error ? (
        <p className="text-sm text-destructive">{(query.error as Error).message}</p>
      ) : null}

      {!query.isLoading && items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('beneficiaries.noResults')}</p>
      ) : null}

      {items.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-start">{t('table.number')}</th>
                <th className="px-3 py-2 text-start">{t('table.name')}</th>
                <th className="px-3 py-2 text-start">{t('beneficiaries.phone')}</th>
                <th className="px-3 py-2 text-start">{t('table.status')}</th>
                <th className="px-3 py-2 text-start" />
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="px-3 py-2 text-start">
                    <span dir="ltr" className="dir-ltr inline-block font-mono text-xs sm:text-sm">
                      {row.beneficiaryNumber}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-start">{row.fullName ?? row.name ?? dash}</td>
                  <td className="px-3 py-2 text-start">
                    {row.phone ? (
                      <span dir="ltr" className="dir-ltr inline-block">
                        {row.phone}
                      </span>
                    ) : (
                      dash
                    )}
                  </td>
                  <td className="px-3 py-2 text-start">
                    <span dir="ltr" className="dir-ltr inline-block">
                      {row.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-start">
                    <div className="flex flex-wrap items-center justify-start gap-2">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/pharmacy/beneficiaries/${row.id}`}>{t('actions.view')}</Link>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={toggle.isPending}
                        onClick={() =>
                          toggle.mutate({ id: row.id, activate: row.status !== 'ACTIVE' })
                        }
                      >
                        {row.status === 'ACTIVE' ? t('actions.deactivate') : t('actions.activate')}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {totalPages > 1 ? (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
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
