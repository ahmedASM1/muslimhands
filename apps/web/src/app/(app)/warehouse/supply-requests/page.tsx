'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiList, apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { hasPermission } from '@/lib/permissions';
import { useToast } from '@/lib/toast';
import { useI18n } from '@/i18n';

interface SupplyRequest {
  id: string;
  requestNumber: string;
  status: string;
  notes?: string | null;
  rejectionReason?: string | null;
  pharmacy?: { id: string; name: string };
  warehouse?: { id: string; name: string };
  items: Array<{
    id: string;
    medicineId: string;
    requestedQty: number;
    approvedQty?: number | null;
    medicine?: { name: string; category?: { itemType?: string | null } };
  }>;
}

export default function WarehouseSupplyRequestsPage() {
  const { t } = useI18n();
  const dash = t('common.emDash');
  const { user } = useAuth();
  const toast = useToast();
  const client = useQueryClient();
  const canApprove = hasPermission(user, 'supply-request:approve') || hasPermission(user, 'supply-requests:approve');
  const canReject = hasPermission(user, 'supply-request:reject') || hasPermission(user, 'supply-requests:reject');
  const canTransfer = hasPermission(user, 'transfer:create') || hasPermission(user, 'transfers:create');

  const [status, setStatus] = useState('SUBMITTED');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [approvedQtys, setApprovedQtys] = useState<Record<string, string>>({});
  const [rejectReason, setRejectReason] = useState('');

  const params = useMemo(() => {
    const query = new URLSearchParams({ limit: '50' });
    if (status) query.set('status', status);
    if (search.trim()) query.set('search', search.trim());
    return query.toString();
  }, [status, search]);

  const list = useQuery({
    queryKey: ['warehouse-supply-requests', params],
    queryFn: () => apiList<SupplyRequest>(`/supply-requests?${params}`),
  });

  const detail = useQuery({
    queryKey: ['warehouse-supply-request', selectedId],
    queryFn: () => apiRequest<SupplyRequest>(`/supply-requests/${selectedId}`),
    enabled: Boolean(selectedId),
  });

  const approve = useMutation({
    mutationFn: () => {
      const items = Object.entries(approvedQtys).map(([id, qty]) => ({
        id,
        approvedQty: Number(qty),
      }));
      return apiRequest(`/supply-requests/${selectedId}/approve`, {
        method: 'POST',
        body: { items },
      });
    },
    onSuccess: async () => {
      toast.push(t('toasts.requestApproved'));
      await client.invalidateQueries({ queryKey: ['warehouse-supply-requests'] });
      await client.invalidateQueries({ queryKey: ['warehouse-supply-request'] });
    },
    onError: (error: Error) => toast.push(error.message, 'error'),
  });

  const reject = useMutation({
    mutationFn: () =>
      apiRequest(`/supply-requests/${selectedId}/reject`, {
        method: 'POST',
        body: { rejectionReason: rejectReason },
      }),
    onSuccess: async () => {
      toast.push(t('toasts.requestRejected'));
      setRejectReason('');
      await client.invalidateQueries({ queryKey: ['warehouse-supply-requests'] });
      await client.invalidateQueries({ queryKey: ['warehouse-supply-request'] });
    },
    onError: (error: Error) => toast.push(error.message, 'error'),
  });

  function openReview(row: SupplyRequest) {
    setSelectedId(row.id);
    const qtys: Record<string, string> = {};
    for (const item of row.items) {
      qtys[item.id] = String(item.approvedQty ?? item.requestedQty);
    }
    setApprovedQtys(qtys);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t('warehouse.incomingSupplyTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('warehouse.incomingSupplySubtitle')}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          className="max-w-xs"
          placeholder={t('filters.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('filters.all')}</option>
          {['SUBMITTED', 'APPROVED', 'REJECTED', 'FULFILLED', 'PARTIALLY_FULFILLED', 'DRAFT', 'CANCELLED'].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">{t('table.number')}</th>
              <th className="px-3 py-2">{t('table.pharmacy')}</th>
              <th className="px-3 py-2">{t('table.status')}</th>
              <th className="px-3 py-2">{t('table.items')}</th>
              <th className="px-3 py-2">{t('table.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.items ?? []).map((row) => (
              <tr key={row.id} className="border-t">
                <td className="px-3 py-2 font-medium">{row.requestNumber}</td>
                <td className="px-3 py-2">{row.pharmacy?.name}</td>
                <td className="px-3 py-2"><Badge>{row.status}</Badge></td>
                <td className="px-3 py-2">{row.items.length}</td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => openReview(row)}>
                      {t('actions.review')}
                    </Button>
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/warehouse/supply-requests/${row.id}`}>{t('actions.open')}</Link>
                    </Button>
                    {row.status === 'APPROVED' && canTransfer ? (
                      <Button size="sm" asChild>
                        <Link href={`/warehouse/transfers?fromRequest=${row.id}`}>
                          {t('actions.createTransfer')}
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedId && detail.data ? (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between">
            <div>
              <CardTitle>{detail.data.requestNumber}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {detail.data.pharmacy?.name} · <Badge>{detail.data.status}</Badge>
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setSelectedId(null)}>
              {t('common.close')}
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2">{t('dispensing.category')}</th>
                  <th className="px-3 py-2">{t('table.items')}</th>
                  <th className="px-3 py-2">{t('supply.requested')}</th>
                  <th className="px-3 py-2">{t('warehouse.approvedQty')}</th>
                </tr>
              </thead>
              <tbody>
                {detail.data.items.map((item) => (
                  <tr key={item.id} className="border-t">
                    <td className="px-3 py-2">
                      {item.medicine?.category?.itemType === 'MEDICAL_SUPPLY'
                        ? t('catalogTypes.MEDICAL_SUPPLY')
                        : t('catalogTypes.MEDICINE')}
                    </td>
                    <td className="px-3 py-2">{item.medicine?.name}</td>
                    <td className="px-3 py-2">{item.requestedQty}</td>
                    <td className="px-3 py-2">
                      {detail.data.status === 'SUBMITTED' && canApprove ? (
                        <Input
                          type="number"
                          min={0}
                          max={item.requestedQty}
                          className="max-w-[8rem]"
                          value={approvedQtys[item.id] ?? String(item.requestedQty)}
                          onChange={(e) =>
                            setApprovedQtys((prev) => ({ ...prev, [item.id]: e.target.value }))
                          }
                        />
                      ) : (
                        item.approvedQty ?? dash
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {detail.data.status === 'SUBMITTED' ? (
              <div className="flex flex-col gap-3">
                {canApprove ? (
                  <Button onClick={() => approve.mutate()} disabled={approve.isPending}>
                    {t('actions.approveRequest')}
                  </Button>
                ) : null}
                {canReject ? (
                  <div className="grid max-w-lg gap-2">
                    <Label>{t('warehouse.rejectionReason')}</Label>
                    <Input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                    <Button
                      variant="destructive"
                      onClick={() => reject.mutate()}
                      disabled={reject.isPending || rejectReason.trim().length < 3}
                    >
                      {t('actions.reject')}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {detail.data.rejectionReason ? (
              <p className="text-sm text-destructive">
                {t('warehouse.rejectionPrefix')} {detail.data.rejectionReason}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
