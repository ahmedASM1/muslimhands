'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useI18n } from '@/i18n';
import { apiRequest, ApiClientError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { StatusBadge } from '@/components/status-badge';

interface PharmacyDashboardData {
  cards: Record<string, number>;
  recentTransfers: Array<{ id: string; transferNumber: string; status: string }>;
  recentDispensing: Array<{ id: string; recordNumber: string }>;
}

function normalizeDashboard(data: PharmacyDashboardData | undefined) {
  return {
    cards: data?.cards ?? {},
    recentTransfers: data?.recentTransfers ?? [],
    recentDispensing: data?.recentDispensing ?? [],
  };
}

function cardLabel(t: (key: string) => string, key: string) {
  const mapped = t(`dashboard.${key}`);
  if (mapped !== `dashboard.${key}`) return mapped;
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

export default function PharmacyPage() {
  const { t } = useI18n();
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace(`/pharmacies/${slug}/login`);
      return;
    }
    const isPharmacyStaff = user.roles.some((role) => role.startsWith('PHARMACY'));
    const isAdmin = user.roles.includes('SUPER_ADMIN' as (typeof user.roles)[number]);
    if (isPharmacyStaff && user.pharmacySlug && user.pharmacySlug !== slug) {
      router.replace(`/pharmacies/${user.pharmacySlug}`);
    }
    if (isPharmacyStaff && !user.pharmacySlug && !isAdmin) {
      router.replace('/login');
    }
  }, [authLoading, user, slug, router]);

  const pharmacy = useQuery({
    queryKey: ['pharmacy', slug],
    queryFn: () =>
      apiRequest<{
        name: string;
        code: string;
        location?: string;
        status: string;
        url: string;
        loginUrl?: string;
      }>(`/pharmacies/slug/${slug}`),
    enabled: Boolean(user),
  });
  const dashboard = useQuery({
    queryKey: ['dashboard', slug],
    queryFn: () => apiRequest<PharmacyDashboardData>('/dashboard'),
    enabled: Boolean(pharmacy.data),
  });

  if (authLoading || !user) {
    return <p className="text-muted-foreground">{t('auth.loadingPharmacyPortal')}</p>;
  }

  if (pharmacy.isLoading) return <p className="text-muted-foreground">{t('auth.loadingPharmacy')}</p>;
  if (pharmacy.isError) {
    const status = pharmacy.error instanceof ApiClientError ? pharmacy.error.status : undefined;
    return (
      <p className="text-destructive">
        {status === 401 || status === 403 ? t('auth.pharmacyAccessDenied') : t('auth.pharmacyLoadFailed')}
      </p>
    );
  }

  const { cards, recentDispensing, recentTransfers } = normalizeDashboard(dashboard.data);
  const showEmptyActivity =
    dashboard.isSuccess && recentDispensing.length === 0 && recentTransfers.length === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{pharmacy.data?.name}</h1>
        <p className="text-sm text-muted-foreground">
          <span dir="ltr">{pharmacy.data?.code}</span>
          {' · '}
          {pharmacy.data?.location ?? t('auth.noLocation')}
          {' · '}
          <StatusBadge status={pharmacy.data?.status ?? 'ACTIVE'} />
        </p>
      </div>

      {dashboard.isLoading ? <p className="text-sm text-muted-foreground">{t('auth.loadingActivity')}</p> : null}

      {dashboard.isError ? (
        <p className="text-sm text-destructive">
          {dashboard.error instanceof ApiClientError &&
          (dashboard.error.status === 401 || dashboard.error.status === 403)
            ? t('auth.pharmacyDashboardUnauthorized')
            : t('auth.pharmacyDashboardLoadFailed')}
        </p>
      ) : null}

      {!dashboard.isError ? (
        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-4">
          {Object.entries(cards).map(([key, value]) => (
            <Card key={key}>
              <CardHeader>
                <CardTitle className="text-sm">{cardLabel(t, key)}</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold" dir="ltr">
                {value}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {showEmptyActivity ? (
        <p className="text-sm text-muted-foreground">{t('auth.noPharmacyActivity')}</p>
      ) : null}

      {recentDispensing.length > 0 ? (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">{t('auth.recentDispensing')}</h2>
          <ul className="space-y-1 text-sm">
            {recentDispensing.map((row) => (
              <li key={row.id} dir="ltr">
                {row.recordNumber}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {recentTransfers.length > 0 ? (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">{t('auth.recentTransfers')}</h2>
          <ul className="space-y-1 text-sm">
            {recentTransfers.map((row) => (
              <li key={row.id}>
                <span dir="ltr">{row.transferNumber}</span> · <StatusBadge status={row.status} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
