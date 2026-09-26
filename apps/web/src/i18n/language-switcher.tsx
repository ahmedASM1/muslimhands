'use client';

import { Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n/locale-context';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import type { AppLocale } from '@/i18n/config';

async function syncPreferredLanguage(locale: AppLocale) {
  try {
    await apiRequest('/users/me/notification-preferences', {
      method: 'PATCH',
      body: { preferredLanguage: locale === 'ar' ? 'AR' : 'EN' },
    });
  } catch {
    /* preference sync is best-effort; UI locale still applies */
  }
}

export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  const { user } = useAuth();
  const next = locale === 'en' ? 'ar' : 'en';
  const label = locale === 'en' ? t('common.arabic') : t('common.english');
  const aria = locale === 'en' ? t('common.switchToArabic') : t('common.switchToEnglish');

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn(
        'h-9 gap-1.5 border-border/80 bg-white px-3 text-sm font-medium text-foreground transition-colors',
        'hover:bg-secondary/80 hover:text-foreground',
        'focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      aria-label={aria}
      onClick={() => {
        setLocale(next);
        if (user) void syncPreferredLanguage(next);
      }}
    >
      <Languages className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <span>{label}</span>
    </Button>
  );
}
