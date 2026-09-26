'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { apiList, apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { hasPermission } from '@/lib/permissions';
import { relativeTime } from '@/lib/format';
import { useI18n } from '@/i18n/locale-context';
import { cn } from '@/lib/utils';

interface NotificationItem {
  id: string;
  title: string;
  message: string;
  severity: string;
  type: string;
  status: string;
  isRead: boolean;
  href?: string | null;
  createdAt: string;
}

function localizeNotification(
  item: NotificationItem,
  t: (key: string, params?: Record<string, string | number>) => string,
) {
  const titleKey = `notifications.types.${item.type}.title`;
  const messageKey = `notifications.types.${item.type}.message`;
  const title = t(titleKey);
  const message = t(messageKey);
  return {
    title: title === titleKey ? item.title : title,
    message: message === messageKey ? item.message : message,
  };
}

export function NotificationBell() {
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const canView =
    hasPermission(user, 'notifications:read') || hasPermission(user, 'notification:view');

  const unread = useQuery({
    queryKey: ['notifications-unread'],
    enabled: canView,
    queryFn: () => apiRequest<{ unreadCount: number }>('/notifications/unread-count'),
    refetchInterval: 60_000,
  });

  const recent = useQuery({
    queryKey: ['notifications-recent'],
    enabled: open && canView,
    queryFn: () => apiList<NotificationItem>('/notifications?limit=8&activeOnly=true'),
  });

  const markOne = useMutation({
    mutationFn: (id: string) => apiRequest(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['notifications'] });
      client.invalidateQueries({ queryKey: ['notifications-unread'] });
      client.invalidateQueries({ queryKey: ['notifications-recent'] });
      client.invalidateQueries({ queryKey: ['notifications-summary'] });
    },
  });

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!canView) return null;

  const count = unread.data?.unreadCount ?? 0;

  return (
    <div className="relative" ref={rootRef}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="relative h-9 gap-2"
        aria-label={
          count
            ? t('header.alertsAriaUnread', { count })
            : t('header.alertsAria')
        }
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">{t('header.alerts')}</span>
        {count > 0 ? (
          <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] font-semibold text-destructive-foreground">
            {count > 99 ? '99+' : count}
          </span>
        ) : null}
      </Button>

      {open ? (
        <div
          role="dialog"
          aria-label={t('header.recentNotifications')}
          className="absolute end-0 z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-lg border bg-card p-2 shadow-lg"
        >
          <div className="mb-2 flex items-center justify-between px-2 py-1">
            <p className="text-sm font-medium">{t('notifications.title')}</p>
            <Link
              href="/notifications"
              className="text-xs text-primary hover:underline"
              onClick={() => setOpen(false)}
            >
              {t('common.viewAll')}
            </Link>
          </div>
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {recent.isLoading ? (
              <p className="px-2 py-4 text-sm text-muted-foreground">{t('common.loading')}</p>
            ) : null}
            {(recent.data?.items ?? []).map((item) => {
              const localized = localizeNotification(item, t);
              return (
                <Link
                  key={item.id}
                  href={item.href || '/notifications'}
                  className={cn(
                    'block rounded-md border px-3 py-2 text-start text-sm hover:bg-muted/50',
                    !item.isRead && 'border-primary/20 bg-accent/40',
                  )}
                  onClick={() => {
                    if (!item.isRead) markOne.mutate(item.id);
                    setOpen(false);
                  }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={item.severity} kind="severity" />
                    <span className="font-medium">{localized.title}</span>
                    <span className="ms-auto text-[11px] text-muted-foreground">
                      {relativeTime(item.createdAt, locale)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{localized.message}</p>
                </Link>
              );
            })}
            {!recent.isLoading && (recent.data?.items?.length ?? 0) === 0 ? (
              <EmptyState title={t('notifications.emptyTitle')} className="border-0 py-6" />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** @deprecated Prefer StatusBadge kind="severity" */
export function SeverityBadge({ severity }: { severity: string }) {
  return <StatusBadge status={severity} kind="severity" />;
}
