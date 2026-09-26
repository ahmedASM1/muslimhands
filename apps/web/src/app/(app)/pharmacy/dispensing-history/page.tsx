'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiList } from '@/lib/api';
import { useI18n } from '@/i18n';

interface DispensingRow {
  id: string;
  dispensingNumber: string;
  recordNumber?: string;
  dispensedAt: string;
  beneficiary?: { fullName?: string | null; name?: string | null; beneficiaryNumber?: string };
  dispensedBy?: { firstName?: string; lastName?: string };
  medicines?: Array<{ medicineName: string; quantity: number }>;
}

export default function DispensingHistoryPage() {
  const { t } = useI18n();
  const dash = t('common.emDash');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ['dispensing-history', search, from, to, page],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: '20',
        sortBy: 'dispensedAt',
        sortOrder: 'desc',
      });
      if (search.trim()) params.set('search', search.trim());
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      return apiList<DispensingRow>(`/dispensings?${params.toString()}`);
    },
  });

  const items = query.data?.items ?? [];
  const totalPages = query.data?.meta?.totalPages ?? 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('dispensing.historyTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('dispensing.historySubtitle')}</p>
        </div>
        <Button asChild>
          <Link href="/pharmacy/dispensing">{t('actions.newDispensing')}</Link>
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          className="max-w-sm"
          placeholder={t('dispensing.searchNumberBeneficiary')}
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
        />
        <Input
          type="date"
          value={from}
          onChange={(e) => {
            setPage(1);
            setFrom(e.target.value);
          }}
        />
        <Input
          type="date"
          value={to}
          onChange={(e) => {
            setPage(1);
            setTo(e.target.value);
          }}
        />
      </div>

      {query.isLoading ? <p className="text-sm text-muted-foreground">{t('common.loading')}</p> : null}
      {query.error ? (
        <p className="text-sm text-destructive">{(query.error as Error).message}</p>
      ) : null}
      {!query.isLoading && items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('dispensing.noRecords')}</p>
      ) : null}

      {items.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2">{t('table.number')}</th>
                <th className="px-3 py-2">{t('table.date')}</th>
                <th className="px-3 py-2">{t('table.beneficiary')}</th>
                <th className="px-3 py-2">{t('dispensing.staff')}</th>
                <th className="px-3 py-2">{t('table.medicines')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="px-3 py-2">
                    <Link
                      href={`/pharmacy/dispensing/${row.id}`}
                      className="text-primary hover:underline"
                    >
                      {row.dispensingNumber ?? row.recordNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {String(row.dispensedAt).replace('T', ' ').slice(0, 16)}
                  </td>
                  <td className="px-3 py-2">
                    {row.beneficiary?.fullName ??
                      row.beneficiary?.name ??
                      row.beneficiary?.beneficiaryNumber ??
                      dash}
                  </td>
                  <td className="px-3 py-2">
                    {row.dispensedBy
                      ? `${row.dispensedBy.firstName ?? ''} ${row.dispensedBy.lastName ?? ''}`.trim()
                      : dash}
                  </td>
                  <td className="px-3 py-2">
                    {(row.medicines ?? [])
                      .map((med) => `${med.medicineName} ×${med.quantity}`)
                      .join(', ') || dash}
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
