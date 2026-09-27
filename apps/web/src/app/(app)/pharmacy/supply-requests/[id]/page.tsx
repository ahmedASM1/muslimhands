'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiRequest } from '@/lib/api';
import { useI18n } from '@/i18n';

interface SupplyRequest {
  id: string;
  requestNumber: string;
  status: string;
  notes?: string | null;
  rejectionReason?: string | null;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  warehouse?: { name: string };
  pharmacy?: { name: string };
  createdBy?: { firstName: string; lastName: string };
  reviewedBy?: { firstName: string; lastName: string } | null;
  items: Array<{
    id: string;
    requestedQty: number;
    approvedQty?: number | null;
    fulfilledQty?: number;
    notes?: string | null;
    medicine?: {
      name: string;
      unit?: { code: string };
      category?: { itemType?: string | null };
    };
  }>;
  transfers?: Array<{ id: string; transferNumber: string; status: string }>;
}

export default function PharmacySupplyRequestDetailPage() {
  const { t } = useI18n();
  const dash = t('common.emDash');
  const params = useParams<{ id: string }>();
  const query = useQuery({
    queryKey: ['supply-request', params.id],
    queryFn: () => apiRequest<SupplyRequest>(`/supply-requests/${params.id}`),
  });

  const row = query.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          {row ? row.requestNumber : t('warehouse.supplyRequestFallback')}
        </h1>
        <Button asChild variant="outline">
          <Link href="/pharmacy/supply-requests">{t('common.back')}</Link>
        </Button>
      </div>
      {query.isLoading ? <p className="text-sm text-muted-foreground">{t('common.loading')}</p> : null}
      {query.error ? <p className="text-sm text-destructive">{(query.error as Error).message}</p> : null}
      {row ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {t('supply.details')} <Badge>{row.status}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm md:grid-cols-2">
              <p>
                {t('supply.warehouseLabel')} {row.warehouse?.name ?? dash}
              </p>
              <p>
                {t('supply.pharmacyLabel')} {row.pharmacy?.name ?? dash}
              </p>
              <p>
                {t('supply.createdBy')}{' '}
                {row.createdBy ? `${row.createdBy.firstName} ${row.createdBy.lastName}` : dash}
              </p>
              <p>
                {t('supply.submitted')}{' '}
                {row.submittedAt ? String(row.submittedAt).replace('T', ' ').slice(0, 16) : dash}
              </p>
              <p>
                {t('supply.reviewed')}{' '}
                {row.reviewedAt ? String(row.reviewedAt).replace('T', ' ').slice(0, 16) : dash}
              </p>
              <p>
                {t('warehouse.notesLabel')} {row.notes ?? dash}
              </p>
              {row.rejectionReason ? (
                <p className="md:col-span-2 text-destructive">
                  {t('supply.rejectionReasonLabel')} {row.rejectionReason}
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
                    <th className="px-3 py-2">{t('table.notes')}</th>
                  </tr>
                </thead>
                <tbody>
                  {row.items.map((item) => {
                    const itemType = item.medicine?.category?.itemType;
                    const typeLabel =
                      itemType === 'MEDICAL_SUPPLY'
                        ? t('catalogTypes.MEDICAL_SUPPLY')
                        : t('catalogTypes.MEDICINE');
                    return (
                      <tr key={item.id} className="border-t">
                        <td className="px-3 py-2">{typeLabel}</td>
                        <td className="px-3 py-2">{item.medicine?.name}</td>
                        <td className="px-3 py-2">{item.requestedQty}</td>
                        <td className="px-3 py-2">{item.approvedQty ?? dash}</td>
                        <td className="px-3 py-2">{item.fulfilledQty ?? 0}</td>
                        <td className="px-3 py-2">{item.notes ?? dash}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
          {(row.transfers?.length ?? 0) > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>{t('supply.linkedTransfers')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {row.transfers!.map((transfer) => (
                  <div key={transfer.id} className="flex justify-between">
                    <span>{transfer.transferNumber}</span>
                    <Badge>{transfer.status}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
