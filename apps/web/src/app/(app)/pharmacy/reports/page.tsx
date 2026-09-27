'use client';

import Link from 'next/link';
import { useI18n } from '@/i18n';

const LINKS = [
  { href: '/reports/pharmacy-stock', labelKey: 'reports.links.pharmacyStock' },
  { href: '/reports/dispensing', labelKey: 'reports.links.dispensing' },
  { href: '/reports/beneficiaries', labelKey: 'reports.links.beneficiaries' },
  { href: '/reports/expiry', labelKey: 'reports.links.expiry' },
  { href: '/reports/low-stock', labelKey: 'reports.links.lowStock' },
  { href: '/reports/supply-requests', labelKey: 'reports.links.supplyRequests' },
  { href: '/reports/transfers', labelKey: 'reports.links.transfers' },
] as const;

export default function PharmacyReportsPage() {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t('reports.pharmacyHubTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('reports.pharmacyHubSubtitle')}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-lg border px-4 py-3 text-sm font-medium hover:bg-muted/40"
          >
            {t(link.labelKey)}
          </Link>
        ))}
      </div>
    </div>
  );
}
