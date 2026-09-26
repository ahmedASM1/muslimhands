'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/api';
import { useI18n } from '@/i18n';

interface DispensingDetail {
  id: string;
  dispensingNumber: string;
  dispensedAt: string;
  notes?: string | null;
  status: string;
  pharmacy?: { name: string; code: string };
  beneficiary?: {
    id: string;
    beneficiaryNumber: string;
    fullName?: string | null;
    phone?: string | null;
  };
  dispensedBy?: { firstName?: string; lastName?: string };
  medicines: Array<{
    medicineName: string;
    quantity: number;
    estimatedUnitValue: number | null;
    estimatedValue: number | null;
    batches: Array<{ batchNumber: string; quantity: number; expiryDate: string }>;
  }>;
  items: Array<{
    medicineName: string;
    batchNumber: string;
    quantity: number;
    estimatedUnitValue: number | null;
    estimatedValue: number | null;
  }>;
}

export default function DispensingDetailPage() {
  const { t } = useI18n();
  const dash = t('common.emDash');
  const params = useParams<{ id: string }>();
  const query = useQuery({
    queryKey: ['dispensing', params.id],
    queryFn: () => apiRequest<DispensingDetail>(`/dispensings/${params.id}`),
  });

  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  }
  if (query.error || !query.data) {
    return (
      <p className="text-sm text-destructive">
        {(query.error as Error)?.message ?? t('dispensing.recordNotFound')}
      </p>
    );
  }

  const row = query.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{row.status}</p>
          <h1 className="text-2xl font-semibold">{row.dispensingNumber}</h1>
          <p className="text-sm text-muted-foreground">
            {String(row.dispensedAt).replace('T', ' ').slice(0, 16)}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/pharmacy/dispensing-history">{t('actions.backToHistory')}</Link>
        </Button>
      </div>

      <dl className="grid max-w-3xl gap-3 text-sm md:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">{t('table.beneficiary')}</dt>
          <dd>
            {row.beneficiary ? (
              <Link
                href={`/pharmacy/beneficiaries/${row.beneficiary.id}`}
                className="text-primary hover:underline"
              >
                {row.beneficiary.fullName} ({row.beneficiary.beneficiaryNumber})
              </Link>
            ) : (
              dash
            )}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('table.pharmacy')}</dt>
          <dd>
            {row.pharmacy?.name} ({row.pharmacy?.code})
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('dispensing.staff')}</dt>
          <dd>
            {row.dispensedBy
              ? `${row.dispensedBy.firstName ?? ''} ${row.dispensedBy.lastName ?? ''}`.trim()
              : dash}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('table.notes')}</dt>
          <dd>{row.notes ?? dash}</dd>
        </div>
      </dl>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t('dispensing.medicinesFefo')}</h2>
        {(row.medicines ?? []).map((med) => (
          <div key={med.medicineName} className="rounded-lg border p-4 text-sm">
            <div className="font-medium">
              {med.medicineName} {dash} {med.quantity}
              {med.estimatedValue != null ? (
                <span className="ml-2 font-normal text-muted-foreground">
                  {t('dispensing.estimatedValue', { value: med.estimatedValue.toFixed(2) })}
                </span>
              ) : null}
            </div>
            <ul className="mt-2 list-disc pl-5 text-muted-foreground">
              {med.batches.map((batch) => (
                <li key={`${batch.batchNumber}-${batch.quantity}`}>
                  {t('dispensing.batchExpires', {
                    batchNumber: batch.batchNumber,
                    quantity: batch.quantity,
                    date: String(batch.expiryDate).slice(0, 10),
                  })}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
