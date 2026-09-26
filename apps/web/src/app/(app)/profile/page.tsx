'use client';



import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useEffect, useState } from 'react';

import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { Input } from '@/components/ui/input';

import { Label } from '@/components/ui/label';

import { useI18n } from '@/i18n';

import { apiRequest } from '@/lib/api';

import { useAuth } from '@/lib/auth-context';

import { useToast } from '@/lib/toast';



interface ProfileUser {

  id: string;

  name: string;

  email: string;

  firstName: string;

  lastName: string;

  phone?: string | null;

  role?: string | null;

  roles?: string[];

  organization?: { name: string } | null;

  pharmacy?: { name: string; code: string } | null;

  warehouse?: { name: string; code: string } | null;

}



interface NotificationPrefs {

  emailEnabled: boolean;

  inAppEnabled: boolean;

  securityEmailsAlwaysOn: boolean;

}



function formatRoleLabel(role: string, t: (key: string) => string) {

  const key = `roles.${role}`;

  const translated = t(key);

  return translated === key ? role.replaceAll('_', ' ') : translated;

}



export default function ProfilePage() {

  const { refreshUser, logout } = useAuth();

  const toast = useToast();

  const router = useRouter();

  const client = useQueryClient();

  const { t } = useI18n();



  const profile = useQuery({

    queryKey: ['users-me'],

    queryFn: () => apiRequest<ProfileUser>('/users/me'),

  });



  const prefs = useQuery({

    queryKey: ['notification-prefs'],

    queryFn: () => apiRequest<NotificationPrefs>('/users/me/notification-preferences'),

  });



  const [firstName, setFirstName] = useState('');

  const [lastName, setLastName] = useState('');

  const [phone, setPhone] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');

  const [newPassword, setNewPassword] = useState('');

  const [confirmPassword, setConfirmPassword] = useState('');



  useEffect(() => {

    if (!profile.data) return;

    setFirstName(profile.data.firstName ?? '');

    setLastName(profile.data.lastName ?? '');

    setPhone(profile.data.phone ?? '');

  }, [profile.data]);



  const saveProfile = useMutation({

    mutationFn: () =>

      apiRequest<ProfileUser>('/users/me', {

        method: 'PATCH',

        body: { firstName, lastName, phone: phone || null },

      }),

    onSuccess: async () => {

      toast.push(t('profile.updated'), 'success');

      await client.invalidateQueries({ queryKey: ['users-me'] });

      await refreshUser();

    },

    onError: (error: Error) => toast.push(error.message, 'error'),

  });



  const changePassword = useMutation({

    mutationFn: () =>

      apiRequest<{ changed: boolean; requireReLogin?: boolean }>('/auth/change-password', {

        method: 'POST',

        body: { currentPassword, newPassword, confirmPassword },

      }),

    onSuccess: async (result) => {

      toast.push(t('profile.passwordChanged'), 'success');

      setCurrentPassword('');

      setNewPassword('');

      setConfirmPassword('');

      if (result.requireReLogin) {

        await logout();

        router.replace('/login');

      }

    },

    onError: (error: Error) => toast.push(error.message, 'error'),

  });



  const savePrefs = useMutation({

    mutationFn: (body: { emailEnabled?: boolean; inAppEnabled?: boolean }) =>

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



  const emDash = t('common.emDash');

  const assignment =

    profile.data?.pharmacy?.name ?? profile.data?.warehouse?.name ?? emDash;



  const roleDisplay =

    (profile.data?.roles ?? []).map((r) => formatRoleLabel(r, t)).join(', ') ||

    (profile.data?.role ? formatRoleLabel(profile.data.role, t) : emDash);



  return (

    <div className="mx-auto max-w-3xl space-y-6">

      <div>

        <h1 className="text-2xl font-semibold">{t('profile.title')}</h1>

        <p className="text-sm text-muted-foreground">{t('profile.subtitle')}</p>

      </div>



      <Card>

        <CardHeader>

          <CardTitle>{t('profile.personalInfo')}</CardTitle>

        </CardHeader>

        <CardContent className="space-y-4">

          <div className="flex items-center gap-3">

            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary">

              {(firstName[0] ?? 'U').toUpperCase()}

              {(lastName[0] ?? '').toUpperCase()}

            </div>

            <div className="text-sm text-muted-foreground">

              <div>{t('profile.adminManagedNote')}</div>

            </div>

          </div>



          <div className="grid gap-3 md:grid-cols-2">

            <div className="grid gap-1">

              <Label htmlFor="firstName">{t('profile.firstName')}</Label>

              <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} />

            </div>

            <div className="grid gap-1">

              <Label htmlFor="lastName">{t('profile.lastName')}</Label>

              <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} />

            </div>

            <div className="grid gap-1">

              <Label htmlFor="phone">{t('profile.phone')}</Label>

              <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />

            </div>

            <div className="grid gap-1">

              <Label>{t('profile.email')}</Label>

              <Input value={profile.data?.email ?? ''} disabled />

            </div>

            <div className="grid gap-1">

              <Label>{t('profile.role')}</Label>

              <Input value={roleDisplay} disabled />

            </div>

            <div className="grid gap-1">

              <Label>{t('profile.organization')}</Label>

              <Input value={profile.data?.organization?.name ?? emDash} disabled />

            </div>

            <div className="grid gap-1 md:col-span-2">

              <Label>{t('profile.assignment')}</Label>

              <Input value={assignment} disabled />

            </div>

          </div>



          <div className="flex gap-2">

            <Button

              onClick={() => saveProfile.mutate()}

              disabled={saveProfile.isPending || profile.isLoading}

            >

              {saveProfile.isPending ? t('common.saving') : t('common.saveChanges')}

            </Button>

            <Button

              type="button"

              variant="outline"

              onClick={() => {

                if (!profile.data) return;

                setFirstName(profile.data.firstName ?? '');

                setLastName(profile.data.lastName ?? '');

                setPhone(profile.data.phone ?? '');

              }}

            >

              {t('common.cancel')}

            </Button>

          </div>

        </CardContent>

      </Card>



      <Card>

        <CardHeader>

          <CardTitle>{t('profile.passwordSecurity')}</CardTitle>

        </CardHeader>

        <CardContent className="space-y-3">

          <div className="grid gap-1">

            <Label htmlFor="currentPassword">{t('auth.currentPassword')}</Label>

            <Input

              id="currentPassword"

              type="password"

              autoComplete="current-password"

              value={currentPassword}

              onChange={(e) => setCurrentPassword(e.target.value)}

            />

          </div>

          <div className="grid gap-1">

            <Label htmlFor="newPassword">{t('auth.newPassword')}</Label>

            <Input

              id="newPassword"

              type="password"

              autoComplete="new-password"

              value={newPassword}

              onChange={(e) => setNewPassword(e.target.value)}

            />

          </div>

          <div className="grid gap-1">

            <Label htmlFor="confirmPassword">{t('auth.confirmPassword')}</Label>

            <Input

              id="confirmPassword"

              type="password"

              autoComplete="new-password"

              value={confirmPassword}

              onChange={(e) => setConfirmPassword(e.target.value)}

            />

          </div>

          <Button

            onClick={() => changePassword.mutate()}

            disabled={

              changePassword.isPending ||

              !currentPassword ||

              !newPassword ||

              !confirmPassword

            }

          >

            {changePassword.isPending ? t('profile.updatingPassword') : t('profile.changePassword')}

          </Button>

        </CardContent>

      </Card>



      <Card>

        <CardHeader>

          <CardTitle>{t('profile.notifications')}</CardTitle>

        </CardHeader>

        <CardContent className="space-y-3">

          <label className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">

            <span>

              {t('profile.inAppNotifications')}

              <span className="mt-0.5 block text-xs text-muted-foreground">{t('profile.inAppHint')}</span>

            </span>

            <input

              type="checkbox"

              className="h-4 w-4"

              checked={prefs.data?.inAppEnabled ?? true}

              onChange={(e) => savePrefs.mutate({ inAppEnabled: e.target.checked })}

            />

          </label>

          <label className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">

            <span>

              {t('profile.emailNotifications')}

              <span className="mt-0.5 block text-xs text-muted-foreground">{t('profile.emailHint')}</span>

            </span>

            <input

              type="checkbox"

              className="h-4 w-4"

              checked={prefs.data?.emailEnabled ?? true}

              onChange={(e) => savePrefs.mutate({ emailEnabled: e.target.checked })}

            />

          </label>

          <p className="text-xs text-muted-foreground">{t('profile.securityEmailsNote')}</p>

        </CardContent>

      </Card>

    </div>

  );

}

