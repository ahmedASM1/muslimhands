'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useI18n } from '@/i18n';
import { apiRequest } from '@/lib/api';

interface InvitationPreview {
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  valid?: boolean;
  reason?: string;
  organization?: { name: string; code: string } | null;
  role?: { name: string; code: string };
  pharmacy?: { name: string; code: string } | null;
  warehouse?: { name: string; code: string } | null;
}

function roleLabel(t: (key: string) => string, code: string | undefined, name: string | undefined) {
  if (code) {
    const key = `roles.${code}`;
    const label = t(key);
    if (label !== key) return label;
  }
  return name ?? t('common.emDash');
}

function AcceptInvitationForm() {
  const { t } = useI18n();
  const token = useSearchParams().get('token') ?? '';
  const router = useRouter();
  const [password, setPassword] = useState('');
  const preview = useQuery({
    queryKey: ['invite', token],
    enabled: Boolean(token),
    queryFn: () => apiRequest<InvitationPreview>(`/invitations/${token}`),
  });
  const accept = useMutation({
    mutationFn: () =>
      apiRequest<{ homePath?: string; loginPath?: string }>(`/invitations/${token}/accept`, {
        method: 'POST',
        body: { password },
      }),
    onSuccess: (data) => {
      const loginPath = data.loginPath ?? '/login';
      const next = data.homePath ? `?next=${encodeURIComponent(data.homePath)}` : '';
      router.push(`${loginPath}${next}`);
    },
  });

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('auth.acceptInvitation')}</CardTitle>
          <CardDescription>{t('auth.acceptInvitationSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!token ? <p className="text-sm text-destructive">{t('auth.invitationTokenMissing')}</p> : null}
          {preview.data ? (
            <div className="space-y-1 text-sm">
              <p>
                <strong>{t('profile.organization')}:</strong>{' '}
                {preview.data.organization?.name ?? t('auth.defaultOrganizationName')}
              </p>
              <p>
                <strong>{t('profile.role')}:</strong>{' '}
                {roleLabel(t, preview.data.role?.code, preview.data.role?.name)}
              </p>
              <p>
                <strong>{t('profile.pharmacy')}:</strong>{' '}
                {preview.data.pharmacy
                  ? `${preview.data.pharmacy.name} (${preview.data.pharmacy.code})`
                  : t('common.emDash')}
              </p>
              <p>
                <strong>{t('profile.warehouse')}:</strong>{' '}
                {preview.data.warehouse
                  ? `${preview.data.warehouse.name} (${preview.data.warehouse.code})`
                  : t('common.emDash')}
              </p>
              <p>
                <strong>{t('auth.email')}:</strong> {preview.data.email}
              </p>
              {preview.data.valid === false ? (
                <p className="text-destructive">
                  {t('auth.invitationInvalidReason', {
                    reason: preview.data.reason ?? t('auth.invitationNoLongerValid'),
                  })}
                </p>
              ) : null}
            </div>
          ) : preview.isError ? (
            <p className="text-sm text-destructive">{t('auth.invitationInvalid')}</p>
          ) : (
            <p className="text-sm text-muted-foreground">{t('auth.validatingInvitation')}</p>
          )}
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              accept.mutate();
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="password">{t('auth.password')}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={8}
                disabled={preview.data?.valid === false}
              />
            </div>
            {accept.isError ? <p className="text-sm text-destructive">{(accept.error as Error).message}</p> : null}
            <Button
              type="submit"
              className="w-full"
              disabled={!token || preview.data?.valid === false || accept.isPending}
            >
              {t('auth.activateAccount')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AcceptInvitationPage() {
  const { t } = useI18n();
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">{t('common.loadingInvitation')}</div>}>
      <AcceptInvitationForm />
    </Suspense>
  );
}
