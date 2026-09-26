'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import type { AuthSession } from '@mh/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LanguageSwitcher } from '@/i18n/language-switcher';
import { useI18n } from '@/i18n/locale-context';
import { apiRequest, ApiClientError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { homePath } from '@/lib/home-path';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const { setSession } = useAuth();
  const { t } = useI18n();
  const form = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const mutation = useMutation({
    mutationFn: (values: LoginForm) =>
      apiRequest<AuthSession>('/auth/login', { method: 'POST', body: values }),
    onSuccess: (session) => {
      setSession(session);
      router.replace(homePath(session.user));
    },
  });

  return (
    <div
      className="relative flex min-h-screen items-center justify-center p-6"
      style={{
        background: 'linear-gradient(160deg, #E7F7FB 0%, #F5F9FC 42%, #DFF3F9 100%)',
      }}
    >
      <div className="absolute end-4 top-4">
        <LanguageSwitcher />
      </div>
      <div className="w-full max-w-[420px] overflow-hidden rounded-2xl border border-[#B6E0EC] bg-white shadow-[0_12px_40px_rgba(0,113,145,0.12)]">
        <div
          className="px-7 py-5 text-white"
          style={{
            background: 'linear-gradient(135deg, #006F91 0%, #008DB5 55%, #19A9CF 100%)',
          }}
        >
          <div className="min-w-0 text-start">
            <p className="truncate text-[15px] font-semibold leading-tight">{t('brand.name')}</p>
            <p className="truncate text-[11px] leading-snug text-white/85">{t('brand.system')}</p>
          </div>
        </div>

        <div className="space-y-6 px-7 py-7 text-start">
          <div className="space-y-1.5">
            <h1 className="text-[1.35rem] font-semibold tracking-tight text-[#12304A]">{t('auth.signIn')}</h1>
            <p className="text-sm leading-relaxed text-[#64748B]">{t('brand.tagline')}</p>
          </div>

          <form
            className="flex w-full flex-col gap-4 text-start"
            onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          >
            <div className="flex w-full flex-col gap-1.5 text-start">
              <Label htmlFor="email" className="text-sm font-medium text-[#12304A]">
                {t('auth.email')}
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                dir="ltr"
                className="h-11 w-full rounded-xl border-[#B6E0EC] bg-[#F0F9FC] text-[#12304A] placeholder:text-[#94A3B8] focus-visible:ring-[#008DB5]"
                {...form.register('email')}
              />
              {form.formState.errors.email ? (
                <p className="text-sm text-destructive">{form.formState.errors.email.message}</p>
              ) : null}
            </div>

            <div className="flex w-full flex-col gap-1.5 text-start">
              <Label htmlFor="password" className="text-sm font-medium text-[#12304A]">
                {t('auth.password')}
              </Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                dir="ltr"
                className="h-11 w-full rounded-xl border-[#B6E0EC] bg-[#F0F9FC] text-[#12304A] placeholder:text-[#94A3B8] focus-visible:ring-[#008DB5]"
                {...form.register('password')}
              />
              {form.formState.errors.password ? (
                <p className="text-sm text-destructive">{form.formState.errors.password.message}</p>
              ) : null}
            </div>

            {mutation.error instanceof ApiClientError ? (
              <p className="text-sm text-destructive">{mutation.error.message}</p>
            ) : null}

            <Button
              className="mt-1 h-11 w-full rounded-xl bg-[#008DB5] text-base font-semibold text-white hover:bg-[#006F91]"
              type="submit"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? t('auth.signingIn') : t('auth.signIn')}
            </Button>

            <Link
              href="/forgot-password"
              className="block text-center text-sm font-medium text-[#008DB5] underline-offset-2 hover:text-[#006F91] hover:underline"
            >
              {t('auth.forgotPassword')}
            </Link>
          </form>
        </div>
      </div>
    </div>
  );
}
