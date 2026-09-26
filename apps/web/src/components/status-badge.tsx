'use client';

import { Badge } from '@/components/ui/badge';
import { useI18n } from '@/i18n/locale-context';

type BadgeVariant = 'secondary' | 'outline' | 'destructive' | 'success' | 'warning' | 'info';

const STOCK: Record<string, BadgeVariant> = {
  IN_STOCK: 'success',
  LOW_STOCK: 'warning',
  OUT_OF_STOCK: 'destructive',
  EXPIRING_SOON: 'warning',
  EXPIRED: 'destructive',
  VALID: 'success',
};

const WORKFLOW: Record<string, BadgeVariant> = {
  DRAFT: 'outline',
  SUBMITTED: 'info',
  APPROVED: 'success',
  REJECTED: 'destructive',
  FULFILLED: 'success',
  CANCELLED: 'secondary',
  CREATED: 'outline',
  PREPARED: 'info',
  SHIPPED: 'warning',
  IN_TRANSIT: 'warning',
  RECEIVED: 'success',
  PARTIALLY_RECEIVED: 'info',
  POSTED: 'success',
  PENDING: 'warning',
  ACTIVE: 'success',
  INACTIVE: 'secondary',
  COMPLETED: 'success',
};

const SEVERITY: Record<string, BadgeVariant> = {
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'destructive',
};

function variantFor(kind: 'workflow' | 'stock' | 'severity', key: string): BadgeVariant {
  if (kind === 'stock') return STOCK[key] ?? 'secondary';
  if (kind === 'severity') return SEVERITY[key] ?? 'secondary';
  return WORKFLOW[key] ?? 'secondary';
}

export function StatusBadge({
  status,
  kind = 'workflow',
}: {
  status: string;
  kind?: 'workflow' | 'stock' | 'severity';
}) {
  const { t } = useI18n();
  const key = status?.toUpperCase?.() ?? '';
  const translated = t(`status.${key}`);
  const label = translated === `status.${key}` ? status?.replaceAll('_', ' ') || t('common.emDash') : translated;
  const variant = variantFor(kind, key);

  return (
    <Badge variant={variant} aria-label={t('status.prefix', { label })}>
      {label}
    </Badge>
  );
}

export function StatusTimeline({
  steps,
  current,
}: {
  steps: string[];
  current: string;
}) {
  const { t } = useI18n();
  const currentIndex = Math.max(
    0,
    steps.findIndex((step) => step === current.toUpperCase()),
  );

  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs" aria-label={t('status.timeline')}>
      {steps.map((step, index) => {
        const reached = index <= currentIndex;
        const active = index === currentIndex;
        const key = step.toUpperCase();
        const translated = t(`status.${key}`);
        const label = translated === `status.${key}` ? step.replaceAll('_', ' ') : translated;
        return (
          <li key={step} className="flex items-center gap-2">
            <span
              className={
                active
                  ? 'rounded-md bg-primary px-2 py-1 font-medium text-primary-foreground'
                  : reached
                    ? 'rounded-md bg-muted px-2 py-1 font-medium'
                    : 'rounded-md border px-2 py-1 text-muted-foreground'
              }
            >
              {label}
            </span>
            {index < steps.length - 1 ? (
              <span className="text-muted-foreground rtl:rotate-180" aria-hidden="true">
                →
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
