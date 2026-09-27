import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  LocationType,
  NotificationSeverity,
  NotificationStatus,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { MailerService } from '../../common/mailer/mailer.service';
import { PrismaService } from '../../prisma/prisma.service';

export interface UpsertAlertInput {
  userId: string;
  dedupeKey: string;
  type: NotificationType;
  title: string;
  message: string;
  severity: NotificationSeverity;
  entityType?: string;
  entityId?: string;
  locationType?: LocationType;
  warehouseId?: string | null;
  pharmacyId?: string | null;
  href?: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
  ) {}

  async list(
    userId: string,
    query: PaginationQueryDto & {
      unreadOnly?: string;
      activeOnly?: string;
      severity?: string;
      type?: string;
    } = { page: 1, limit: 50 },
  ) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 50, 100);
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.unreadOnly === 'true' ? { status: NotificationStatus.UNREAD } : {}),
      ...(query.activeOnly !== 'false' ? { resolvedAt: null } : {}),
      ...(query.severity ? { severity: query.severity as NotificationSeverity } : {}),
      ...(query.type ? { type: query.type as NotificationType } : {}),
    };

    const [total, unreadCount, items] = await this.prisma.$transaction([
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({
        where: { userId, status: NotificationStatus.UNREAD, resolvedAt: null },
      }),
      this.prisma.notification.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      }),
    ]);

    return {
      unreadCount,
      items: items.map((item) => this.toDto(item)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async unreadCount(userId: string) {
    const count = await this.prisma.notification.count({
      where: { userId, status: NotificationStatus.UNREAD, resolvedAt: null },
    });
    return { unreadCount: count };
  }

  async get(id: string, userId: string) {
    const item = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!item) throw new NotFoundException('Notification not found');
    return this.toDto(item);
  }

  async markRead(id: string, userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { status: NotificationStatus.READ, readAt: new Date() },
    });
    if (result.count === 0) {
      throw new NotFoundException('Notification not found');
    }
    return this.get(id, userId);
  }

  async markAllRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, status: NotificationStatus.UNREAD, resolvedAt: null },
      data: { status: NotificationStatus.READ, readAt: new Date() },
    });
    return { updated: result.count };
  }

  async summary(userId: string) {
    // Dashboard banner counts unread active alerts so "Mark all read" clears it.
    const unreadWhere: Prisma.NotificationWhereInput = {
      userId,
      resolvedAt: null,
      status: NotificationStatus.UNREAD,
    };
    const [active, unread, critical, byType] = await Promise.all([
      this.prisma.notification.count({ where: { userId, resolvedAt: null } }),
      this.prisma.notification.count({ where: unreadWhere }),
      this.prisma.notification.count({
        where: {
          ...unreadWhere,
          severity: NotificationSeverity.CRITICAL,
        },
      }),
      this.prisma.notification.groupBy({
        by: ['type'],
        where: unreadWhere,
        _count: true,
      }),
    ]);

    const counts = Object.fromEntries(byType.map((row) => [row.type, row._count]));
    return {
      active,
      unread,
      critical,
      lowStock:
        (counts[NotificationType.LOW_STOCK] ?? 0) +
        (counts[NotificationType.OUT_OF_STOCK] ?? 0),
      expiringSoon: counts[NotificationType.EXPIRING_SOON] ?? 0,
      expiredStock: counts[NotificationType.EXPIRED_STOCK] ?? 0,
      pendingSupplyRequests: counts[NotificationType.PENDING_SUPPLY_REQUEST] ?? 0,
      transfersAwaitingReceipt: counts[NotificationType.TRANSFER_AWAITING_RECEIPT] ?? 0,
    };
  }

  /**
   * Upsert an active alert for one user.
   * Unique partial index on (userId, dedupeKey) WHERE resolvedAt IS NULL.
   * New conditions create UNREAD; existing active alerts keep their read status
   * unless we are recreating after resolve.
   */
  async upsertActiveAlert(input: UpsertAlertInput): Promise<{ created: boolean }> {
    const existing = await this.prisma.notification.findFirst({
      where: {
        userId: input.userId,
        dedupeKey: input.dedupeKey,
        resolvedAt: null,
      },
    });

    if (existing) {
      await this.prisma.notification.update({
        where: { id: existing.id },
        data: {
          title: input.title,
          message: input.message,
          severity: input.severity,
          href: input.href,
          entityType: input.entityType,
          entityId: input.entityId,
          locationType: input.locationType,
          warehouseId: input.warehouseId,
          pharmacyId: input.pharmacyId,
        },
      });
      return { created: false };
    }

    try {
      const created = await this.prisma.notification.create({
        data: {
          userId: input.userId,
          dedupeKey: input.dedupeKey,
          type: input.type,
          title: input.title,
          message: input.message,
          severity: input.severity,
          status: NotificationStatus.UNREAD,
          entityType: input.entityType,
          entityId: input.entityId,
          locationType: input.locationType,
          warehouseId: input.warehouseId,
          pharmacyId: input.pharmacyId,
          href: input.href,
        },
      });
      void this.mailer
        .sendNotificationEmail({
          notificationId: created.id,
          userId: created.userId ?? input.userId,
          type: String(created.type ?? input.type),
          title: created.title ?? input.title,
          message: created.message ?? input.message,
          href: created.href ?? input.href,
        })
        .catch(() => undefined);
      return { created: true };
    } catch (error) {
      // Concurrent insert race — treat as existing.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return { created: false };
      }
      throw error;
    }
  }

  async resolveByDedupeKey(dedupeKey: string) {
    const result = await this.prisma.notification.updateMany({
      where: { dedupeKey, resolvedAt: null },
      data: {
        resolvedAt: new Date(),
        status: NotificationStatus.READ,
        readAt: new Date(),
      },
    });
    return result.count;
  }

  async resolveStaleAlerts(type: NotificationType, activeDedupeKeys: string[]) {
    const result = await this.prisma.notification.updateMany({
      where: {
        type,
        resolvedAt: null,
        dedupeKey: { not: null, ...(activeDedupeKeys.length ? { notIn: activeDedupeKeys } : {}) },
      },
      data: { resolvedAt: new Date() },
    });
    return result.count;
  }

  async cleanupResolved(retentionDays = 90) {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
    const result = await this.prisma.notification.deleteMany({
      where: {
        resolvedAt: { not: null, lt: cutoff },
      },
    });
    return result.count;
  }

  async notifyRole(
    roleCode: string,
    input: {
      type: keyof typeof NotificationType | NotificationType;
      title: string;
      message: string;
      entityType?: string;
      entityId?: string;
      severity?: NotificationSeverity;
      dedupeKey?: string;
      href?: string;
      warehouseId?: string | null;
      pharmacyId?: string | null;
    },
  ) {
    return this.notifyRoles([roleCode], input);
  }

  /**
   * Notify users holding any of the given roles.
   * SUPER_ADMIN always receives operational alerts.
   * When warehouseId/pharmacyId is set, location-scoped users outside that location are skipped
   * (SUPER_ADMIN and unscoped users still receive).
   */
  async notifyRoles(
    roleCodes: string[],
    input: {
      type: keyof typeof NotificationType | NotificationType;
      title: string;
      message: string;
      entityType?: string;
      entityId?: string;
      severity?: NotificationSeverity;
      dedupeKey?: string;
      href?: string;
      warehouseId?: string | null;
      pharmacyId?: string | null;
    },
  ) {
    const codes = [...new Set([...roleCodes, 'SUPER_ADMIN'])];
    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        userRoles: { some: { role: { code: { in: codes } } } },
      },
      select: {
        id: true,
        warehouseId: true,
        pharmacyId: true,
        userRoles: { select: { role: { select: { code: true } } } },
        notificationPreference: { select: { inAppEnabled: true } },
      },
    });
    if (users.length === 0) return { notified: 0 };

    const recipients = users.filter((user) => {
      if (user.notificationPreference?.inAppEnabled === false) return false;
      const isSuperAdmin = user.userRoles.some((r) => r.role.code === 'SUPER_ADMIN');
      if (isSuperAdmin) return true;
      if (input.warehouseId && user.warehouseId && user.warehouseId !== input.warehouseId) {
        return false;
      }
      if (input.pharmacyId && user.pharmacyId && user.pharmacyId !== input.pharmacyId) {
        return false;
      }
      return true;
    });

    let notified = 0;
    if (input.dedupeKey) {
      for (const user of recipients) {
        const result = await this.upsertActiveAlert({
          userId: user.id,
          dedupeKey: input.dedupeKey,
          type: input.type as NotificationType,
          title: input.title,
          message: input.message,
          severity: input.severity ?? NotificationSeverity.INFO,
          entityType: input.entityType,
          entityId: input.entityId,
          href: input.href,
          warehouseId: input.warehouseId,
          pharmacyId: input.pharmacyId,
        });
        if (result.created) notified += 1;
        else notified += 1; // existing active alert still counts as delivered
      }
      return { notified };
    }

    if (recipients.length === 0) return { notified: 0 };
    await this.prisma.notification.createMany({
      data: recipients.map((user) => ({
        userId: user.id,
        type: input.type as NotificationType,
        title: input.title,
        message: input.message,
        severity: input.severity ?? NotificationSeverity.INFO,
        entityType: input.entityType,
        entityId: input.entityId,
        href: input.href,
        warehouseId: input.warehouseId,
        pharmacyId: input.pharmacyId,
      })),
    });
    return { notified: recipients.length };
  }

  notifyUser(
    userId: string,
    input: {
      type: NotificationType;
      title: string;
      message: string;
      entityType?: string;
      entityId?: string;
      severity?: NotificationSeverity;
    },
  ) {
    return this.prisma.notification.create({
      data: {
        userId,
        type: input.type,
        title: input.title,
        message: input.message,
        severity: input.severity ?? NotificationSeverity.INFO,
        entityType: input.entityType,
        entityId: input.entityId,
      },
    });
  }

  assertOwn(userId: string, notificationUserId: string) {
    if (userId !== notificationUserId) {
      throw new ForbiddenException('Cannot access another user\'s notification');
    }
  }

  private toDto(item: {
    id: string;
    type: NotificationType;
    title: string;
    message: string;
    severity: NotificationSeverity;
    status: NotificationStatus;
    entityType: string | null;
    entityId: string | null;
    locationType: LocationType | null;
    warehouseId: string | null;
    pharmacyId: string | null;
    dedupeKey: string | null;
    href: string | null;
    createdAt: Date;
    updatedAt: Date;
    readAt: Date | null;
    resolvedAt: Date | null;
    expiresAt: Date | null;
  }) {
    return {
      id: item.id,
      type: item.type,
      title: item.title,
      message: item.message,
      severity: item.severity,
      status: item.status,
      isRead: item.status === NotificationStatus.READ || Boolean(item.readAt),
      isActive: item.resolvedAt == null,
      entityType: item.entityType,
      entityId: item.entityId,
      locationType: item.locationType,
      warehouseId: item.warehouseId,
      pharmacyId: item.pharmacyId,
      dedupeKey: item.dedupeKey,
      href: item.href,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      readAt: item.readAt,
      resolvedAt: item.resolvedAt,
      expiresAt: item.expiresAt,
    };
  }
}
