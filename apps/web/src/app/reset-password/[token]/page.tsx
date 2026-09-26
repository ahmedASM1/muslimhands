'use client';

import { useMutation } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LanguageSwitcher } from '@/i18n/language-switcher';
import { useI18n } from '@/i18n';
import { apiRequest } from '@/lib/api';

export default function ResetPasswordPage() {
  const { t } = useI18n();
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const reset = useMutation({
    mutationFn: () => apiRequest('/auth/reset-password', { method: 'POST', body: { token, password } }),
    onSuccess: () => router.push('/login'),
  });

  return (
    <div className="relative mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <div className="absolute end-4 top-4">
        <LanguageSwitcher />
      </div>
      <h1 className="text-2xl font-semibold">{t('auth.chooseNewPassword')}</h1>
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          reset.mutate();
        }}
      >
        <Input
          type="password"
          placeholder={t('auth.newPassword')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          dir="ltr"
        />
        {reset.isError ? <p className="text-sm text-destructive">{(reset.error as Error).message}</p> : null}
        <Button type="submit" className="w-full">
          {t('auth.updatePassword')}
        </Button>
      </form>
    </div>
  );
}
