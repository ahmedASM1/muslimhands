'use client';



import Link from 'next/link';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { Input } from '@/components/ui/input';

import { Label } from '@/components/ui/label';

import { useI18n } from '@/i18n';

import { apiRequest } from '@/lib/api';

import { useAuth } from '@/lib/auth-context';

import { hasPermission } from '@/lib/permissions';

import { useToast } from '@/lib/toast';



interface SystemSettings {

  expiryWarningDays: number;

  organizationName: string;

}



interface EmailStatus {

  provider: string;

  status: string;

  configured: boolean;

  from: string;

  fromName: string;

  replyTo: string | null;

  lastSuccessfulEmail: { at: string | null; type: string } | null;

  lastFailure: { at: string | null; type: string; errorCode: string | null } | null;

}



export default function UserSettingsPage() {

  const { user } = useAuth();

  const toast = useToast();

  const client = useQueryClient();

  const { locale, setLocale, t } = useI18n();

  const canManageSystem = hasPermission(user, 'settings:update') || hasPermission(user, 'settings:manage');

  const canReadSystem = hasPermission(user, 'settings:read') || hasPermission(user, 'settings:view');



  const system = useQuery({

    queryKey: ['settings'],

    enabled: canReadSystem,

    queryFn: () => apiRequest<SystemSettings>('/settings'),

  });

  const emailStatus = useQuery({

    queryKey: ['settings-email-status'],

    enabled: canReadSystem,

    queryFn: () => apiRequest<EmailStatus>('/settings/email-status'),

  });



  const [orgName, setOrgName] = useState('');

  const [days, setDays] = useState('90');

  const [testTo, setTestTo] = useState('');



  useEffect(() => {

    if (!system.data) return;

    setOrgName(String(system.data.organizationName ?? ''));

    setDays(String(system.data.expiryWarningDays ?? 90));

  }, [system.data]);



  const saveSystem = useMutation({

    mutationFn: () =>

      apiRequest('/settings', {

        method: 'PATCH',

        body: {

          organizationName: orgName,

          expiryWarningDays: Number(days),

        },

      }),

    onSuccess: async () => {

      toast.push(t('settings.systemSaved'), 'success');

      await client.invalidateQueries({ queryKey: ['settings'] });

    },

    onError: (error: Error) => toast.push(error.message, 'error'),

  });



  const sendTest = useMutation({

    mutationFn: () =>

      apiRequest<{ queued: boolean; message: string }>('/settings/email/test', {

        method: 'POST',

        body: { to: testTo },

      }),

    onSuccess: async (result) => {

      toast.push(result.message, result.queued ? 'success' : 'error');

      await client.invalidateQueries({ queryKey: ['settings-email-status'] });

    },

    onError: (error: Error) => toast.push(error.message, 'error'),

  });



  const emDash = t('common.emDash');



  return (

    <div className="mx-auto max-w-3xl space-y-6">

      <div>

        <h1 className="text-2xl font-semibold">{t('settings.title')}</h1>

        <p className="text-sm text-muted-foreground">{t('settings.subtitle')}</p>

      </div>



      <Card>

        <CardHeader>

          <CardTitle>{t('settings.account')}</CardTitle>

        </CardHeader>

        <CardContent className="space-y-2 text-sm">

          <p className="text-muted-foreground">{t('settings.accountHint')}</p>

          <Button asChild variant="outline">

            <Link href="/profile">{t('settings.openProfile')}</Link>

          </Button>

        </CardContent>

      </Card>



      <Card>

        <CardHeader>

          <CardTitle>{t('settings.language')}</CardTitle>

        </CardHeader>

        <CardContent className="space-y-3 text-sm">

          <p className="text-muted-foreground">{t('settings.languageHint')}</p>

          <div className="flex flex-wrap gap-2">

            <Button
              type="button"
              variant={locale === 'en' ? 'default' : 'outline'}
              onClick={() => {
                setLocale('en');
                void apiRequest('/users/me/notification-preferences', {
                  method: 'PATCH',
                  body: { preferredLanguage: 'EN' },
                }).catch(() => undefined);
              }}
            >
              {t('common.english')}
            </Button>
            <Button
              type="button"
              variant={locale === 'ar' ? 'default' : 'outline'}
              onClick={() => {
                setLocale('ar');
                void apiRequest('/users/me/notification-preferences', {
                  method: 'PATCH',
                  body: { preferredLanguage: 'AR' },
                }).catch(() => undefined);
              }}
            >
              {t('common.arabic')}
            </Button>

          </div>

        </CardContent>

      </Card>



      {canReadSystem ? (

        <Card>

          <CardHeader>

            <CardTitle>{t('settings.system')}</CardTitle>

          </CardHeader>

          <CardContent className="space-y-4">

            <div className="grid gap-1">

              <Label>{t('settings.organizationName')}</Label>

              <Input

                value={orgName}

                disabled={!canManageSystem}

                onChange={(e) => setOrgName(e.target.value)}

              />

            </div>

            <div className="grid gap-1">

              <Label>{t('settings.expiryWarningDays')}</Label>

              <Input

                type="number"

                min={1}

                value={days}

                disabled={!canManageSystem}

                onChange={(e) => setDays(e.target.value)}

              />

            </div>

            {canManageSystem ? (

              <Button onClick={() => saveSystem.mutate()} disabled={saveSystem.isPending}>

                {saveSystem.isPending ? t('settings.saving') : t('settings.saveSystem')}

              </Button>

            ) : null}

          </CardContent>

        </Card>

      ) : null}



      {canReadSystem ? (

        <Card>

          <CardHeader>

            <CardTitle>{t('settings.emailService')}</CardTitle>

          </CardHeader>

          <CardContent className="space-y-3 text-sm">

            <div className="rounded-md border px-3 py-2">

              <div className="flex flex-wrap items-center justify-between gap-2">

                <span>

                  {t('settings.providerLabel')} {emailStatus.data?.provider ?? 'Resend'}

                </span>

                <span

                  className={

                    emailStatus.data?.configured ? 'font-medium text-emerald-700' : 'font-medium text-amber-700'

                  }

                >

                  {emailStatus.data?.status ?? emDash}

                </span>

              </div>

              <div className="mt-2 space-y-1 text-muted-foreground">

                <div>

                  {t('settings.from')}:{' '}

                  {emailStatus.data?.fromName

                    ? `${emailStatus.data.fromName} <${emailStatus.data.from}>`

                    : (emailStatus.data?.from ?? emDash)}

                </div>

                {emailStatus.data?.lastSuccessfulEmail?.at ? (

                  <div>

                    {t('settings.lastSuccessfulAt', {

                      at: String(emailStatus.data.lastSuccessfulEmail.at).slice(0, 19),

                      type: emailStatus.data.lastSuccessfulEmail.type,

                    })}

                  </div>

                ) : (

                  <div>{t('settings.lastSuccessfulNone')}</div>

                )}

                {emailStatus.data?.lastFailure?.at ? (

                  <div>

                    {t('settings.lastFailureAt', {

                      at: String(emailStatus.data.lastFailure.at).slice(0, 19),

                      code: emailStatus.data.lastFailure.errorCode

                        ? ` (${emailStatus.data.lastFailure.errorCode})`

                        : '',

                    })}

                  </div>

                ) : (

                  <div>{t('settings.lastFailureNone')}</div>

                )}

              </div>

            </div>



            {canManageSystem ? (

              <div className="grid gap-2 md:grid-cols-[1fr_auto]">

                <Input

                  type="email"

                  placeholder={t('settings.testEmailPlaceholder')}

                  value={testTo}

                  onChange={(e) => setTestTo(e.target.value)}

                />

                <Button

                  onClick={() => sendTest.mutate()}

                  disabled={sendTest.isPending || !testTo.trim()}

                >

                  {sendTest.isPending ? t('settings.sendingEmail') : t('settings.sendTestEmail')}

                </Button>

              </div>

            ) : null}

            <p className="text-xs text-muted-foreground">{t('settings.emailKeysNote')}</p>

          </CardContent>

        </Card>

      ) : null}

    </div>

  );

}

