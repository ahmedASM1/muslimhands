'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  Boxes,
  ClipboardList,
  Package,
  Pill,
  UsersRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/empty-state';
import { CardGridSkeleton } from '@/components/skeleton';
import { StatusBadge } from '@/components/status-badge';
import { useI18n } from '@/i18n';
import { apiRequest } from '@/lib/api';
import { formatDateTime, formatQuantity } from '@/lib/format';
import { hasPermission } from '@/lib/permissions';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';

interface DashboardData {
  cards: Record<string, number>;
  recentTransfers?: Array<{
    id: string;
    transferNumber: string;
    status?: string;
    pharmacy?: { name: string };
    warehouse?: { name: string };
  }>;
  recentDispensing?: Array<{
    id: string;
    recordNumber: string;
    dispensingNumber?: string;
    beneficiaryNumber?: string;
    itemCount?: number;
  }>;
  recentReceipts?: Array<{
    id: string;
    receiptNumber: string;
    status: string;
    totalUnits?: number;
    createdAt?: string;
  }>;
  recentMovements?: Array<{
    id: string;
    movementType: string;
    quantity: number;
    occurredAt: string;
    medicine?: { name: string };
    batch?: { batchNumber: string };
  }>;
  recentRequests?: Array<{
    id: string;
    requestNumber: string;
    status: string;
    pharmacy?: { name: string };
  }>;
  emptyStock?: boolean;
  context?: { role: string };
}

function metricIcon(label: string) {
  const key = label.toLowerCase();
  if (key.includes('critical') || key.includes('alert')) return AlertTriangle;
  if (key.includes('beneficiar')) return UsersRound;
  if (key.includes('dispens')) return Activity;
  if (key.includes('transfer')) return ArrowRightLeft;
  if (key.includes('request')) return ClipboardList;
  if (key.includes('pharmacy')) return Package;
  if (key.includes('warehouse') || key.includes('stock')) return Boxes;
  if (key.includes('medicine')) return Pill;
  return Boxes;
}

function metricTone(label: string) {
  const key = label.toLowerCase();
  if (key.includes('critical')) return 'bg-red-50 text-red-600';
  if (key.includes('alert') || key.includes('expir') || key.includes('low')) return 'bg-amber-50 text-amber-700';
  if (key.includes('dispens')) return 'bg-orange-50 text-orange-600';
  if (key.includes('beneficiar')) return 'bg-sky-50 text-sky-700';
  if (key.includes('pharmacy')) return 'bg-violet-50 text-violet-700';
  if (key.includes('warehouse') || key.includes('stock')) return 'bg-emerald-50 text-emerald-700';
  return 'bg-primary/10 text-primary';
}

function MetricCard({
  label,
  value,
  href,
  hint,
}: {
  label: string;
  value: number | string;
  href?: string;
  hint?: string;
}) {
  const Icon = metricIcon(label);
  const content = (
    <Card
      className={cn(
        'rounded-xl border-border/70 shadow-card',
        href && 'transition-colors duration-150 hover:border-primary/30 hover:bg-accent/40',
      )}
    >
      <CardContent className="flex items-start gap-3 p-4">
        <div
          className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', metricTone(label))}
          aria-hidden="true"
        >
          <Icon className="h-5 w-5" strokeWidth={1.85} />
        </div>
        <div className="min-w-0">
          <p className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">{value}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{label}</p>
          {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
  if (!href) return content;
  return (
    <Link href={href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {content}
    </Link>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => apiRequest<DashboardData>('/dashboard'),
  });

  const alerts = useQuery({
    queryKey: ['notifications-summary'],
    queryFn: () =>
      apiRequest<{
        unread: number;
        critical: number;
        lowStock: number;
        expiringSoon: number;
        expiredStock: number;
        pendingSupplyRequests: number;
        transfersAwaitingReceipt: number;
      }>('/notifications/summary'),
  });

  const markAllRead = useMutation({
    mutationFn: () => apiRequest('/notifications/read-all', { method: 'POST' }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['notifications'] });
      client.invalidateQueries({ queryKey: ['notifications-unread'] });
      client.invalidateQueries({ queryKey: ['notifications-recent'] });
      client.invalidateQueries({ queryKey: ['notifications-summary'] });
    },
  });

  const cards = query.data?.cards ?? {};
  const role = query.data?.context?.role;
  const isWarehouse = role === 'warehouse' || role === 'admin';
  const isPharmacy = role === 'pharmacy';
  const isAdmin = role === 'admin';

  const canReceive = hasPermission(user, 'receipts:create') || hasPermission(user, 'receipt:create');
  const canTransfer = hasPermission(user, 'transfers:create') || hasPermission(user, 'transfer:create');
  const canReviewRequests =
    hasPermission(user, 'supply-requests:approve') || hasPermission(user, 'supply-request:approve');
  const canDispense = hasPermission(user, 'dispensing:create') || hasPermission(user, 'dispensing:read');
  const canCreateBeneficiary =
    hasPermission(user, 'beneficiaries:create') || hasPermission(user, 'beneficiary:create');
  const canCreateRequest =
    hasPermission(user, 'supply-requests:create') || hasPermission(user, 'supply-request:create');
  const canReceiveTransfer =
    hasPermission(user, 'transfers:receive') || hasPermission(user, 'transfer:receive');
  const canViewNotifications =
    hasPermission(user, 'notifications:read') || hasPermission(user, 'notification:view');

  const stockHref = isPharmacy ? '/pharmacy/stock' : '/warehouse/stock';
  const requestsHref = isPharmacy ? '/pharmacy/supply-requests' : '/warehouse/supply-requests';
  const transfersHref = isPharmacy ? '/pharmacy/transfers' : '/warehouse/transfers';

  const unreadAlerts = alerts.data?.unread ?? 0;
  const alertBannerTotal = alerts.data
    ? alerts.data.unread +
      alerts.data.critical +
      alerts.data.lowStock +
      alerts.data.expiringSoon +
      alerts.data.expiredStock +
      (isPharmacy ? alerts.data.transfersAwaitingReceipt : alerts.data.pendingSupplyRequests)
    : 0;
  const showAlertBanner = Boolean(alerts.data && canViewNotifications && alertBannerTotal > 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {user?.firstName
              ? t('dashboard.welcomeNamed', { name: user.firstName })
              : isPharmacy
                ? t('dashboard.pharmacyDashboard')
                : isAdmin
                  ? t('dashboard.adminOverview')
                  : t('dashboard.warehouseDashboard')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isPharmacy
              ? t('dashboard.pharmacySubtitle')
              : isAdmin
                ? t('dashboard.adminSubtitle')
                : t('dashboard.warehouseSubtitle')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isPharmacy && canDispense ? (
            <Button asChild>
              <Link href="/pharmacy/dispensing">{t('dashboard.dispenseMedicine')}</Link>
            </Button>
          ) : null}
          {isPharmacy && canCreateBeneficiary ? (
            <Button asChild variant="outline">
              <Link href="/pharmacy/beneficiaries">{t('dashboard.newBeneficiary')}</Link>
            </Button>
          ) : null}
          {isPharmacy && canCreateRequest ? (
            <Button asChild variant="outline">
              <Link href="/pharmacy/supply-requests">{t('dashboard.createRequest')}</Link>
            </Button>
          ) : null}
          {isPharmacy && canReceiveTransfer ? (
            <Button asChild variant="outline">
              <Link href="/pharmacy/transfers">{t('dashboard.receiveTransfer')}</Link>
            </Button>
          ) : null}
          {(isWarehouse || isAdmin) && canReceive ? (
            <Button asChild>
              <Link href="/warehouse/receipts">{t('dashboard.receiveStock')}</Link>
            </Button>
          ) : null}
          {(isWarehouse || isAdmin) && canTransfer ? (
            <Button asChild variant="outline">
              <Link href="/warehouse/transfers">{t('dashboard.createTransfer')}</Link>
            </Button>
          ) : null}
          {(isWarehouse || isAdmin) && canReviewRequests ? (
            <Button asChild variant="outline">
              <Link href="/warehouse/supply-requests">{t('dashboard.reviewRequests')}</Link>
            </Button>
          ) : null}
        </div>
      </div>

      {query.isLoading || alerts.isLoading ? <CardGridSkeleton count={6} /> : null}
      {query.error ? (
        <EmptyState
          title={t('common.unableToLoad')}
          description={(query.error as Error).message}
        />
      ) : null}

      {showAlertBanner ? (
        <section className="space-y-3" aria-label={t('dashboard.inventoryHealthAlerts')}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {t('dashboard.inventoryHealthAlerts')}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              {unreadAlerts > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={markAllRead.isPending}
                  onClick={() => markAllRead.mutate()}
                >
                  {markAllRead.isPending ? t('notifications.marking') : t('notifications.markAllRead')}
                </Button>
              ) : null}
              <Button asChild variant="ghost" size="sm">
                <Link href="/notifications">{t('common.viewAll')}</Link>
              </Button>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            <MetricCard label={t('dashboard.unreadAlerts')} value={formatQuantity(alerts.data!.unread)} href="/notifications" />
            <MetricCard
              label={t('dashboard.criticalAlerts')}
              value={formatQuantity(alerts.data!.critical)}
              href="/notifications?tab=unread"
              hint={t('dashboard.requiresAttention')}
            />
            <MetricCard
              label={t('dashboard.lowStock')}
              value={formatQuantity(alerts.data!.lowStock)}
              href="/reports/low-stock"
            />
            <MetricCard
              label={t('dashboard.expiringSoon')}
              value={formatQuantity(alerts.data!.expiringSoon)}
              href="/reports/expiry"
            />
            <MetricCard
              label={t('dashboard.expiredStock')}
              value={formatQuantity(alerts.data!.expiredStock)}
              href="/reports/expiry"
            />
            <MetricCard
              label={isPharmacy ? t('dashboard.incomingTransfers') : t('dashboard.pendingRequests')}
              value={formatQuantity(
                isPharmacy
                  ? alerts.data!.transfersAwaitingReceipt
                  : alerts.data!.pendingSupplyRequests,
              )}
              href={isPharmacy ? transfersHref : requestsHref}
            />
          </div>
        </section>
      ) : null}

      {query.data?.emptyStock ? (
        <EmptyState
          title={
            isPharmacy ? t('dashboard.emptyStockPharmacyTitle') : t('dashboard.emptyStockWarehouseTitle')
          }
          description={
            isPharmacy
              ? t('dashboard.emptyStockPharmacyDescription')
              : t('dashboard.emptyStockWarehouseDescription')
          }
          actionHref={isPharmacy ? '/pharmacy/transfers' : '/warehouse/receipts'}
          actionLabel={isPharmacy ? t('dashboard.receiveTransfer') : t('dashboard.receiveStock')}
        />
      ) : null}

      {Object.keys(cards).length > 0 ? (
        <section className="space-y-3" aria-label={t('dashboard.summary')}>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t('dashboard.summary')}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Object.entries(cards).map(([key, value]) => {
              const href =
                key.toLowerCase().includes('dispens')
                  ? '/pharmacy/dispensing-history'
                  : key.toLowerCase().includes('beneficiar')
                    ? '/pharmacy/beneficiaries'
                    : key.toLowerCase().includes('request')
                      ? requestsHref
                      : key.toLowerCase().includes('transfer')
                        ? transfersHref
                        : key.toLowerCase().includes('stock') || key.toLowerCase().includes('medicine')
                          ? stockHref
                          : undefined;
              return (
                <MetricCard
                  key={key}
                  label={key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}
                  value={formatQuantity(value)}
                  href={href}
                />
              );
            })}
          </div>
        </section>
      ) : null}

      {(isWarehouse || isAdmin) && query.data ? (
        <section className="grid gap-4 lg:grid-cols-2" aria-label={t('dashboard.warehouseOperations')}>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">{t('dashboard.pendingSupplyRequests')}</CardTitle>
              <Link href="/warehouse/supply-requests" className="text-sm text-primary hover:underline">
                {t('common.viewAll')}
              </Link>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {(query.data.recentRequests ?? []).map((item) => (
                <Link
                  key={item.id}
                  href={`/warehouse/supply-requests/${item.id}`}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
                >
                  <span>
                    {item.requestNumber}
                    {item.pharmacy?.name ? ` · ${item.pharmacy.name}` : ''}
                  </span>
                  <StatusBadge status={item.status} />
                </Link>
              ))}
              {(query.data.recentRequests?.length ?? 0) === 0 ? (
                <EmptyState title={t('dashboard.noSupplyRequests')} className="border-0 px-0 py-4" />
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">{t('dashboard.activeTransfers')}</CardTitle>
              <Link href="/warehouse/transfers" className="text-sm text-primary hover:underline">
                {t('common.viewAll')}
              </Link>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {(query.data.recentTransfers ?? []).map((item) => (
                <Link
                  key={item.id}
                  href={`/warehouse/transfers/${item.id}`}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
                >
                  <span>
                    {item.transferNumber}
                    {item.pharmacy?.name ? ` · ${item.pharmacy.name}` : ''}
                  </span>
                  <StatusBadge status={item.status ?? 'CREATED'} />
                </Link>
              ))}
              {(query.data.recentTransfers?.length ?? 0) === 0 ? (
                <EmptyState title={t('dashboard.noTransfers')} className="border-0 px-0 py-4" />
              ) : null}
            </CardContent>
          </Card>
          {(query.data.recentReceipts?.length || query.data.recentMovements?.length) ? (
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">{t('dashboard.recentActivity')}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 text-sm">
                  <p className="font-medium">{t('dashboard.receipts')}</p>
                  {(query.data.recentReceipts ?? []).slice(0, 5).map((item) => (
                    <div key={item.id} className="flex justify-between gap-2">
                      <span>{item.receiptNumber}</span>
                      <span className="text-muted-foreground">
                        {formatQuantity(item.totalUnits)} · {formatDateTime(item.createdAt)}
                      </span>
                    </div>
                  ))}
                  {(query.data.recentReceipts?.length ?? 0) === 0 ? (
                    <p className="text-muted-foreground">{t('dashboard.noRecentReceipts')}</p>
                  ) : null}
                </div>
                <div className="space-y-2 text-sm">
                  <p className="font-medium">{t('dashboard.stockMovements')}</p>
                  {(query.data.recentMovements ?? []).slice(0, 5).map((item) => (
                    <div key={item.id} className="flex justify-between gap-2">
                      <span>
                        {item.medicine?.name ?? item.movementType}
                        {item.batch?.batchNumber ? ` · ${item.batch.batchNumber}` : ''}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {formatQuantity(item.quantity)}
                      </span>
                    </div>
                  ))}
                  {(query.data.recentMovements?.length ?? 0) === 0 ? (
                    <p className="text-muted-foreground">{t('dashboard.noRecentMovements')}</p>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </section>
      ) : null}

      {isPharmacy && query.data ? (
        <section className="grid gap-4 lg:grid-cols-2" aria-label={t('dashboard.pharmacyOperations')}>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">{t('dashboard.supplyRequestsTitle')}</CardTitle>
              <Link href="/pharmacy/supply-requests" className="text-sm text-primary hover:underline">
                {t('common.viewAll')}
              </Link>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {(query.data.recentRequests ?? []).map((item) => (
                <Link
                  key={item.id}
                  href={`/pharmacy/supply-requests/${item.id}`}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
                >
                  <span>{item.requestNumber}</span>
                  <StatusBadge status={item.status} />
                </Link>
              ))}
              {(query.data.recentRequests?.length ?? 0) === 0 ? (
                <EmptyState
                  title={t('dashboard.noSupplyRequests')}
                  actionHref={canCreateRequest ? '/pharmacy/supply-requests' : undefined}
                  actionLabel={canCreateRequest ? t('dashboard.createRequest') : undefined}
                  className="border-0 px-0 py-4"
                />
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">{t('dashboard.incomingTransfersTitle')}</CardTitle>
              <Link href="/pharmacy/transfers" className="text-sm text-primary hover:underline">
                {t('common.viewAll')}
              </Link>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {(query.data.recentTransfers ?? []).map((item) => (
                <Link
                  key={item.id}
                  href={`/pharmacy/transfers`}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
                >
                  <span>
                    {item.transferNumber}
                    {item.warehouse?.name ? ` · ${item.warehouse.name}` : ''}
                  </span>
                  <StatusBadge status={item.status ?? 'SHIPPED'} />
                </Link>
              ))}
              {(query.data.recentTransfers?.length ?? 0) === 0 ? (
                <EmptyState title={t('dashboard.noTransfersAwaiting')} className="border-0 px-0 py-4" />
              ) : null}
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">{t('dashboard.recentDispensing')}</CardTitle>
              <Link href="/pharmacy/dispensing-history" className="text-sm text-primary hover:underline">
                {t('dashboard.history')}
              </Link>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {(query.data.recentDispensing ?? []).map((item) => (
                <Link
                  key={item.id}
                  href={`/pharmacy/dispensing/${item.id}`}
                  className="flex justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
                >
                  <span>{item.dispensingNumber ?? item.recordNumber}</span>
                  <span className="text-muted-foreground">
                    {item.beneficiaryNumber ? `${item.beneficiaryNumber} · ` : ''}
                    {t('dashboard.dispenseLines', { count: item.itemCount ?? 0 })}
                  </span>
                </Link>
              ))}
              {(query.data.recentDispensing?.length ?? 0) === 0 ? (
                <EmptyState
                  title={t('dashboard.noDispensingRecords')}
                  actionHref={canDispense ? '/pharmacy/dispensing' : undefined}
                  actionLabel={canDispense ? t('dashboard.dispenseMedicine') : undefined}
                  className="border-0 px-0 py-4"
                />
              ) : null}
            </CardContent>
          </Card>
        </section>
      ) : null}
    </div>
  );
}
