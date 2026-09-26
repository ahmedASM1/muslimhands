'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge, StatusTimeline } from '@/components/status-badge';
import { useI18n } from '@/i18n';
import { apiRequest } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useAuth } from '@/lib/auth-context';
import { hasPermission } from '@/lib/permissions';
import { useToast } from '@/lib/toast';

interface Transfer {
  id: string;
  transferNumber: string;
  status: string;
  notes?: string | null;
  preparedAt?: string | null;
  dispatchedAt?: string | null;
  receivedAt?: string | null;
  pharmacy?: { name: string };
  warehouse?: { name: string };
  items: Array<{
    id: string;
    quantity: number;
    medicine?: { name: string };
    batch?: { batchNumber: string; expiryDate: string };
  }>;
}

export default function WarehouseTransferDetailPage() {
  const { t } = useI18n();
  const params = useParams<{ id: string }>();
  const { user } = useAuth();
  const toast = useToast();
  const client = useQueryClient();
  const canPrepare = hasPermission(user, 'transfer:prepare') || hasPermission(user, 'transfers:prepare');
  const canShip = hasPermission(user, 'transfer:ship') || hasPermission(user, 'transfers:dispatch');
  const canCancel = hasPermission(user, 'transfer:cancel');
  const dash = t('common.emDash');

  const query = useQuery({
    queryKey: ['transfer-detail', params.id],
    queryFn: () => apiRequest<Transfer>(`/transfers/${params.id}`),
  });

  const action = useMutation({
    mutationFn: (path: string) => apiRequest(`/transfers/${params.id}/${path}`, { method: 'POST' }),
    onSuccess: async (_, path) => {
      toast.push(t('toasts.transferActionCompleted', { action: path }));
      await client.invalidateQueries({ queryKey: ['transfer-detail'] });
      await client.invalidateQueries({ queryKey: ['transfers'] });
    },
    onError: (error: Error) => toast.push(error.message, 'error'),
  });

  const row = query.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{row?.transferNumber ?? t('warehouse.transferFallback')}</h1>
        <Button asChild variant="outline">
          <Link href="/warehouse/transfers">{t('common.back')}</Link>
        </Button>
      </div>
      {row ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {row.pharmacy?.name} <StatusBadge status={row.status} />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <StatusTimeline
                steps={['CREATED', 'PREPARED', 'SHIPPED', 'RECEIVED']}
                current={row.status === 'IN_TRANSIT' ? 'SHIPPED' : row.status}
              />
              <div className="grid gap-2 md:grid-cols-2">
                <p>
                  {t('table.warehouse')}: {row.warehouse?.name}
                </p>
                <p>
                  {t('table.notes')}: {row.notes ?? dash}
                </p>
                <p>
                  {t('warehouse.preparedLabel')} {formatDateTime(row.preparedAt)}
                </p>
                <p>
                  {t('warehouse.shippedLabel')} {formatDateTime(row.dispatchedAt)}
                </p>
                <p>
                  {t('warehouse.receivedLabel')} {formatDateTime(row.receivedAt)}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('warehouse.items')}</CardTitle>
            </CardHeader>
            <CardContent>
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
                  {row.items.map((item) => (
                    <tr key={item.id} className="border-t">
                      <td className="px-3 py-2">{item.medicine?.name}</td>
                      <td className="px-3 py-2">{item.batch?.batchNumber}</td>
                      <td className="px-3 py-2">{item.batch?.expiryDate?.slice(0, 10)}</td>
                      <td className="px-3 py-2">{item.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
          <div className="flex flex-wrap gap-2">
            {row.status === 'DRAFT' && canPrepare ? (
              <Button onClick={() => action.mutate('prepare')}>{t('actions.prepare')}</Button>
            ) : null}
            {row.status === 'PREPARED' && canShip ? (
              <Button
                onClick={() => {
                  if (window.confirm(t('confirm.shipTransferShort'))) action.mutate('ship');
                }}
              >
                {t('actions.ship')}
              </Button>
            ) : null}
            {(row.status === 'DRAFT' || row.status === 'PREPARED') && canCancel ? (
              <Button variant="destructive" onClick={() => action.mutate('cancel')}>
                {t('actions.cancel')}
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
