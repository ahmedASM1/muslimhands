'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LogOut, Menu, Search, X } from 'lucide-react';
import { filterNav, isNavItemActive, navIconFor, navigationFor } from '@/config/navigation';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NotificationBell } from '@/components/notification-bell';
import { LanguageSwitcher } from '@/i18n/language-switcher';
import { useI18n } from '@/i18n/locale-context';
import { Skeleton } from '@/components/skeleton';
import type { AuthenticatedUser } from '@mh/shared';
import type { NavSection } from '@/config/navigation';

const SIDEBAR_GRADIENT =
  'linear-gradient(180deg, hsl(var(--sidebar-deep)) 0%, hsl(var(--sidebar)) 42%, hsl(var(--sidebar-bright)) 100%)';

function userInitials(user: {
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  email?: string;
}) {
  const first = user.firstName?.trim()?.[0];
  const last = user.lastName?.trim()?.[0];
  if (first && last) return `${first}${last}`.toUpperCase();
  const name = (user.name || user.email || 'U').trim();
  const parts = name.split(/\s+/);
  if (parts.length >= 2) return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function SidebarPanel({
  sections,
  pathname,
  user,
  onLogout,
  showClose,
  onClose,
}: {
  sections: NavSection[];
  pathname: string;
  user: AuthenticatedUser;
  onLogout: () => void;
  showClose?: boolean;
  onClose?: () => void;
}) {
  const { t } = useI18n();
  const displayName = user.name || `${user.firstName} ${user.lastName}`.trim();
  const rawRole = user.role ?? user.roles[0] ?? 'User';
  const roleLabel = t(`roles.${rawRole}`) !== `roles.${rawRole}` ? t(`roles.${rawRole}`) : rawRole.replaceAll('_', ' ');
  const contextLabel = user.pharmacy?.name ?? user.warehouse?.name ?? user.pharmacySlug ?? null;
  const initials = userInitials(user);

  return (
    <>
      <div className="shrink-0 border-b border-white/15 px-4 py-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <Image
              src="/muslimhands-logo.png"
              alt={t('brand.name')}
              width={44}
              height={44}
              className="h-11 w-11 shrink-0 object-contain mix-blend-screen"
              priority
            />
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold leading-tight text-white">{t('brand.name')}</p>
              <p className="truncate text-[11px] leading-snug text-sidebar-muted">{t('brand.system')}</p>
            </div>
          </div>
          {showClose ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="shrink-0 text-white hover:bg-white/10 hover:text-white"
              onClick={onClose}
              aria-label={t('common.closeMenu')}
            >
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label={t('nav.primary')}>
        {sections.map((section) => (
          <div key={section.titleKey}>
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-muted">
              {t(section.titleKey)}
            </p>
            <div className="space-y-1">
              {section.items.map((item) => {
                const active = isNavItemActive(pathname, item.href);
                const Icon = navIconFor(item.href);
                return (
                  <Link
                    key={`${section.titleKey}-${item.href}`}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-white/90 transition-colors duration-150',
                      'hover:bg-white/10 hover:text-white',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
                      active && 'bg-white/20 text-white shadow-sm',
                    )}
                  >
                    <Icon
                      className={cn(
                        'h-[18px] w-[18px] shrink-0 text-white/85 transition-colors duration-150',
                        active && 'text-white',
                      )}
                      strokeWidth={1.85}
                      aria-hidden="true"
                    />
                    <span className="truncate">{t(item.labelKey)}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-white/15 p-3">
        <Link
          href="/profile"
          className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/20 text-sm font-semibold text-white"
            aria-hidden="true"
          >
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">{displayName}</p>
            <p className="truncate text-xs text-sidebar-muted">
              {roleLabel}
              {contextLabel ? ` · ${contextLabel}` : ''}
            </p>
          </div>
        </Link>
        <Button
          variant="ghost"
          className="mt-1 w-full justify-start gap-2 text-white/90 hover:bg-white/10 hover:text-white"
          onClick={onLogout}
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          {t('common.signOut')}
        </Button>
      </div>
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  const { t } = useI18n();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (loading || user) return;
    const pharmacyMatch = pathname.match(/^\/pharmacies\/([^/]+)(?:\/(?!login).*)?$/);
    if (pharmacyMatch && !pathname.endsWith('/login')) {
      router.replace(`/pharmacies/${pharmacyMatch[1]}/login`);
      return;
    }
    router.replace('/login');
  }, [loading, user, router, pathname]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setMobileOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-8">
        <div className="w-full max-w-sm space-y-3" role="status" aria-label={t('common.loadingWorkspace')}>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  const sections = filterNav(navigationFor(user), user);

  function handleLogout() {
    const pharmacySlug = user?.pharmacySlug;
    void Promise.resolve(logout()).then(() =>
      router.replace(pharmacySlug ? `/pharmacies/${pharmacySlug}/login` : '/login'),
    );
  }

  return (
    <div className="app-shell h-dvh overflow-hidden bg-background md:ps-[15rem]">
      <aside
        className="app-sidebar fixed inset-y-0 start-0 z-40 hidden h-dvh w-[15rem] flex-col text-sidebar-foreground md:flex"
        style={{ background: SIDEBAR_GRADIENT }}
        aria-label={t('nav.primary')}
      >
        <SidebarPanel sections={sections} pathname={pathname} user={user} onLogout={handleLogout} />
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label={t('nav.primary')}>
          <button
            type="button"
            className="absolute inset-0 bg-black/45"
            aria-label={t('common.closeNavigation')}
            onClick={() => setMobileOpen(false)}
          />
          <aside
            className="app-sidebar relative z-50 flex h-full w-[min(18rem,85vw)] flex-col shadow-2xl ms-0 me-auto"
            style={{ background: SIDEBAR_GRADIENT }}
          >
            <SidebarPanel
              sections={sections}
              pathname={pathname}
              user={user}
              onLogout={handleLogout}
              showClose
              onClose={() => setMobileOpen(false)}
            />
          </aside>
        </div>
      ) : null}

      <div className="app-main flex h-dvh min-w-0 flex-col overflow-y-auto overflow-x-hidden">
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-border/80 bg-white px-3 sm:gap-3 sm:px-4 md:px-6">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="md:hidden"
            aria-label={t('common.openMenu')}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="h-4 w-4" />
          </Button>

          <div className="relative hidden min-w-0 flex-1 md:block">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              className="h-10 max-w-xl rounded-full border-border/80 bg-secondary/60 ps-9"
              placeholder={t('header.searchPlaceholder')}
              aria-label={t('common.search')}
              disabled
              title={t('header.searchComingSoon')}
            />
          </div>

          <div className="ms-auto flex shrink-0 items-center gap-2">
            <LanguageSwitcher />
            <NotificationBell />
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
