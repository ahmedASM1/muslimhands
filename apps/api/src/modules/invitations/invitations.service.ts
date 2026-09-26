import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction, InvitationStatus, RoleCode, type AuthenticatedUser } from '@mh/shared';
import { UserStatus } from '@prisma/client';
import { assignmentForRole, isSuperAdmin } from '../../common/access/access';
import type { AppConfig } from '../../config/configuration';
import { PasswordService } from '../../common/crypto/password.service';
import { MailerService } from '../../common/mailer/mailer.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { evaluateInvitation } from './invitation-rules';

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly mailer: MailerService,
  ) {}

  async list(actor: AuthenticatedUser) {
    const invitations = await this.prisma.invitation.findMany({
      where: isSuperAdmin(actor) || !actor.pharmacyId ? {} : { pharmacyId: actor.pharmacyId },
      orderBy: { createdAt: 'desc' },
      include: {
        role: true,
        pharmacy: true,
        warehouse: true,
        organization: true,
        invitedBy: { select: { firstName: true, lastName: true, email: true } },
      },
    });
    return invitations.map((invitation) => this.publicInvitation(invitation));
  }

  async create(
    data: {
      email: string;
      firstName: string;
      lastName: string;
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
    if (
      !isSuperAdmin(actor) &&
      role.code !== RoleCode.PHARMACY_MANAGER &&
      role.code !== RoleCode.PHARMACY_STAFF
    ) {
      throw new ForbiddenException('Cannot invite this role');
    }

    const assignment = assignmentForRole(
      role.code as RoleCode,
      isSuperAdmin(actor) ? data.pharmacyId : actor.pharmacyId ?? data.pharmacyId,
      isSuperAdmin(actor) ? data.warehouseId : undefined,
    );

    const email = data.email.toLowerCase();
    const existing = await this.prisma.user.findFirst({
      where: { email, deletedAt: null },
    });
    if (existing && existing.status !== UserStatus.INVITED) {
      throw new BadRequestException('A user with this email already exists');
    }

    const organization = await this.prisma.organization.findFirstOrThrow({
      orderBy: { createdAt: 'asc' },
    });

    const token = randomBytes(32).toString('hex');
    const invitation = await this.prisma.$transaction(async (tx) => {
      const user =
        existing ??
        (await tx.user.create({
          data: {
            email,
            firstName: data.firstName,
            lastName: data.lastName,
            status: UserStatus.INVITED,
            organizationId: organization.id,
            pharmacyId: assignment.pharmacyId,
            warehouseId: assignment.warehouseId,
            userRoles: { create: { roleId: role.id } },
          },
        }));

      if (existing) {
        await tx.user.update({
          where: { id: existing.id },
          data: {
            firstName: data.firstName,
            lastName: data.lastName,
            status: UserStatus.INVITED,
            pharmacyId: assignment.pharmacyId,
            warehouseId: assignment.warehouseId,
          },
        });
        await tx.userRole.deleteMany({ where: { userId: existing.id } });
        await tx.userRole.create({ data: { userId: existing.id, roleId: role.id } });
        await tx.invitation.updateMany({
          where: { userId: existing.id, status: InvitationStatus.PENDING },
          data: { status: InvitationStatus.REVOKED },
        });
      }

      return tx.invitation.create({
        data: {
          email,
          firstName: data.firstName,
          lastName: data.lastName,
          organizationId: organization.id,
          roleId: role.id,
          userId: user.id,
          pharmacyId: assignment.pharmacyId,
          warehouseId: assignment.warehouseId,
          tokenHash: this.hash(token),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          invitedById: actor.id,
        },
        include: {
          role: true,
          pharmacy: true,
          warehouse: true,
          organization: true,
        },
      });
    });

    await this.audit.record({
      userId: actor.id,
      action: AuditAction.INVITE_USER,
      entityType: 'Invitation',
      entityId: invitation.id,
      newValues: { email: invitation.email, roleId: invitation.roleId },
    });

    return this.withAcceptUrl(invitation, token);
  }

  async accept(token: string, password: string) {
    const invitation = await this.prisma.invitation.findFirst({
      where: { tokenHash: this.hash(token) },
      include: { role: true, organization: true, pharmacy: true },
    });
    if (!invitation) {
      throw new NotFoundException('Invitation is invalid');
    }

    const evaluation = evaluateInvitation(invitation);
    if (!evaluation.ok) {
      if (evaluation.reason === 'expired' && invitation.status === InvitationStatus.PENDING) {
        await this.prisma.invitation.update({
          where: { id: invitation.id },
          data: { status: InvitationStatus.EXPIRED },
        });
      }
      if (evaluation.reason === 'accepted') {
        throw new BadRequestException('Invitation has already been accepted');
      }
      if (evaluation.reason === 'expired') {
        throw new BadRequestException('Invitation has expired');
      }
      throw new BadRequestException('Invitation is no longer valid');
    }

    const passwordHash = await this.passwords.hash(password);
    const user = await this.prisma.$transaction(async (tx) => {
      const existing = invitation.userId
        ? await tx.user.findUnique({ where: { id: invitation.userId } })
        : await tx.user.findFirst({ where: { email: invitation.email, deletedAt: null } });

      const saved = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: {
              passwordHash,
              status: UserStatus.ACTIVE,
              firstName: invitation.firstName,
              lastName: invitation.lastName,
              organizationId: invitation.organizationId,
              pharmacyId: invitation.pharmacyId,
              warehouseId: invitation.warehouseId,
            },
          })
        : await tx.user.create({
            data: {
              email: invitation.email,
              passwordHash,
              firstName: invitation.firstName,
              lastName: invitation.lastName,
              status: UserStatus.ACTIVE,
              organizationId: invitation.organizationId,
              pharmacyId: invitation.pharmacyId,
              warehouseId: invitation.warehouseId,
            },
          });

      await tx.userRole.deleteMany({ where: { userId: saved.id } });
      await tx.userRole.create({ data: { userId: saved.id, roleId: invitation.roleId } });
      await tx.invitation.update({
        where: { id: invitation.id },
        data: {
          status: InvitationStatus.ACCEPTED,
          acceptedAt: new Date(),
          userId: saved.id,
        },
      });
      return saved;
    });

    await this.audit.record({
      userId: user.id,
      action: AuditAction.ACCEPT_INVITATION,
      entityType: 'Invitation',
      entityId: invitation.id,
    });
    return {
      accepted: true,
      email: user.email,
      homePath:
        invitation.role.code === RoleCode.SUPER_ADMIN
          ? '/administration'
          : invitation.role.code.startsWith('WAREHOUSE')
            ? '/warehouse'
            : invitation.role.code.startsWith('PHARMACY') && invitation.pharmacy?.slug
              ? `/pharmacies/${invitation.pharmacy.slug}`
              : invitation.role.code.startsWith('PHARMACY')
                ? '/pharmacy'
                : '/reports',
      loginPath:
        invitation.role.code.startsWith('PHARMACY') && invitation.pharmacy?.slug
          ? `/pharmacies/${invitation.pharmacy.slug}/login`
          : '/login',
    };
  }

  async revoke(id: string, actor: AuthenticatedUser) {
    const invitation = await this.requireInvitation(id, actor);
    if (invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException('Only pending invitations can be revoked');
    }
    return this.publicInvitation(
      await this.prisma.invitation.update({
        where: { id },
        data: { status: InvitationStatus.REVOKED },
        include: { role: true, pharmacy: true, warehouse: true, organization: true },
      }),
    );
  }

  async preview(token: string) {
    const invitation = await this.prisma.invitation.findFirst({
      where: { tokenHash: this.hash(token) },
      include: { role: true, pharmacy: true, warehouse: true, organization: true },
    });
    if (!invitation) {
      throw new NotFoundException('Invitation is invalid');
    }
    const evaluation = evaluateInvitation(invitation);
    return {
      ...this.publicInvitation(invitation),
      valid: evaluation.ok,
      reason: evaluation.ok ? undefined : evaluation.reason,
    };
  }

  async resend(id: string, actor: AuthenticatedUser) {
    const existing = await this.requireInvitation(id, actor);
    if (existing.status !== InvitationStatus.PENDING) {
      throw new BadRequestException('Only pending invitations can be resent');
    }
    const token = randomBytes(32).toString('hex');
    const invitation = await this.prisma.invitation.update({
      where: { id },
      data: {
        tokenHash: this.hash(token),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
      include: { role: true, pharmacy: true, warehouse: true, organization: true },
    });
    return this.withAcceptUrl(invitation, token);
  }

  private async requireInvitation(id: string, actor: AuthenticatedUser) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { id },
      include: { role: true, pharmacy: true, warehouse: true, organization: true },
    });
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }
    if (!isSuperAdmin(actor) && actor.pharmacyId && invitation.pharmacyId !== actor.pharmacyId) {
      throw new ForbiddenException('Cannot manage invitations for another pharmacy');
    }
    return invitation;
  }

  private async withAcceptUrl(
    invitation: {
      email: string;
      firstName?: string;
      lastName?: string;
      expiresAt?: Date;
      userId?: string | null;
      role: { name: string };
      pharmacy?: { name: string; slug?: string } | null;
      warehouse?: { name: string } | null;
    },
    token: string,
  ) {
    const appUrl = this.config.get('appUrl', { infer: true }).replace(/\/$/, '');
    const acceptUrl = `${appUrl}/accept-invitation?token=${token}`;
    const nodeEnv = this.config.get('nodeEnv', { infer: true });
    const assignment =
      invitation.pharmacy?.name ?? invitation.warehouse?.name ?? undefined;
    const portalLoginUrl = invitation.pharmacy?.slug
      ? `${appUrl}/pharmacies/${invitation.pharmacy.slug}/login`
      : undefined;
    const mailResult = await this.mailer.sendInvitationEmail({
      to: invitation.email,
      recipientName: `${invitation.firstName ?? ''} ${invitation.lastName ?? ''}`.trim() || invitation.email,
      roleName: invitation.role.name,
      assignment,
      expiresAt: invitation.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      acceptUrl,
      portalLoginUrl,
      userId: invitation.userId ?? undefined,
    });
    return {
      ...this.publicInvitation(invitation),
      emailQueued: mailResult.delivered || mailResult.logged,
      emailLogId: mailResult.emailLogId,
      acceptUrl: nodeEnv === 'production' ? undefined : acceptUrl,
      loginPath: portalLoginUrl ? new URL(portalLoginUrl).pathname : undefined,
    };
  }

  private publicInvitation<T extends object>(invitation: T) {
    const clone = { ...(invitation as T & { tokenHash?: string }) };
    delete clone.tokenHash;
    return clone;
  }

  private hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}
