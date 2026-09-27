'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge, StatusTimeline } from '@/components/status-badge';
import { useI18n } from '@/i18n';
import { apiRequest } from '@/lib/api';

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
    fulfilledQty?: number;
    medicine?: { name: string; category?: { itemType?: string | null } };
  }>;
}

export default function WarehouseSupplyRequestDetailPage() {
  const { t } = useI18n();
  const params = useParams<{ id: string }>();
  const dash = t('common.emDash');
  const query = useQuery({
    queryKey: ['wh-sr', params.id],
    queryFn: () => apiRequest<SupplyRequest>(`/supply-requests/${params.id}`),
  });
  const row = query.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          {row?.requestNumber ?? t('warehouse.supplyRequestFallback')}
        </h1>
        <div className="flex gap-2">
          {row?.status === 'APPROVED' ? (
            <Button asChild>
              <Link href={`/warehouse/transfers?fromRequest=${row.id}`}>{t('actions.createTransfer')}</Link>
            </Button>
          ) : null}
          <Button asChild variant="outline">
            <Link href="/warehouse/supply-requests">{t('common.back')}</Link>
          </Button>
        </div>
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
                steps={['DRAFT', 'SUBMITTED', 'APPROVED', 'FULFILLED']}
                current={
                  row.status === 'REJECTED' || row.status === 'CANCELLED'
                    ? 'SUBMITTED'
                    : row.status
                }
              />
              <p>
                {t('table.notes')}: {row.notes ?? dash}
              </p>
              {row.rejectionReason ? (
                <p className="text-destructive">
                  {t('warehouse.rejectionPrefix')} {row.rejectionReason}
                </p>
              ) : null}
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
                    <th className="px-3 py-2">{t('dispensing.category')}</th>
                    <th className="px-3 py-2">{t('table.items')}</th>
                    <th className="px-3 py-2">{t('supply.requested')}</th>
                    <th className="px-3 py-2">{t('supply.approved')}</th>
                    <th className="px-3 py-2">{t('supply.fulfilled')}</th>
                  </tr>
                </thead>
                <tbody>
                  {row.items.map((item) => (
                    <tr key={item.id} className="border-t">
                      <td className="px-3 py-2">
                        {item.medicine?.category?.itemType === 'MEDICAL_SUPPLY'
                          ? t('catalogTypes.MEDICAL_SUPPLY')
                          : t('catalogTypes.MEDICINE')}
                      </td>
                      <td className="px-3 py-2">{item.medicine?.name}</td>
                      <td className="px-3 py-2">{item.requestedQty}</td>
                      <td className="px-3 py-2">{item.approvedQty ?? dash}</td>
                      <td className="px-3 py-2">{item.fulfilledQty ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
