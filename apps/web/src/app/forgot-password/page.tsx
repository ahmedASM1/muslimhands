'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/i18n';
import { apiRequest } from '@/lib/api';

export default function ForgotPasswordPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const forgot = useMutation({
    mutationFn: () =>
      apiRequest<{ sent: boolean; resetUrl?: string }>('/auth/forgot-password', {
        method: 'POST',
        body: { email },
      }),
  });

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <h1 className="text-2xl font-semibold">{t('auth.resetPassword')}</h1>
      <p className="mb-4 text-sm text-muted-foreground">{t('auth.forgotDevSubtitle')}</p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          forgot.mutate();
        }}
      >
        <Input
          type="email"
          placeholder={t('auth.email')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Button type="submit" className="w-full" disabled={forgot.isPending}>
          {forgot.isPending ? t('auth.sending') : t('auth.sendResetLink')}
        </Button>
      </form>
      {forgot.data?.resetUrl ? (
        <p className="mt-4 break-all text-sm">
          {t('auth.devResetLink')}{' '}
          <a className="underline" href={forgot.data.resetUrl}>
            {forgot.data.resetUrl}
          </a>
        </p>
      ) : forgot.isSuccess ? (
        <p className="mt-4 text-sm text-muted-foreground">{t('auth.resetSentShort')}</p>
      ) : null}
    </div>
  );
}
