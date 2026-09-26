import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  homePathForRoles,
  RoleCode,
  type AuthenticatedUser,
  type PaginatedResult,
  type PermissionCode,
} from '@mh/shared';
import { Prisma, UserStatus } from '@prisma/client';
import { assignmentForRole, isSuperAdmin } from '../../common/access/access';
import { PasswordService } from '../../common/crypto/password.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { UsersQueryDto } from './dto/users-query.dto';

type UserWithAccess = Prisma.UserGetPayload<{
  include: {
    organization: true;
    pharmacy: true;
    warehouse: true;
    userRoles: {
      include: {
        role: {
          include: {
            rolePermissions: { include: { permission: true } };
          };
        };
      };
    };
  };
}>;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  async findByEmail(email: string) {
    return this.prisma.user.findFirst({
      where: {
        email: email.toLowerCase(),
        deletedAt: null,
      },
    });
  }

  async findActiveWithAccess(userId: string): Promise<AuthenticatedUser | null> {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        deletedAt: null,
        status: UserStatus.ACTIVE,
      },
      include: {
        organization: true,
        pharmacy: true,
        warehouse: true,
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      return null;
    }

    return this.toAuthenticatedUser(user);
  }

  markLogin(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  }

  async revokeSessions(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async list(
    query: UsersQueryDto,
    actor: AuthenticatedUser,
  ): Promise<PaginatedResult<ReturnType<UsersService['toPublicUser']>>> {
    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;
    const search = query.search?.trim();
    const scopedPharmacyId = this.scopedPharmacyId(actor, query.pharmacyId);

    const sortable: Record<string, Prisma.UserOrderByWithRelationInput> = {
      name: { firstName: query.sortOrder === 'asc' ? 'asc' : 'desc' },
      email: { email: query.sortOrder === 'asc' ? 'asc' : 'desc' },
      status: { status: query.sortOrder === 'asc' ? 'asc' : 'desc' },
      lastLoginAt: { lastLoginAt: query.sortOrder === 'asc' ? 'asc' : 'desc' },
      createdAt: { createdAt: query.sortOrder === 'asc' ? 'asc' : 'desc' },
    };

    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(scopedPharmacyId ? { pharmacyId: scopedPharmacyId } : {}),
      ...(query.warehouseId && isSuperAdmin(actor) ? { warehouseId: query.warehouseId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.department === 'warehouse' ? { warehouseId: { not: null } } : {}),
      ...(query.department === 'pharmacy' ? { pharmacyId: { not: null } } : {}),
      ...(query.department === 'administration'
        ? { pharmacyId: null, warehouseId: null }
        : {}),
      ...(query.role
        ? { userRoles: { some: { role: { code: query.role } } } }
        : {}),
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: 'insensitive' } },
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, users] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: sortable[query.sortBy ?? 'createdAt'] ?? { createdAt: 'desc' },
        include: {
          userRoles: { include: { role: true } },
          pharmacy: true,
          warehouse: true,
          invitationsReceived: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { id: true, status: true, expiresAt: true },
          },
        },
      }),
    ]);

    return {
      items: users.map((user) => this.toPublicUser(user)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getById(id: string, actor: AuthenticatedUser) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: {
        userRoles: { include: { role: true } },
        pharmacy: true,
        warehouse: true,
        organization: true,
        invitationsReceived: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, status: true, expiresAt: true },
        },
      },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    this.assertCanManageUser(actor, user.pharmacyId);
    return this.toPublicUser(user);
  }

  async create(
    data: {
      email: string;
      firstName: string;
      lastName: string;
      password: string;
      roleId: string;
      pharmacyId?: string;
      warehouseId?: string;
    },
    actor: AuthenticatedUser,
  ) {
    const role = await this.prisma.role.findUnique({ where: { id: data.roleId } });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    this.assertCanAssignRole(actor, role.code as RoleCode);

    const assignment = assignmentForRole(
      role.code as RoleCode,
      this.forcedPharmacyId(actor, data.pharmacyId),
      data.warehouseId,
    );

    const organization = await this.prisma.organization.findFirstOrThrow({
      orderBy: { createdAt: 'asc' },
    });
    const user = await this.prisma.user.create({
      data: {
        email: data.email.toLowerCase(),
        firstName: data.firstName,
        lastName: data.lastName,
        passwordHash: await this.passwords.hash(data.password),
        status: UserStatus.ACTIVE,
        organizationId: organization.id,
        pharmacyId: assignment.pharmacyId,
        warehouseId: assignment.warehouseId,
        userRoles: { create: { roleId: data.roleId } },
      },
      include: {
        userRoles: { include: { role: true } },
        pharmacy: true,
        warehouse: true,
      },
    });
    return this.toPublicUser(user);
  }

  async update(
    id: string,
    data: {
      firstName?: string;
      lastName?: string;
      status?: UserStatus;
      pharmacyId?: string | null;
      warehouseId?: string | null;
      roleId?: string;
    },
    actor: AuthenticatedUser,
  ) {
    const existing = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: { userRoles: { include: { role: true } } },
    });
    if (!existing) {
      throw new NotFoundException('User not found');
    }
    this.assertCanManageUser(actor, existing.pharmacyId);

    let assignment = {
      pharmacyId: data.pharmacyId === undefined ? existing.pharmacyId : data.pharmacyId,
      warehouseId: data.warehouseId === undefined ? existing.warehouseId : data.warehouseId,
    };
    if (data.roleId) {
      const role = await this.prisma.role.findUnique({ where: { id: data.roleId } });
      if (!role) {
        throw new NotFoundException('Role not found');
      }
      this.assertCanAssignRole(actor, role.code as RoleCode);
      assignment = assignmentForRole(
        role.code as RoleCode,
        this.forcedPharmacyId(actor, assignment.pharmacyId),
        assignment.warehouseId,
      );
      await this.prisma.userRole.deleteMany({ where: { userId: id } });
      await this.prisma.userRole.create({ data: { userId: id, roleId: data.roleId } });
    }

    const nextStatus = data.status;
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        status: nextStatus,
        pharmacyId: assignment.pharmacyId,
        warehouseId: assignment.warehouseId,
      },
      include: {
        userRoles: { include: { role: true } },
        pharmacy: true,
        warehouse: true,
        invitationsReceived: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, status: true, expiresAt: true },
        },
      },
    });

    if (nextStatus && nextStatus !== UserStatus.ACTIVE) {
      await this.revokeSessions(id);
    }

    return this.toPublicUser(user);
  }

  async updateStatus(id: string, status: UserStatus, actor: AuthenticatedUser) {
    return this.update(id, { status }, actor);
  }

  async deactivate(id: string, actor: AuthenticatedUser) {
    return this.updateStatus(id, UserStatus.INACTIVE, actor);
  }

  toAuthenticatedUser(user: UserWithAccess): AuthenticatedUser {
    const roles = user.userRoles.map((assignment) => assignment.role.code as RoleCode);
    const permissions = [
      ...new Set(
        user.userRoles.flatMap((assignment) =>
          assignment.role.rolePermissions.map(
            (rolePermission) => rolePermission.permission.code as PermissionCode,
          ),
        ),
      ),
    ];

    return {
      id: user.id,
      name: `${user.firstName} ${user.lastName}`.trim(),
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone ?? null,
      role: roles[0] ?? null,
      roles,
      permissions,
      homePath: homePathForRoles(roles, { pharmacySlug: user.pharmacy?.slug ?? null }),
      organizationId: user.organizationId,
      pharmacyId: user.pharmacyId,
      warehouseId: user.warehouseId,
      pharmacySlug: user.pharmacy?.slug ?? null,
      organization: user.organization
        ? { id: user.organization.id, name: user.organization.name, code: user.organization.code }
        : null,
      warehouse: user.warehouse
        ? { id: user.warehouse.id, name: user.warehouse.name, code: user.warehouse.code }
        : null,
      pharmacy: user.pharmacy
        ? {
            id: user.pharmacy.id,
            name: user.pharmacy.name,
            code: user.pharmacy.code,
            slug: user.pharmacy.slug,
          }
        : null,
    };
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: {
        organization: true,
        pharmacy: true,
        warehouse: true,
        userRoles: { include: { role: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return this.toPublicUser(user);
  }

  async updateMe(
    userId: string,
    data: { firstName?: string; lastName?: string; phone?: string | null },
  ) {
    const existing = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('User not found');

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.firstName !== undefined ? { firstName: data.firstName.trim() } : {}),
        ...(data.lastName !== undefined ? { lastName: data.lastName.trim() } : {}),
        ...(data.phone !== undefined
          ? { phone: data.phone?.trim() ? data.phone.trim() : null }
          : {}),
      },
      include: {
        organization: true,
        pharmacy: true,
        warehouse: true,
        userRoles: { include: { role: true } },
      },
    });

    return this.toPublicUser(user);
  }

  async getNotificationPreferences(userId: string) {
    const pref = await this.prisma.notificationPreference.upsert({
      where: { userId },
      update: {},
      create: { userId, emailEnabled: true, inAppEnabled: true, preferredLanguage: 'EN' },
    });
    return {
      emailEnabled: pref.emailEnabled,
      inAppEnabled: pref.inAppEnabled,
      preferredLanguage: pref.preferredLanguage,
      // Security emails (invitation, password reset) are always sent.
      securityEmailsAlwaysOn: true,
    };
  }

  async updateNotificationPreferences(
    userId: string,
    data: {
      emailEnabled?: boolean;
      inAppEnabled?: boolean;
      preferredLanguage?: 'EN' | 'AR';
    },
  ) {
    const pref = await this.prisma.notificationPreference.upsert({
      where: { userId },
      update: {
        ...(data.emailEnabled !== undefined ? { emailEnabled: data.emailEnabled } : {}),
        ...(data.inAppEnabled !== undefined ? { inAppEnabled: data.inAppEnabled } : {}),
        ...(data.preferredLanguage !== undefined
          ? { preferredLanguage: data.preferredLanguage }
          : {}),
      },
      create: {
        userId,
        emailEnabled: data.emailEnabled ?? true,
        inAppEnabled: data.inAppEnabled ?? true,
        preferredLanguage: data.preferredLanguage ?? 'EN',
      },
    });
    return {
      emailEnabled: pref.emailEnabled,
      inAppEnabled: pref.inAppEnabled,
      preferredLanguage: pref.preferredLanguage,
      securityEmailsAlwaysOn: true,
    };
  }


  toPublicUser(user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    phone?: string | null;
    status: UserStatus;
    organizationId: string;
    pharmacyId: string | null;
    warehouseId: string | null;
    lastLoginAt: Date | null;
    createdAt: Date;
    updatedAt?: Date;
    userRoles?: Array<{ role: { code: string; name: string } }>;
    pharmacy?: { id: string; name: string; code: string; slug: string } | null;
    warehouse?: { id: string; name: string; code: string } | null;
    organization?: { id: string; name: string; code: string } | null;
    invitationsReceived?: Array<{ id: string; status: string; expiresAt: Date }>;
  }) {
    const roles = user.userRoles?.map((assignment) => assignment.role.code) ?? [];
    return {
      id: user.id,
      name: `${user.firstName} ${user.lastName}`.trim(),
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone ?? null,
      status: user.status,
      roles,
      role: roles[0] ?? null,
      organizationId: user.organizationId,
      pharmacyId: user.pharmacyId,
      warehouseId: user.warehouseId,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      pharmacy: user.pharmacy
        ? { id: user.pharmacy.id, name: user.pharmacy.name, code: user.pharmacy.code }
        : null,
      warehouse: user.warehouse
        ? { id: user.warehouse.id, name: user.warehouse.name, code: user.warehouse.code }
        : null,
      organization: user.organization
        ? { id: user.organization.id, name: user.organization.name, code: user.organization.code }
        : undefined,
      invitation: user.invitationsReceived?.[0] ?? null,
    };
  }

  private scopedPharmacyId(actor: AuthenticatedUser, requested?: string) {
    if (isSuperAdmin(actor)) {
      return requested;
    }
    if (actor.pharmacyId) {
      if (requested && requested !== actor.pharmacyId) {
        throw new ForbiddenException('Cannot access another pharmacy');
      }
      return actor.pharmacyId;
    }
    return requested;
  }

  private forcedPharmacyId(actor: AuthenticatedUser, requested?: string | null) {
    if (isSuperAdmin(actor)) {
      return requested ?? null;
    }
    return actor.pharmacyId ?? requested ?? null;
  }

  private assertCanManageUser(actor: AuthenticatedUser, targetPharmacyId: string | null) {
    if (isSuperAdmin(actor)) {
      return;
    }
    if (actor.pharmacyId) {
      if (!targetPharmacyId || actor.pharmacyId !== targetPharmacyId) {
        throw new ForbiddenException('Cannot manage users from another pharmacy');
      }
    }
  }

  private assertCanAssignRole(actor: AuthenticatedUser, roleCode: RoleCode) {
    if (isSuperAdmin(actor)) {
      return;
    }
    if (roleCode !== RoleCode.PHARMACY_MANAGER && roleCode !== RoleCode.PHARMACY_STAFF) {
      throw new ForbiddenException('Cannot assign this role');
    }
  }
}
