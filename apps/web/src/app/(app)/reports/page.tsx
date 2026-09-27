'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/i18n';
import { apiRequest } from '@/lib/api';
import { hasPermission, useAuth } from '@/lib/auth-context';
import { reportsHomePath } from '@/lib/reports-home';

interface Overview {
  currentStock: Record<string, number>;
  periodActivity: Record<string, number | string>;
  dateSemantics: { timezone: string; period: string };
}

const LINKS = [
  { href: '/reports/inventory', labelKey: 'reports.links.inventory', permission: 'report:view' },
  { href: '/reports/stock-movements', labelKey: 'reports.links.stockMovements', permission: 'report:view' },
  { href: '/reports/receipts', labelKey: 'reports.links.receiving', permission: 'reports:warehouse' },
  { href: '/reports/supply-requests', labelKey: 'reports.links.supplyRequests', permission: 'report:view' },
  { href: '/reports/transfers', labelKey: 'reports.links.transfers', permission: 'report:view' },
  { href: '/reports/dispensing', labelKey: 'reports.links.dispensing', permission: 'reports:dispensing' },
  { href: '/reports/beneficiaries', labelKey: 'reports.links.beneficiaries', permission: 'beneficiaries:read' },
  { href: '/reports/expiry', labelKey: 'reports.links.expiry', permission: 'report:view' },
  { href: '/reports/low-stock', labelKey: 'reports.links.lowStock', permission: 'report:view' },
] as const;

const METRIC_KEYS: Record<string, string> = {
  expiredStockCount: 'reports.metrics.expiredStockCount',
  expiringSoonStockCount: 'reports.metrics.expiringSoonStockCount',
  lowStockMedicineCount: 'reports.metrics.lowStockMedicineCount',
  pharmacyStockUnits: 'reports.metrics.pharmacyStockUnits',
  warehouseStockUnits: 'reports.metrics.warehouseStockUnits',
  activeMedicines: 'reports.metrics.activeMedicines',
  shippedAwaitingReceipt: 'reports.metrics.shippedAwaitingReceipt',
  activeTransfers: 'reports.metrics.activeTransfers',
  pendingSupplyRequests: 'reports.metrics.pendingSupplyRequests',
  uniqueBeneficiaries: 'reports.metrics.uniqueBeneficiaries',
  dispensingCount: 'reports.metrics.dispensingCount',
};

function metricTitle(key: string, t: (k: string) => string) {
  const i18nKey = METRIC_KEYS[key];
  if (i18nKey) {
    const label = t(i18nKey);
    if (label !== i18nKey) return label;
  }
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

export default function ReportsHubPage() {
  const { t } = useI18n();
  const { user, loading } = useAuth();
  const router = useRouter();
  const [period, setPeriod] = useState('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [customMode, setCustomMode] = useState(false);

  useEffect(() => {
    if (loading || !user) return;
    const home = reportsHomePath(user);
    if (home !== '/reports') {
      router.replace(home);
    }
  }, [loading, user, router]);

  const params = new URLSearchParams();
  if (customMode && dateFrom && dateTo) {
    params.set('dateFrom', dateFrom);
    params.set('dateTo', dateTo);
  } else {
    params.set('period', period);
  }

  const scopedAway = Boolean(user && reportsHomePath(user) !== '/reports');

  const overview = useQuery({
    queryKey: ['reports-overview', params.toString()],
    enabled: !loading && !scopedAway,
    queryFn: () => apiRequest<Overview>(`/reports/overview?${params.toString()}`),
  });

  const visibleLinks = LINKS.filter(
    (link) => !link.permission || hasPermission(user, link.permission),
  );

  if (loading || scopedAway) {
    return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  }

  const periodLabel = String(overview.data?.periodActivity?.periodLabel ?? period);
  const periodLabelText =
    periodLabel.toUpperCase() === 'ALL'
      ? t('reports.scopeAll')
      : periodLabel.toUpperCase() === 'TODAY'
        ? t('reports.scopeCurrent')
        : periodLabel;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('reports.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('reports.hubSubtitle')}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            { id: 'ALL', label: t('reports.scopeAll') },
            { id: 'TODAY', label: t('reports.scopeCurrent') },
            { id: '7D', label: t('reports.period7d') },
            { id: '30D', label: t('reports.period30d') },
          ] as const
        ).map((item) => (
          <Button
            key={item.id}
            variant={period === item.id && !customMode ? 'default' : 'outline'}
            onClick={() => {
              setPeriod(item.id);
              setCustomMode(false);
              setDateFrom('');
              setDateTo('');
            }}
          >
            {item.label}
          </Button>
        ))}
        <Button
          type="button"
          variant={customMode ? 'default' : 'outline'}
          onClick={() => {
            setCustomMode(true);
            setPeriod('CUSTOM');
          }}
        >
          {t('reports.scopeCustom')}
        </Button>
        {customMode ? (
          <>
            <Input type="date" className="max-w-[160px]" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <Input type="date" className="max-w-[160px]" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </>
        ) : null}
      </div>

      {overview.isLoading ? <p className="text-sm text-muted-foreground">{t('reports.loadingOverview')}</p> : null}
      {overview.error ? (
        <p className="text-sm text-destructive">{(overview.error as Error).message}</p>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t('reports.currentStock')}</h2>
        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
          {Object.entries(overview.data?.currentStock ?? {}).map(([key, value]) => (
            <Card key={key}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">{metricTitle(key, t)}</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold">{value}</CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">
          {t('reports.periodActivity')}
          {periodLabelText ? (
            <span className="ms-2 text-sm font-normal text-muted-foreground">({periodLabelText})</span>
          ) : null}
        </h2>
        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
          {Object.entries(overview.data?.periodActivity ?? {})
            .filter(([key]) => key !== 'periodLabel')
            .map(([key, value]) => (
              <Card key={key}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">{metricTitle(key, t)}</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-semibold">{value}</CardContent>
              </Card>
            ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t('reports.catalog')}</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {visibleLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-lg border px-4 py-3 text-sm font-medium hover:bg-muted/40"
            >
              {t(link.labelKey)}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
