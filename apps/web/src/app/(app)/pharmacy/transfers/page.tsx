'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/status-badge';
import { apiList, apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { hasPermission } from '@/lib/permissions';
import { useToast } from '@/lib/toast';
import { useI18n } from '@/i18n';

interface Transfer {
  id: string;
  transferNumber: string;
  status: string;
  dispatchedAt?: string | null;
  receivedAt?: string | null;
  warehouse?: { name: string };
  items: Array<{
    id: string;
    quantity: number;
    medicine?: { name: string };
    batch?: { batchNumber: string; expiryDate: string };
  }>;
}

const AWAITING_RECEIPT = 'AWAITING';
const RECEIVABLE = new Set(['SHIPPED', 'IN_TRANSIT']);

export default function PharmacyTransfersPage() {
  const { t } = useI18n();
  const dash = t('common.emDash');
  const { user } = useAuth();
  const toast = useToast();
  const client = useQueryClient();
  const canReceive = hasPermission(user, 'transfer:receive') || hasPermission(user, 'transfers:receive');
  /** Default: transfers ready for pharmacy receipt (SHIPPED + IN_TRANSIT). */
  const [status, setStatus] = useState(AWAITING_RECEIPT);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const params = useMemo(() => {
    const query = new URLSearchParams({ limit: '50' });
    // AWAITING is client-side; API only accepts a single status enum value.
    if (status && status !== AWAITING_RECEIPT) query.set('status', status);
    return query.toString();
  }, [status]);

  const transfers = useQuery({
    queryKey: ['pharmacy-transfers', params],
    queryFn: () => apiList<Transfer>(`/transfers?${params}`),
  });

  const rows = useMemo(() => {
    const items = transfers.data?.items ?? [];
    if (status === AWAITING_RECEIPT) {
      return items.filter((row) => RECEIVABLE.has(row.status));
    }
    return items;
  }, [transfers.data?.items, status]);

  const detail = useQuery({
    queryKey: ['pharmacy-transfer', selectedId],
    queryFn: () => apiRequest<Transfer>(`/transfers/${selectedId}`),
    enabled: Boolean(selectedId),
  });

  const receive = useMutation({
    mutationFn: (id: string) => apiRequest(`/transfers/${id}/receive`, { method: 'POST' }),
    onSuccess: async () => {
      toast.push(t('toasts.transferReceived'));
      setSelectedId(null);
      await client.invalidateQueries({ queryKey: ['pharmacy-transfers'] });
      await client.invalidateQueries({ queryKey: ['pharmacy-stock'] });
      await client.invalidateQueries({ queryKey: ['dashboard'] });
      await client.invalidateQueries({ queryKey: ['notifications-unread'] });
      await client.invalidateQueries({ queryKey: ['notifications-summary'] });
    },
    onError: (error: Error) => toast.push(error.message, 'error'),
  });

  function statusLabel(code: string) {
    const key = `status.${code}`;
    const label = t(key);
    return label === key ? code.replaceAll('_', ' ') : label;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t('transfer.incomingTitle')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('transfer.incomingSubtitle', {
            pharmacy: user?.pharmacy?.name ?? t('transfer.yourPharmacy'),
          })}
        </p>
      </div>

      <select
        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        aria-label={t('table.status')}
      >
        <option value={AWAITING_RECEIPT}>{t('transfer.awaitingReceipt')}</option>
        <option value="">{t('filters.all')}</option>
        <option value="SHIPPED">{statusLabel('SHIPPED')}</option>
        <option value="IN_TRANSIT">{statusLabel('IN_TRANSIT')}</option>
        <option value="RECEIVED">{statusLabel('RECEIVED')}</option>
      </select>

      <div className="overflow-x-auto rounded-md border">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">{t('table.number')}</th>
              <th className="px-3 py-2">{t('table.from')}</th>
              <th className="px-3 py-2">{t('table.status')}</th>
              <th className="px-3 py-2">{t('table.shipped')}</th>
              <th className="px-3 py-2">{t('table.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="px-3 py-2 font-medium">{row.transferNumber}</td>
                <td className="px-3 py-2">{row.warehouse?.name}</td>
                <td className="px-3 py-2">
                  <StatusBadge status={row.status} />
                </td>
                <td className="px-3 py-2">
                  {row.dispatchedAt ? String(row.dispatchedAt).replace('T', ' ').slice(0, 16) : dash}
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => setSelectedId(row.id)}>
                      {t('actions.view')}
                    </Button>
                    {RECEIVABLE.has(row.status) && canReceive ? (
                      <Button
                        size="sm"
                        onClick={() => {
                          if (window.confirm(t('confirm.receiveTransfer'))) {
                            receive.mutate(row.id);
                          }
                        }}
                      >
                        {t('actions.receive')}
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && !transfers.isLoading ? (
          <p className="p-6 text-sm text-muted-foreground">{t('transfer.noTransfersFilter')}</p>
        ) : null}
        {transfers.isLoading ? (
          <p className="p-6 text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : null}
        {transfers.error ? (
          <p className="p-6 text-sm text-destructive">{(transfers.error as Error).message}</p>
        ) : null}
      </div>

      {selectedId && detail.data ? (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between">
            <div>
              <CardTitle>{detail.data.transferNumber}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {t('transfer.fromWarehouse', { name: detail.data.warehouse?.name ?? dash })} ·{' '}
                <StatusBadge status={detail.data.status} />
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setSelectedId(null)}>
              {t('actions.close')}
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2">{t('table.medicine')}</th>
                  <th className="px-3 py-2">{t('table.batch')}</th>
                  <th className="px-3 py-2">{t('table.expiry')}</th>
                  <th className="px-3 py-2">{t('table.qty')}</th>
                </tr>
              </thead>
              <tbody>
                {detail.data.items.map((item) => (
                  <tr key={item.id} className="border-t">
                    <td className="px-3 py-2">{item.medicine?.name}</td>
                    <td className="px-3 py-2">{item.batch?.batchNumber}</td>
                    <td className="px-3 py-2">{item.batch?.expiryDate?.slice(0, 10)}</td>
                    <td className="px-3 py-2">{item.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {RECEIVABLE.has(detail.data.status) && canReceive ? (
              <Button onClick={() => receive.mutate(detail.data!.id)} disabled={receive.isPending}>
                {t('actions.receiveIntoStock')}
              </Button>
            ) : null}
            <Button asChild variant="outline" size="sm">
              <Link href="/pharmacy/stock">{t('actions.viewPharmacyStock')}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
