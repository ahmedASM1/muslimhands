'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useI18n } from '@/i18n';
import { apiList, apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { hasPermission } from '@/lib/permissions';
import { useToast } from '@/lib/toast';

interface SystemSettings {
  expiryWarningDays: number;
  expiryWarningValue?: number;
  expiryWarningUnit?: 'DAYS' | 'WEEKS' | 'MONTHS';
  organizationName: string;
}

interface NotificationPrefs {
  emailEnabled: boolean;
  inAppEnabled: boolean;
  emailLowStock?: boolean;
  emailExpiringSoon?: boolean;
  emailExpiredStock?: boolean;
  expiryAlertValue?: number | null;
  expiryAlertUnit?: 'DAYS' | 'WEEKS' | 'MONTHS' | null;
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

interface UserRow {
  id: string;
  email: string;
  name: string;
  firstName?: string;
  lastName?: string;
}

type UsersMode = 'keep_all' | 'delete_except' | 'delete_all_except_current';

const TARGET_KEYS = [
  'categories',
  'medicines',
  'batches',
  'warehouseStock',
  'pharmacyStock',
  'receipts',
  'supplyRequests',
  'transfers',
  'dispensing',
  'beneficiaries',
  'stockMovements',
  'notifications',
  'auditLogs',
] as const;

type TargetKey = (typeof TARGET_KEYS)[number];

const TARGET_LABEL_KEYS: Record<TargetKey, string> = {
  categories: 'settings.targetCategories',
  medicines: 'settings.targetMedicines',
  batches: 'settings.targetBatches',
  warehouseStock: 'settings.targetWarehouseStock',
  pharmacyStock: 'settings.targetPharmacyStock',
  receipts: 'settings.targetReceipts',
  supplyRequests: 'settings.targetSupplyRequests',
  transfers: 'settings.targetTransfers',
  dispensing: 'settings.targetDispensing',
  beneficiaries: 'settings.targetBeneficiaries',
  stockMovements: 'settings.targetStockMovements',
  notifications: 'settings.targetNotifications',
  auditLogs: 'settings.targetAuditLogs',
};

export default function UserSettingsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const client = useQueryClient();
  const { locale, setLocale, t } = useI18n();
  const canManageSystem = hasPermission(user, 'settings:update') || hasPermission(user, 'settings:manage');
  const canReadSystem = hasPermission(user, 'settings:read') || hasPermission(user, 'settings:view');
  const canReadUsers = hasPermission(user, 'users:read');

  const system = useQuery({
    queryKey: ['settings'],
    enabled: canReadSystem,
    queryFn: () => apiRequest<SystemSettings>('/settings'),
  });
  const prefs = useQuery({
    queryKey: ['notification-prefs'],
    queryFn: () => apiRequest<NotificationPrefs>('/users/me/notification-preferences'),
  });
  const emailStatus = useQuery({
    queryKey: ['settings-email-status'],
    enabled: canReadSystem,
    queryFn: () => apiRequest<EmailStatus>('/settings/email-status'),
  });
  const users = useQuery({
    queryKey: ['settings-users'],
    enabled: canManageSystem && canReadUsers,
    queryFn: () => apiList<UserRow>('/users?limit=100&sortBy=email'),
  });

  const [orgName, setOrgName] = useState('');
  const [expiryValue, setExpiryValue] = useState('3');
  const [expiryUnit, setExpiryUnit] = useState<'DAYS' | 'WEEKS' | 'MONTHS'>('MONTHS');
  const [personalExpiryValue, setPersonalExpiryValue] = useState('');
  const [personalExpiryUnit, setPersonalExpiryUnit] = useState<'DAYS' | 'WEEKS' | 'MONTHS'>('MONTHS');
  const [useOrgExpiryDefault, setUseOrgExpiryDefault] = useState(true);
  const [testTo, setTestTo] = useState('');
  const [targets, setTargets] = useState<Record<TargetKey, boolean>>(() =>
    Object.fromEntries(TARGET_KEYS.map((key) => [key, false])) as Record<TargetKey, boolean>,
  );
  const [usersMode, setUsersMode] = useState<UsersMode>('keep_all');
  const [keepUserIds, setKeepUserIds] = useState<string[]>([]);
  const [confirmPhrase, setConfirmPhrase] = useState('');

  useEffect(() => {
    if (!system.data) return;
    setOrgName(String(system.data.organizationName ?? ''));
    setExpiryValue(String(system.data.expiryWarningValue ?? system.data.expiryWarningDays ?? 90));
    setExpiryUnit(
      (system.data.expiryWarningUnit as 'DAYS' | 'WEEKS' | 'MONTHS' | undefined) ?? 'DAYS',
    );
  }, [system.data]);

  useEffect(() => {
    if (!prefs.data) return;
    const hasPersonal = prefs.data.expiryAlertValue != null;
    setUseOrgExpiryDefault(!hasPersonal);
    setPersonalExpiryValue(hasPersonal ? String(prefs.data.expiryAlertValue) : '');
    setPersonalExpiryUnit(prefs.data.expiryAlertUnit ?? 'MONTHS');
  }, [prefs.data]);

  const saveSystem = useMutation({
    mutationFn: () =>
      apiRequest('/settings', {
        method: 'PATCH',
        body: {
          organizationName: orgName,
          expiryWarningValue: Number(expiryValue),
          expiryWarningUnit: expiryUnit,
        },
      }),
    onSuccess: async () => {
      toast.push(t('settings.systemSaved'), 'success');
      await client.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (error: Error) => toast.push(error.message, 'error'),
  });

  const savePrefs = useMutation({
    mutationFn: (body: Partial<NotificationPrefs>) =>
      apiRequest<NotificationPrefs>('/users/me/notification-preferences', {
        method: 'PATCH',
        body,
      }),
    onSuccess: async () => {
      toast.push(t('profile.prefsUpdated'), 'success');
      await client.invalidateQueries({ queryKey: ['notification-prefs'] });
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

  const purge = useMutation({
    mutationFn: () =>
      apiRequest('/settings/data-purge', {
        method: 'POST',
        body: {
          confirmPhrase,
          targets,
          usersMode,
          keepUserIds: usersMode === 'delete_except' ? keepUserIds : undefined,
        },
      }),
    onSuccess: async () => {
      toast.push(t('settings.purgeSuccess'), 'success');
      setConfirmPhrase('');
      setTargets(Object.fromEntries(TARGET_KEYS.map((key) => [key, false])) as Record<TargetKey, boolean>);
      await client.invalidateQueries();
    },
    onError: (error: Error) => toast.push(error.message, 'error'),
  });

  const emDash = t('common.emDash');
  const anyTarget = useMemo(() => Object.values(targets).some(Boolean) || usersMode !== 'keep_all', [targets, usersMode]);

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

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.inventoryAlerts')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('settings.inventoryAlertsHint')}</p>

          <div className="space-y-2 rounded-md border px-3 py-3">
            <h3 className="text-sm font-medium">{t('settings.lowStockAlerts')}</h3>
            <p className="text-xs text-muted-foreground">{t('settings.lowStockAlertsHint')}</p>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>{t('profile.emailLowStock')}</span>
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={prefs.data?.emailLowStock ?? true}
                disabled={prefs.data?.emailEnabled === false}
                onChange={(e) => savePrefs.mutate({ emailLowStock: e.target.checked })}
              />
            </label>
          </div>

          <div className="space-y-2 rounded-md border px-3 py-3">
            <h3 className="text-sm font-medium">{t('settings.expiryAlerts')}</h3>
            <p className="text-xs text-muted-foreground">{t('settings.expiryAlertsHint')}</p>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>{t('profile.emailExpiringSoon')}</span>
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={prefs.data?.emailExpiringSoon ?? true}
                disabled={prefs.data?.emailEnabled === false}
                onChange={(e) => savePrefs.mutate({ emailExpiringSoon: e.target.checked })}
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>{t('profile.emailExpiredStock')}</span>
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={prefs.data?.emailExpiredStock ?? true}
                disabled={prefs.data?.emailEnabled === false}
                onChange={(e) => savePrefs.mutate({ emailExpiredStock: e.target.checked })}
              />
            </label>

            <Label className="pt-2">{t('profile.expiryAlertLead')}</Label>
            <p className="text-xs text-muted-foreground">{t('profile.expiryAlertLeadHint')}</p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={useOrgExpiryDefault}
                onChange={(e) => setUseOrgExpiryDefault(e.target.checked)}
              />
              {t('profile.useOrgDefault')}
            </label>
            {!useOrgExpiryDefault ? (
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
                <Input
                  type="number"
                  min={1}
                  value={personalExpiryValue}
                  onChange={(e) => setPersonalExpiryValue(e.target.value)}
                />
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={personalExpiryUnit}
                  onChange={(e) =>
                    setPersonalExpiryUnit(e.target.value as 'DAYS' | 'WEEKS' | 'MONTHS')
                  }
                >
                  <option value="DAYS">{t('profile.timeUnitDays')}</option>
                  <option value="WEEKS">{t('profile.timeUnitWeeks')}</option>
                  <option value="MONTHS">{t('profile.timeUnitMonths')}</option>
                </select>
              </div>
            ) : null}
            <Button
              type="button"
              size="sm"
              onClick={() =>
                savePrefs.mutate(
                  useOrgExpiryDefault
                    ? { expiryAlertValue: null, expiryAlertUnit: null }
                    : {
                        expiryAlertValue: Number(personalExpiryValue) || 1,
                        expiryAlertUnit: personalExpiryUnit,
                      },
                )
              }
              disabled={savePrefs.isPending || (!useOrgExpiryDefault && !personalExpiryValue)}
            >
              {t('profile.saveAlertPrefs')}
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
              <Input value={orgName} disabled={!canManageSystem} onChange={(e) => setOrgName(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>{t('settings.expiryWarningLead')}</Label>
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
                <Input
                  type="number"
                  min={1}
                  value={expiryValue}
                  disabled={!canManageSystem}
                  onChange={(e) => setExpiryValue(e.target.value)}
                />
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={expiryUnit}
                  disabled={!canManageSystem}
                  onChange={(e) => setExpiryUnit(e.target.value as 'DAYS' | 'WEEKS' | 'MONTHS')}
                >
                  <option value="DAYS">{t('profile.timeUnitDays')}</option>
                  <option value="WEEKS">{t('profile.timeUnitWeeks')}</option>
                  <option value="MONTHS">{t('profile.timeUnitMonths')}</option>
                </select>
              </div>
              <p className="text-xs text-muted-foreground">{t('settings.expiryWarningLeadHint')}</p>
              {system.data?.expiryWarningDays ? (
                <p className="text-xs text-muted-foreground">
                  ≈ {system.data.expiryWarningDays} {t('profile.timeUnitDays').toLowerCase()}
                </p>
              ) : null}
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
                <span className={emailStatus.data?.configured ? 'font-medium text-emerald-700' : 'font-medium text-amber-700'}>
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
                      code: emailStatus.data.lastFailure.errorCode ? ` (${emailStatus.data.lastFailure.errorCode})` : '',
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
                <Button onClick={() => sendTest.mutate()} disabled={sendTest.isPending || !testTo.trim()}>
                  {sendTest.isPending ? t('settings.sendingEmail') : t('settings.sendTestEmail')}
                </Button>
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">{t('settings.emailKeysNote')}</p>
          </CardContent>
        </Card>
      ) : null}

      {canManageSystem ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('settings.dataManagement')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('settings.dataManagementHint')}</p>
            <p className="text-xs text-muted-foreground">{t('settings.cascadeNote')}</p>
            <div>
              <Label className="mb-2 block">{t('settings.dataTargets')}</Label>
              <p className="mb-2 text-xs text-muted-foreground">{t('settings.dataKeepHint')}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {TARGET_KEYS.map((key) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={targets[key]}
                      onChange={(event) => setTargets((prev) => ({ ...prev, [key]: event.target.checked }))}
                    />
                    {t(TARGET_LABEL_KEYS[key])}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t('settings.usersMode')}</Label>
              <select
                className="h-10 w-full rounded-md border px-3 text-sm"
                value={usersMode}
                onChange={(event) => setUsersMode(event.target.value as UsersMode)}
              >
                <option value="keep_all">{t('settings.usersKeepAll')}</option>
                <option value="delete_except">{t('settings.usersDeleteExcept')}</option>
                <option value="delete_all_except_current">{t('settings.usersDeleteExceptCurrent')}</option>
              </select>
            </div>

            {usersMode === 'delete_except' && canReadUsers ? (
              <div className="space-y-2">
                <Label>{t('settings.keepUsers')}</Label>
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
                  {(users.data?.items ?? []).map((row) => {
                    const checked = keepUserIds.includes(row.id) || row.id === user?.id;
                    return (
                      <label key={row.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={row.id === user?.id}
                          onChange={(event) => {
                            setKeepUserIds((prev) =>
                              event.target.checked ? [...prev, row.id] : prev.filter((id) => id !== row.id),
                            );
                          }}
                        />
                        {row.name || `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim()} ({row.email})
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="space-y-1">
              <Label>{t('settings.confirmPhrase')}</Label>
              <Input
                value={confirmPhrase}
                onChange={(event) => setConfirmPhrase(event.target.value)}
                placeholder={t('settings.confirmPhrasePlaceholder')}
              />
            </div>

            <Button
              variant="destructive"
              disabled={purge.isPending || !anyTarget || confirmPhrase.trim().toUpperCase() !== 'DELETE'}
              onClick={() => {
                if (!window.confirm(t('settings.purgeConfirm'))) return;
                purge.mutate();
              }}
            >
              {purge.isPending ? t('settings.purging') : t('settings.purgeData')}
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
