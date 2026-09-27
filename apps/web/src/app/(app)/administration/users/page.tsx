'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useI18n } from '@/i18n';
import { apiRequest, ApiClientError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { hasPermission } from '@/lib/permissions';
import { useToast } from '@/lib/toast';

interface RoleOption {
  id: string;
  code: string;
  name: string;
}

interface Assignment {
  id: string;
  name: string;
  code: string;
  slug?: string;
}

interface UserRow {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string | null;
  roles: string[];
  status: string;
  pharmacy: Assignment | null;
  warehouse: Assignment | null;
  invitation: { id: string; status: string; expiresAt: string } | null;
  lastLoginAt: string | null;
  createdAt: string;
}

const warehouseRoles = new Set(['WAREHOUSE_MANAGER', 'WAREHOUSE_STAFF']);
const pharmacyRoles = new Set(['PHARMACY_MANAGER', 'PHARMACY_STAFF']);

function codeLabel(t: (key: string) => string, prefix: string, code: string) {
  const key = `${prefix}.${code}`;
  const label = t(key);
  return label !== key ? label : code.replaceAll('_', ' ');
}

export default function UsersPage() {
  const { t } = useI18n();
  const client = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const canInvite = hasPermission(user, 'invitations:create');
  const canUpdate = hasPermission(user, 'users:update');

  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [department, setDepartment] = useState('');
  const [pharmacyId, setPharmacyId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [selected, setSelected] = useState<UserRow | null>(null);
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    roleId: '',
    pharmacyId: '',
    warehouseId: '',
  });

  const tableHeaders = useMemo(
    () => [
      t('table.name'),
      t('table.email'),
      t('table.role'),
      t('table.assignment'),
      t('table.status'),
      t('table.invitation'),
      t('table.lastLogin'),
      t('table.actions'),
    ],
    [t],
  );

  const query = useMemo(() => {
    const params = new URLSearchParams({ limit: '50', sortBy: 'createdAt', sortOrder: 'desc' });
    if (search) params.set('search', search);
    if (role) params.set('role', role);
    if (status) params.set('status', status);
    if (department) params.set('department', department);
    if (pharmacyId) params.set('pharmacyId', pharmacyId);
    if (warehouseId) params.set('warehouseId', warehouseId);
    return `/users?${params.toString()}`;
  }, [search, role, status, department, pharmacyId, warehouseId]);

  const users = useQuery({
    queryKey: ['users', query],
    queryFn: () => apiRequest<UserRow[]>(query),
  });
  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: () => apiRequest<RoleOption[]>('/roles'),
  });
  const pharmacies = useQuery({
    queryKey: ['pharmacies'],
    queryFn: () => apiRequest<Assignment[]>('/pharmacies'),
  });
  const warehouses = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => apiRequest<Assignment[]>('/warehouses'),
    enabled: hasPermission(user, 'warehouses:read'),
  });

  const selectedRole = (roles.data ?? []).find((item) => item.id === form.roleId);
  const needsPharmacy = Boolean(selectedRole && pharmacyRoles.has(selectedRole.code));
  const needsWarehouse = Boolean(selectedRole && warehouseRoles.has(selectedRole.code));
  const selectedPharmacy = (pharmacies.data ?? []).find((item) => item.id === form.pharmacyId);

  const invite = useMutation({
    mutationFn: () => {
      if (!form.roleId) throw new Error(t('admin.users.selectRoleError'));
      if (needsPharmacy && !form.pharmacyId) throw new Error(t('admin.users.selectPharmacyError'));
      if (needsWarehouse && !form.warehouseId) throw new Error(t('admin.users.selectWarehouseError'));
      return apiRequest<{
        acceptUrl?: string;
        emailQueued?: boolean;
        loginPath?: string;
        email?: string;
      }>('/invitations', {
        method: 'POST',
        body: {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim().toLowerCase(),
          roleId: form.roleId,
          pharmacyId: form.pharmacyId || undefined,
          warehouseId: form.warehouseId || undefined,
        },
      });
    },
    onSuccess: (data) => {
      setInviteOpen(false);
      setForm({ firstName: '', lastName: '', email: '', roleId: '', pharmacyId: '', warehouseId: '' });
      client.invalidateQueries({ queryKey: ['users'] });
      if (data.emailQueued) {
        toast.push(t('toasts.invitationCreatedResend', { email: data.email ?? 'recipient' }));
      } else {
        toast.push(t('toasts.invitationCreatedQueued'));
      }
      if (data.acceptUrl) {
        window.prompt(t('toasts.invitationPromptAccept'), data.acceptUrl);
      }
      if (data.loginPath) {
        toast.push(t('toasts.pharmacyLoginPath', { path: data.loginPath }));
      }
    },
    onError: (error) => {
      toast.push(error instanceof Error ? error.message : t('toasts.invitationFailed'), 'error');
    },
  });

  const deactivate = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/users/${id}/status`, { method: 'PATCH', body: { status: 'INACTIVE' } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['users'] }),
  });

  const resend = useMutation({
    mutationFn: (id: string) =>
      apiRequest<{ acceptUrl?: string; emailQueued?: boolean }>(`/invitations/${id}/resend`, {
        method: 'POST',
      }),
    onSuccess: (data) => {
      client.invalidateQueries({ queryKey: ['users'] });
      toast.push(data.emailQueued ? t('toasts.invitationQueuedResend') : t('toasts.invitationResent'));
      if (data.acceptUrl) window.prompt(t('toasts.invitationPromptResend'), data.acceptUrl);
    },
    onError: (error) => {
      toast.push(error instanceof Error ? error.message : t('toasts.resendFailed'), 'error');
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => apiRequest(`/invitations/${id}/revoke`, { method: 'POST' }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['users'] });
      toast.push(t('toasts.invitationRevoked'));
    },
  });

  const rows = users.data ?? [];

  function formatRoles(row: UserRow) {
    const codes = row.role ? [row.role] : row.roles;
    return codes.map((code) => codeLabel(t, 'roles', code)).join(', ') || t('common.emDash');
  }

  function formatAssignment(row: UserRow) {
    return row.pharmacy?.name ?? row.warehouse?.name ?? t('common.organizationLevel');
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[#12304A]">{t('admin.users.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('admin.users.subtitle')}</p>
        </div>
        {canInvite ? (
          <Button className="bg-[#008DB5] hover:bg-[#006F91]" onClick={() => setInviteOpen(true)}>
            {t('actions.inviteEmployee')}
          </Button>
        ) : null}
      </div>

      {inviteOpen ? (
        <Card className="border-[#B6E0EC] shadow-card">
          <CardHeader className="border-b border-[#E7F7FB] bg-[#F0F9FC]">
            <CardTitle className="text-[#12304A]">{t('admin.users.inviteTitle')}</CardTitle>
            <CardDescription>{t('admin.users.inviteDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
      <form
              className="grid gap-4 md:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
          invite.mutate();
        }}
      >
              <div className="space-y-1.5">
                <Label className="text-[#12304A]">{t('profile.firstName')}</Label>
                <Input
                  className="h-11 rounded-xl border-[#B6E0EC] bg-[#F8FCFE]"
                  value={form.firstName}
                  onChange={(event) => setForm({ ...form, firstName: event.target.value })}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[#12304A]">{t('profile.lastName')}</Label>
                <Input
                  className="h-11 rounded-xl border-[#B6E0EC] bg-[#F8FCFE]"
                  value={form.lastName}
                  onChange={(event) => setForm({ ...form, lastName: event.target.value })}
                  required
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label className="text-[#12304A]">{t('admin.users.emailInvitationLabel')}</Label>
                <Input
                  type="email"
                  className="h-11 rounded-xl border-[#B6E0EC] bg-[#F8FCFE]"
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[#12304A]">{t('table.role')}</Label>
                <select
                  className="h-11 w-full rounded-xl border border-[#B6E0EC] bg-[#F8FCFE] px-3 text-sm"
                  value={form.roleId}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      roleId: event.target.value,
                      pharmacyId: '',
                      warehouseId: '',
                    })
                  }
                  required
                >
                  <option value="">{t('common.selectRole')}</option>
                  {(roles.data ?? []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {t('admin.users.roleOption', { name: item.name, code: item.code })}
                    </option>
                  ))}
                </select>
              </div>

              {needsWarehouse ? (
                <div className="space-y-1.5">
                  <Label className="text-[#12304A]">{t('profile.warehouse')}</Label>
                  <select
                    className="h-11 w-full rounded-xl border border-[#B6E0EC] bg-[#F8FCFE] px-3 text-sm"
                    value={form.warehouseId}
                    onChange={(event) => setForm({ ...form, warehouseId: event.target.value })}
                    required
                  >
                    <option value="">{t('common.selectWarehouse')}</option>
                    {(warehouses.data ?? []).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {needsPharmacy ? (
                <div className="space-y-1.5">
                  <Label className="text-[#12304A]">{t('profile.pharmacy')}</Label>
                  <select
                    className="h-11 w-full rounded-xl border border-[#B6E0EC] bg-[#F8FCFE] px-3 text-sm"
                    value={form.pharmacyId}
                    onChange={(event) => setForm({ ...form, pharmacyId: event.target.value })}
                    required
                  >
                    <option value="">{t('common.selectPharmacy')}</option>
                    {(pharmacies.data ?? []).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} ({item.code})
                      </option>
                    ))}
                  </select>
                  {selectedPharmacy?.slug ? (
                    <p className="text-xs text-[#008DB5]">
                      {t('auth.pharmacyLoginAfterAccept', { slug: selectedPharmacy.slug })}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {!needsPharmacy && !needsWarehouse && selectedRole ? (
                <p className="text-sm text-muted-foreground md:col-span-2">{t('admin.users.orgLevelHint')}</p>
              ) : null}

              {invite.error ? (
                <p className="text-sm text-destructive md:col-span-2">
                  {invite.error instanceof ApiClientError
                    ? invite.error.message
                    : (invite.error as Error).message}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2 md:col-span-2">
                <Button
                  type="submit"
                  className="bg-[#008DB5] hover:bg-[#006F91]"
                  disabled={invite.isPending}
                >
                  {invite.isPending ? t('actions.sendingInvitation') : t('actions.sendInvitationEmail')}
                </Button>
                <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>
                  {t('common.cancel')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-2 md:grid-cols-6">
        <Input
          placeholder={t('common.search')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select className="h-10 rounded-md border px-3 text-sm" value={role} onChange={(event) => setRole(event.target.value)}>
          <option value="">{t('table.role')}</option>
          {(roles.data ?? []).map((item) => (
            <option key={item.id} value={item.code}>
              {codeLabel(t, 'roles', item.code)}
            </option>
          ))}
        </select>
        <select className="h-10 rounded-md border px-3 text-sm" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">{t('table.status')}</option>
          {['INVITED', 'ACTIVE', 'INACTIVE', 'SUSPENDED'].map((item) => (
            <option key={item} value={item}>
              {codeLabel(t, 'status', item)}
            </option>
          ))}
        </select>
        <select
          className="h-10 rounded-md border px-3 text-sm"
          value={department}
          onChange={(event) => setDepartment(event.target.value)}
        >
          <option value="">{t('common.department')}</option>
          <option value="administration">{t('admin.users.departmentAdministration')}</option>
          <option value="warehouse">{t('admin.users.departmentWarehouse')}</option>
          <option value="pharmacy">{t('admin.users.departmentPharmacy')}</option>
        </select>
        <select
          className="h-10 rounded-md border px-3 text-sm"
          value={pharmacyId}
          onChange={(event) => setPharmacyId(event.target.value)}
        >
          <option value="">{t('profile.pharmacy')}</option>
          {(pharmacies.data ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select
          className="h-10 rounded-md border px-3 text-sm"
          value={warehouseId}
          onChange={(event) => setWarehouseId(event.target.value)}
        >
          <option value="">{t('profile.warehouse')}</option>
          {(warehouses.data ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>

      {users.error ? <p className="text-sm text-destructive">{(users.error as Error).message}</p> : null}

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              {tableHeaders.map((header) => (
                <th key={header} className="px-3 py-2 font-medium">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="px-3 py-2">{row.name}</td>
                <td className="px-3 py-2">{row.email}</td>
                <td className="px-3 py-2">{formatRoles(row)}</td>
                <td className="px-3 py-2">{formatAssignment(row)}</td>
                <td className="px-3 py-2">
                  <Badge>{codeLabel(t, 'status', row.status)}</Badge>
                </td>
                <td className="px-3 py-2">
                  {row.invitation?.status ? codeLabel(t, 'status', row.invitation.status) : t('common.emDash')}
                </td>
                <td className="px-3 py-2">
                  {row.lastLoginAt ? String(row.lastLoginAt).slice(0, 16) : t('common.emDash')}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" variant="outline" onClick={() => setSelected(row)}>
                      {t('actions.view')}
                    </Button>
                    {canUpdate && row.status === 'ACTIVE' ? (
                      <Button size="sm" variant="outline" onClick={() => deactivate.mutate(row.id)}>
                        {t('actions.deactivate')}
                      </Button>
                    ) : null}
                    {canInvite && row.invitation?.status === 'PENDING' ? (
                      <>
                        <Button size="sm" variant="outline" onClick={() => resend.mutate(row.invitation!.id)}>
                          {t('actions.resendInvitation')}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => revoke.mutate(row.invitation!.id)}>
                          {t('actions.revokeInvitation')}
                        </Button>
                      </>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && !users.isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">{t('admin.users.empty')}</p>
        ) : null}
      </div>

      {selected ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('admin.users.employeeDetail')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>
              <strong>{t('table.name')}:</strong> {selected.name}
            </p>
            <p>
              <strong>{t('table.email')}:</strong> {selected.email}
            </p>
            <p>
              <strong>{t('table.role')}:</strong> {formatRoles(selected)}
            </p>
            <p>
              <strong>{t('table.status')}:</strong> {codeLabel(t, 'status', selected.status)}
            </p>
            <p>
              <strong>{t('table.assignment')}:</strong> {formatAssignment(selected)}
            </p>
            <p>
              <strong>{t('admin.users.lastLoginLabel')}</strong>{' '}
              {selected.lastLoginAt ? String(selected.lastLoginAt).slice(0, 19) : t('common.never')}
            </p>
            {selected.pharmacy?.slug ? (
              <p>
                <strong>{t('admin.users.pharmacyLoginLabel')}</strong>{' '}
                <a className="text-[#008DB5] underline" href={`/pharmacies/${selected.pharmacy.slug}/login`}>
                  /pharmacies/{selected.pharmacy.slug}/login
                </a>
              </p>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => setSelected(null)}>
              {t('common.close')}
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
