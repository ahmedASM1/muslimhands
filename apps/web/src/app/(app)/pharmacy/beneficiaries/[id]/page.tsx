'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiList, apiRequest } from '@/lib/api';
import { useI18n } from '@/i18n';

interface Beneficiary {
  id: string;
  beneficiaryNumber: string;
  fullName?: string | null;
  phone?: string | null;
  externalReference?: string | null;
  address?: string | null;
  notes?: string | null;
  status: string;
  gender?: string;
  dateOfBirth?: string | null;
}

interface HistoryRow {
  id: string;
  dispensingNumber: string;
  dispensedAt: string;
  pharmacy?: { name: string };
  items: Array<{ medicineName: string; quantity: number; batchNumber: string }>;
}

export default function BeneficiaryDetailPage() {
  const { t } = useI18n();
  const dash = t('common.emDash');
  const params = useParams<{ id: string }>();
  const id = params.id;
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [externalReference, setExternalReference] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');

  const beneficiary = useQuery({
    queryKey: ['beneficiary', id],
    queryFn: () => apiRequest<Beneficiary>(`/beneficiaries/${id}`),
  });

  const history = useQuery({
    queryKey: ['beneficiary-history', id],
    queryFn: () =>
      apiList<HistoryRow>(`/beneficiaries/${id}/dispensing-history?limit=20`),
  });

  useEffect(() => {
    const data = beneficiary.data;
    if (!data) return;
    setFullName(data.fullName ?? '');
    setPhone(data.phone ?? '');
    setExternalReference(data.externalReference ?? '');
    setAddress(data.address ?? '');
    setNotes(data.notes ?? '');
  }, [beneficiary.data]);

  const save = useMutation({
    mutationFn: () =>
      apiRequest(`/beneficiaries/${id}`, {
        method: 'PATCH',
        body: {
          fullName,
          phone: phone || null,
          externalReference: externalReference || null,
          address: address || null,
          notes: notes || null,
        },
      }),
    onSuccess: () => {
      setEditing(false);
      client.invalidateQueries({ queryKey: ['beneficiary', id] });
      client.invalidateQueries({ queryKey: ['beneficiaries'] });
    },
  });

  const toggle = useMutation({
    mutationFn: (activate: boolean) =>
      apiRequest(`/beneficiaries/${id}/${activate ? 'activate' : 'deactivate'}`, {
        method: 'POST',
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['beneficiary', id] }),
  });

  if (beneficiary.isLoading) {
    return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  }
  if (beneficiary.error || !beneficiary.data) {
    return (
      <p className="text-sm text-destructive">
        {(beneficiary.error as Error)?.message ?? t('beneficiaries.notFound')}
      </p>
    );
  }

  const row = beneficiary.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{row.beneficiaryNumber}</p>
          <h1 className="text-2xl font-semibold">{row.fullName}</h1>
          <p className="text-sm text-muted-foreground">
            {t('beneficiaries.statusLabel')} {row.status}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/pharmacy/beneficiaries">{t('common.back')}</Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => toggle.mutate(row.status !== 'ACTIVE')}
          >
            {row.status === 'ACTIVE' ? t('actions.deactivate') : t('actions.activate')}
          </Button>
          <Button type="button" onClick={() => setEditing((v) => !v)}>
            {editing ? t('common.cancel') : t('common.edit')}
          </Button>
        </div>
      </div>

      {editing ? (
        <form
          className="grid max-w-2xl gap-3 rounded-lg border p-4 md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          <Input
            placeholder={t('beneficiaries.phone')}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <Input
            placeholder={t('beneficiaries.externalReference')}
            value={externalReference}
            onChange={(e) => setExternalReference(e.target.value)}
          />
          <Input
            placeholder={t('beneficiaries.address')}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <Input
            className="md:col-span-2"
            placeholder={t('table.notes')}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          {save.error ? (
            <p className="text-sm text-destructive md:col-span-2">
              {(save.error as Error).message}
            </p>
          ) : null}
          <Button type="submit" disabled={save.isPending} className="md:col-span-2">
            {t('common.saveChanges')}
          </Button>
        </form>
      ) : (
        <dl className="grid max-w-2xl gap-3 text-sm md:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">{t('beneficiaries.phone')}</dt>
            <dd>{row.phone ?? dash}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('beneficiaries.externalReference')}</dt>
            <dd>{row.externalReference ?? dash}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('beneficiaries.address')}</dt>
            <dd>{row.address ?? dash}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('table.notes')}</dt>
            <dd>{row.notes ?? dash}</dd>
          </div>
        </dl>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t('beneficiaries.dispensingHistory')}</h2>
        {(history.data?.items ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('beneficiaries.noDispensingRecords')}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2">{t('table.number')}</th>
                  <th className="px-3 py-2">{t('table.date')}</th>
                  <th className="px-3 py-2">{t('table.pharmacy')}</th>
                  <th className="px-3 py-2">{t('beneficiaries.items')}</th>
                </tr>
              </thead>
              <tbody>
                {(history.data?.items ?? []).map((item) => (
                  <tr key={item.id} className="border-t">
                    <td className="px-3 py-2">
                      <Link
                        href={`/pharmacy/dispensing/${item.id}`}
                        className="text-primary hover:underline"
                      >
                        {item.dispensingNumber}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      {String(item.dispensedAt).replace('T', ' ').slice(0, 16)}
                    </td>
                    <td className="px-3 py-2">{item.pharmacy?.name ?? dash}</td>
                    <td className="px-3 py-2">
                      {item.items
                        .map((row) => `${row.medicineName} ×${row.quantity}`)
                        .join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
