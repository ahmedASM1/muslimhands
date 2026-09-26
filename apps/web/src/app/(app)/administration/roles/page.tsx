'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { hasPermission } from '@/lib/permissions';

interface RoleRow {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  _count?: { userRoles: number };
  rolePermissions: Array<{ permission: { code: string; name?: string } }>;
}

export default function RolesPage() {
  const { t } = useI18n();
  const client = useQueryClient();
  const { user } = useAuth();
  const canManage = hasPermission(user, 'roles:update') && user?.roles.includes('SUPER_ADMIN' as never);
  const [editing, setEditing] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  const roles = useQuery({
    queryKey: ['roles-detail'],
    queryFn: () => apiRequest<RoleRow[]>('/roles'),
  });

  const save = useMutation({
    mutationFn: () =>
      apiRequest(`/roles/${editing}/permissions`, {
        method: 'PATCH',
        body: { permissionCodes: selected },
      }),
    onSuccess: () => {
      setEditing(null);
      client.invalidateQueries({ queryKey: ['roles-detail'] });
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t('admin.roles.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('admin.roles.subtitle')}</p>
      </div>
      <div className="space-y-3">
        {(roles.data ?? []).map((role) => {
          const codes = role.rolePermissions.map((item) => item.permission.code);
          const isEditing = editing === role.id;
          return (
            <div key={role.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{role.name}</div>
                  <div className="text-xs text-muted-foreground">{role.code}</div>
                  <p className="mt-1 text-sm text-muted-foreground">{role.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge>{t('table.usersCount', { count: role._count?.userRoles ?? 0 })}</Badge>
                  {canManage && role.code !== 'SUPER_ADMIN' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditing(role.id);
                        setSelected(codes);
                      }}
                    >
                      {t('actions.managePermissions')}
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {(isEditing ? selected : codes).map((code) => (
                  <button
                    key={code}
                    type="button"
                    disabled={!isEditing}
                    className="rounded bg-muted px-2 py-0.5 text-xs"
                    onClick={() =>
                      setSelected((current) =>
                        current.includes(code) ? current.filter((item) => item !== code) : [...current, code],
                      )
                    }
                  >
                    {code}
                  </button>
                ))}
              </div>
              {isEditing ? (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
                    {t('common.save')}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditing(null)}>
                    {t('common.cancel')}
                  </Button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
