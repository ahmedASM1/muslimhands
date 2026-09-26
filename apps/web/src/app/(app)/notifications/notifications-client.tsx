'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { TableSkeleton } from '@/components/skeleton';
import { StatusBadge } from '@/components/status-badge';
import { useI18n } from '@/i18n';
import { apiRequest } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

interface NotificationItem {
  id: string;
  title: string;
  message: string;
  severity: string;
  type: string;
  status: string;
  isRead: boolean;
  isActive: boolean;
  href?: string | null;
  createdAt: string;
}

export default function NotificationsClient() {
  const client = useQueryClient();
  const searchParams = useSearchParams();
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<'all' | 'unread'>(
    searchParams.get('tab') === 'unread' ? 'unread' : 'all',
  );

  useEffect(() => {
    if (searchParams.get('tab') === 'unread') setTab('unread');
  }, [searchParams]);

  const list = useQuery({
    queryKey: ['notifications', tab],
    queryFn: () =>
      apiRequest<{
        unreadCount: number;
        items: NotificationItem[];
      }>(
        `/notifications?limit=50&activeOnly=true${tab === 'unread' ? '&unreadOnly=true' : ''}`,
      ),
  });

  const markAll = useMutation({
    mutationFn: () => apiRequest('/notifications/read-all', { method: 'POST' }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['notifications'] });
      client.invalidateQueries({ queryKey: ['notifications-unread'] });
      client.invalidateQueries({ queryKey: ['notifications-summary'] });
      client.invalidateQueries({ queryKey: ['notifications-recent'] });
    },
  });

  const markOne = useMutation({
    mutationFn: (id: string) => apiRequest(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['notifications'] });
      client.invalidateQueries({ queryKey: ['notifications-unread'] });
      client.invalidateQueries({ queryKey: ['notifications-summary'] });
      client.invalidateQueries({ queryKey: ['notifications-recent'] });
    },
  });

  const unreadCount = list.data?.unreadCount ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('notifications.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {unreadCount === 0
              ? t('notifications.subtitleZero')
              : t('notifications.subtitle', { count: unreadCount })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={tab === 'all' ? 'default' : 'outline'}
            aria-pressed={tab === 'all'}
            onClick={() => setTab('all')}
          >
            {t('notifications.all')}
          </Button>
          <Button
            type="button"
            variant={tab === 'unread' ? 'default' : 'outline'}
            aria-pressed={tab === 'unread'}
            onClick={() => setTab('unread')}
          >
            {t('notifications.unread')}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={markAll.isPending || unreadCount === 0}
            onClick={() => markAll.mutate()}
          >
            {markAll.isPending ? t('notifications.marking') : t('notifications.markAllRead')}
          </Button>
        </div>
      </div>

      {list.isLoading ? <TableSkeleton rows={6} cols={1} /> : null}
      {list.error ? (
        <EmptyState
          title={t('common.unableToLoad')}
          description={(list.error as Error).message}
        />
      ) : null}

      <div className="space-y-2">
        {(list.data?.items ?? []).map((n) => {
          const titleKey = `notifications.types.${n.type}.title`;
          const messageKey = `notifications.types.${n.type}.message`;
          const titleT = t(titleKey);
          const messageT = t(messageKey);
          const title = titleT === titleKey ? n.title : titleT;
          const message = messageT === messageKey ? n.message : messageT;
          const content = (
            <div className="w-full text-start">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={n.severity} kind="severity" />
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {titleT === titleKey ? n.type.replaceAll('_', ' ') : title}
                </span>
                {!n.isRead ? (
                  <span className="text-xs font-medium text-primary">{t('notifications.unreadLabel')}</span>
                ) : (
                  <span className="text-xs text-muted-foreground">{t('notifications.readLabel')}</span>
                )}
              </div>
              <div className="mt-1 font-medium">{title}</div>
              <div className="text-sm text-muted-foreground">{message}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {formatDateTime(n.createdAt, locale)}
                {n.href ? ` · ${t('notifications.openRelated')}` : ''}
              </div>
            </div>
          );

          return (
            <div
              key={n.id}
              className={cn(
                'rounded-lg border p-3',
                n.isRead ? 'opacity-90' : 'border-primary/20 bg-accent/30',
              )}
            >
              {n.href ? (
                <Link
                  href={n.href}
                  className="block"
                  onClick={() => {
                    if (!n.isRead) markOne.mutate(n.id);
                  }}
                >
                  {content}
                </Link>
              ) : (
                <button
                  type="button"
                  className="w-full"
                  onClick={() => {
                    if (!n.isRead) markOne.mutate(n.id);
                  }}
                >
                  {content}
                </button>
              )}
            </div>
          );
        })}
        {!list.isLoading && (list.data?.items?.length ?? 0) === 0 ? (
          <EmptyState
            title={t('notifications.emptyTitle')}
            description={t('notifications.emptyDescription')}
          />
        ) : null}
      </div>
    </div>
  );
}
