'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Building2, Pill, Search, UsersRound } from 'lucide-react';
import { filterNav, navigationFor, navIconFor } from '@/config/navigation';
import { useI18n } from '@/i18n';
import { apiList, apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { hasPermission } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

type SearchHit = {
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  kind: 'page' | 'medicine' | 'beneficiary' | 'pharmacy';
};

export function GlobalSearch({ className }: { className?: string }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const deferred = useDeferredValue(query.trim());

  const canMedicines = hasPermission(user, 'medicines:read');
  const canBeneficiaries = hasPermission(user, 'beneficiaries:read');
  const canPharmacies = hasPermission(user, 'pharmacies:read');

  const pages = useMemo(() => {
    if (!user || deferred.length < 1) return [] as SearchHit[];
    const q = deferred.toLowerCase();
    return filterNav(navigationFor(user), user)
      .flatMap((section) =>
        section.items.map((item) => ({
          id: `page:${item.href}`,
          title: t(item.labelKey),
          subtitle: t(section.titleKey),
          href: item.href,
          kind: 'page' as const,
        })),
      )
      .filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.subtitle?.toLowerCase().includes(q) ||
          item.href.toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [user, deferred, t]);

  const medicines = useQuery({
    queryKey: ['global-search-medicines', deferred],
    enabled: open && canMedicines && deferred.length >= 2,
    queryFn: () =>
      apiList<{ id: string; name: string; sku?: string; genericName?: string | null }>(
        `/medicines?limit=5&search=${encodeURIComponent(deferred)}`,
      ),
  });

  const beneficiaries = useQuery({
    queryKey: ['global-search-beneficiaries', deferred],
    enabled: open && canBeneficiaries && deferred.length >= 2,
    queryFn: () =>
      apiList<{ id: string; fullName: string; beneficiaryNumber?: string | null; phone?: string | null }>(
        `/beneficiaries?limit=5&search=${encodeURIComponent(deferred)}`,
      ),
  });

  const pharmacies = useQuery({
    queryKey: ['global-search-pharmacies', deferred],
    enabled: open && canPharmacies && deferred.length >= 2,
    queryFn: async () => {
      const rows = await apiRequest<
        { id: string; name: string; code?: string; slug?: string }[]
      >('/pharmacies');
      const q = deferred.toLowerCase();
      return {
        items: rows
          .filter(
            (row) =>
              row.name.toLowerCase().includes(q) ||
              row.code?.toLowerCase().includes(q) ||
              row.slug?.toLowerCase().includes(q),
          )
          .slice(0, 5),
      };
    },
  });

  const hits = useMemo(() => {
    const next: SearchHit[] = [...pages];

    for (const row of medicines.data?.items ?? []) {
      next.push({
        id: `medicine:${row.id}`,
        title: row.name,
        subtitle: [row.sku, row.genericName].filter(Boolean).join(' · ') || t('nav.medicines'),
        href: `/inventory/medicines?search=${encodeURIComponent(row.name)}`,
        kind: 'medicine',
      });
    }

    for (const row of beneficiaries.data?.items ?? []) {
      next.push({
        id: `beneficiary:${row.id}`,
        title: row.fullName,
        subtitle:
          [row.beneficiaryNumber, row.phone].filter(Boolean).join(' · ') || t('nav.beneficiaries'),
        href: `/pharmacy/beneficiaries?search=${encodeURIComponent(row.fullName)}`,
        kind: 'beneficiary',
      });
    }

    for (const row of pharmacies.data?.items ?? []) {
      next.push({
        id: `pharmacy:${row.id}`,
        title: row.name,
        subtitle: row.code || t('nav.pharmacies'),
        href: row.slug ? `/pharmacies/${row.slug}` : '/administration/pharmacies',
        kind: 'pharmacy',
      });
    }

    if (deferred.length >= 2) {
      if (canMedicines) {
        next.push({
          id: 'goto-medicines',
          title: t('header.searchAllMedicines', { query: deferred }),
          href: `/inventory/medicines?search=${encodeURIComponent(deferred)}`,
          kind: 'medicine',
        });
      }
      if (canBeneficiaries) {
        next.push({
          id: 'goto-beneficiaries',
          title: t('header.searchAllBeneficiaries', { query: deferred }),
          href: `/pharmacy/beneficiaries?search=${encodeURIComponent(deferred)}`,
          kind: 'beneficiary',
        });
      }
    }

    return next.slice(0, 12);
  }, [
    pages,
    medicines.data,
    beneficiaries.data,
    pharmacies.data,
    deferred,
    canMedicines,
    canBeneficiaries,
    t,
  ]);

  useEffect(() => setActiveIndex(0), [hits]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  function go(href: string) {
    setOpen(false);
    setQuery('');
    router.push(href);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.min(index + 1, Math.max(hits.length - 1, 0)));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const hit = hits[activeIndex];
      if (hit) go(hit.href);
      else if (deferred.length >= 2 && canMedicines) {
        go(`/inventory/medicines?search=${encodeURIComponent(deferred)}`);
      }
    }
  }

  function iconFor(kind: SearchHit['kind'], href: string) {
    if (kind === 'medicine') return Pill;
    if (kind === 'beneficiary') return UsersRound;
    if (kind === 'pharmacy') return Building2;
    return navIconFor(href);
  }

  const showPanel = open && deferred.length > 0;
  const loading =
    (medicines.isFetching || beneficiaries.isFetching || pharmacies.isFetching) && deferred.length >= 2;

  return (
    <div ref={rootRef} className={cn('relative min-w-0 flex-1', className)}>
      <Search
        className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        className="h-10 max-w-xl rounded-full border-border/80 bg-secondary/60 ps-9"
        placeholder={t('header.searchPlaceholder')}
        aria-label={t('common.search')}
        aria-expanded={showPanel}
        aria-controls="global-search-results"
        role="combobox"
        autoComplete="off"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />

      {showPanel ? (
        <div
          id="global-search-results"
          role="listbox"
          className="absolute start-0 z-50 mt-2 max-h-80 w-full max-w-xl overflow-auto rounded-xl border bg-white p-1 shadow-lg"
        >
          {hits.length === 0 && !loading ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">{t('header.searchNoResults')}</p>
          ) : null}
          {loading && hits.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : null}
          {hits.map((hit, index) => {
            const Icon = iconFor(hit.kind, hit.href);
            return (
              <button
                key={hit.id}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={cn(
                  'flex w-full items-start gap-3 rounded-lg px-3 py-2 text-start transition-colors',
                  index === activeIndex ? 'bg-secondary' : 'hover:bg-secondary/70',
                )}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => go(hit.href)}
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{hit.title}</span>
                  {hit.subtitle ? (
                    <span className="block truncate text-xs text-muted-foreground">{hit.subtitle}</span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
