import { Injectable, Logger } from '@nestjs/common';
import {
  LocationType,
  NotificationSeverity,
  NotificationType,
  Prisma,
  SupplyRequestStatus,
  TransferStatus,
  UserStatus,
} from '@prisma/client';
import { RoleCode } from '@mh/shared';
import { expiryWarningDate } from '../../common/access/access';
import { leadTimeToDays } from '../../common/inventory/packaging';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';

export interface AlertCondition {
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
  recipientUserIds: string[];
}

@Injectable()
export class AlertEvaluationService {
  private readonly logger = new Logger(AlertEvaluationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
  ) {}

  async evaluateAll() {
    const results: Record<string, { ok: boolean; created: number; resolved: number; error?: string }> = {};
    const runners: Array<[string, () => Promise<{ created: number; resolved: number }>]> = [
      ['lowStock', () => this.evaluateLowStock()],
      ['expiringSoon', () => this.evaluateExpiringSoon()],
      ['expiredStock', () => this.evaluateExpiredStock()],
      ['pendingSupplyRequests', () => this.evaluatePendingSupplyRequests()],
      ['transfersAwaitingReceipt', () => this.evaluateTransfersAwaitingReceipt()],
    ];

    for (const [name, runner] of runners) {
      try {
        const outcome = await runner();
        results[name] = { ok: true, ...outcome };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Alert evaluator ${name} failed: ${message}`);
        results[name] = { ok: false, created: 0, resolved: 0, error: message };
      }
    }

    try {
      await this.notifications.cleanupResolved(90);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Notification cleanup failed: ${message}`);
    }

    return results;
  }

  async evaluateLowStock() {
    const conditions: AlertCondition[] = [];

    const [whGroups, phGroups] = await Promise.all([
      this.prisma.warehouseStock.groupBy({
        by: ['warehouseId', 'medicineId'],
        _sum: { quantity: true },
      }),
      this.prisma.pharmacyStock.groupBy({
        by: ['pharmacyId', 'medicineId'],
        _sum: { quantity: true },
      }),
    ]);

    const medicineIds = [
      ...new Set([...whGroups.map((r) => r.medicineId), ...phGroups.map((r) => r.medicineId)]),
    ];
    const medicines = medicineIds.length
      ? await this.prisma.medicine.findMany({
          where: { id: { in: medicineIds }, deletedAt: null, isActive: true },
          select: { id: true, name: true, minimumStock: true },
        })
      : [];
    const medicineById = new Map(medicines.map((m) => [m.id, m]));

    const warehouseIds = [...new Set(whGroups.map((r) => r.warehouseId))];
    const pharmacyIds = [...new Set(phGroups.map((r) => r.pharmacyId))];
    const [warehouses, pharmacies] = await Promise.all([
      warehouseIds.length
        ? this.prisma.warehouse.findMany({
            where: { id: { in: warehouseIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      pharmacyIds.length
        ? this.prisma.pharmacy.findMany({
            where: { id: { in: pharmacyIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);
    const warehouseName = new Map(warehouses.map((w) => [w.id, w.name]));
    const pharmacyName = new Map(pharmacies.map((p) => [p.id, p.name]));

    const warehouseRecipients = await this.usersForRoles(
      [RoleCode.WAREHOUSE_MANAGER, RoleCode.WAREHOUSE_STAFF, RoleCode.SUPER_ADMIN],
      { warehouseScoped: true },
    );
    const pharmacyRecipients = await this.usersForRoles(
      [RoleCode.PHARMACY_MANAGER, RoleCode.PHARMACY_STAFF, RoleCode.SUPER_ADMIN],
      { pharmacyScoped: true },
    );

    for (const row of whGroups) {
      const medicine = medicineById.get(row.medicineId);
      if (!medicine) continue;
      const qty = row._sum.quantity ?? 0;
      if (qty <= 0 || qty > medicine.minimumStock) continue;
      const recipients = warehouseRecipients
        .filter((u) => !u.warehouseId || u.warehouseId === row.warehouseId || u.isSuperAdmin)
        .map((u) => u.id);
      conditions.push({
        dedupeKey: `LOW_STOCK:WAREHOUSE:${row.warehouseId}:MEDICINE:${row.medicineId}`,
        type: NotificationType.LOW_STOCK,
        title: `Low stock: ${medicine.name}`,
        message: `${medicine.name} is below the configured minimum stock level in ${warehouseName.get(row.warehouseId) ?? 'warehouse'} (${qty} ≤ ${medicine.minimumStock}).`,
        severity: NotificationSeverity.WARNING,
        entityType: 'Medicine',
        entityId: medicine.id,
        locationType: LocationType.WAREHOUSE,
        warehouseId: row.warehouseId,
        href: '/warehouse/stock',
        recipientUserIds: recipients,
      });
    }

    for (const row of phGroups) {
      const medicine = medicineById.get(row.medicineId);
      if (!medicine) continue;
      const qty = row._sum.quantity ?? 0;
      if (qty <= 0 || qty > medicine.minimumStock) continue;
      const recipients = pharmacyRecipients
        .filter((u) => !u.pharmacyId || u.pharmacyId === row.pharmacyId || u.isSuperAdmin)
        .map((u) => u.id);
      conditions.push({
        dedupeKey: `LOW_STOCK:PHARMACY:${row.pharmacyId}:MEDICINE:${row.medicineId}`,
        type: NotificationType.LOW_STOCK,
        title: `Low stock: ${medicine.name}`,
        message: `${medicine.name} is below the configured minimum stock level in ${pharmacyName.get(row.pharmacyId) ?? 'pharmacy'} (${qty} ≤ ${medicine.minimumStock}).`,
        severity: NotificationSeverity.WARNING,
        entityType: 'Medicine',
        entityId: medicine.id,
        locationType: LocationType.PHARMACY,
        pharmacyId: row.pharmacyId,
        href: '/pharmacy/stock',
        recipientUserIds: recipients,
      });
    }

    return this.syncConditions(NotificationType.LOW_STOCK, conditions);
  }

  async evaluateExpiringSoon() {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const orgWarningDays = await this.settings.getExpiryWarningDays();

    const prefs = await this.prisma.notificationPreference.findMany({
      select: { userId: true, expiryAlertValue: true, expiryAlertUnit: true },
    });
    const prefByUser = new Map(prefs.map((p) => [p.userId, p]));
    const maxPersonalDays = prefs.reduce((max, pref) => {
      if (pref.expiryAlertValue == null) return max;
      const days = leadTimeToDays(pref.expiryAlertValue, pref.expiryAlertUnit);
      return Math.max(max, days);
    }, 0);

    const medicinesWithLead = await this.prisma.medicine.findMany({
      where: { deletedAt: null, expiryAlertValue: { not: null } },
      select: { expiryAlertValue: true, expiryAlertUnit: true },
    });
    const maxItemDays = medicinesWithLead.reduce((max, med) => {
      if (med.expiryAlertValue == null) return max;
      return Math.max(max, leadTimeToDays(med.expiryAlertValue, med.expiryAlertUnit));
    }, 0);

    const warningDays = Math.max(orgWarningDays, maxPersonalDays || 0, maxItemDays || 0);
    const warning = expiryWarningDate(warningDays);
    const conditions: AlertCondition[] = [];

    const [whRows, phRows] = await Promise.all([
      this.prisma.warehouseStock.findMany({
        where: {
          quantity: { gt: 0 },
          batch: { expiryDate: { gte: today, lte: warning } },
        },
        include: {
          medicine: {
            select: {
              id: true,
              name: true,
              expiryAlertValue: true,
              expiryAlertUnit: true,
            },
          },
          batch: { select: { id: true, batchNumber: true, expiryDate: true } },
          warehouse: { select: { id: true, name: true } },
        },
      }),
      this.prisma.pharmacyStock.findMany({
        where: {
          quantity: { gt: 0 },
          batch: { expiryDate: { gte: today, lte: warning } },
        },
        include: {
          medicine: {
            select: {
              id: true,
              name: true,
              expiryAlertValue: true,
              expiryAlertUnit: true,
            },
          },
          batch: { select: { id: true, batchNumber: true, expiryDate: true } },
          pharmacy: { select: { id: true, name: true } },
        },
      }),
    ]);

    const warehouseRecipients = await this.usersForRoles(
      [RoleCode.WAREHOUSE_MANAGER, RoleCode.WAREHOUSE_STAFF, RoleCode.SUPER_ADMIN],
      { warehouseScoped: true },
    );
    const pharmacyRecipients = await this.usersForRoles(
      [RoleCode.PHARMACY_MANAGER, RoleCode.PHARMACY_STAFF, RoleCode.SUPER_ADMIN],
      { pharmacyScoped: true },
    );

    const daysUntil = (expiry: Date) =>
      Math.round((startOfDay(expiry).getTime() - today.getTime()) / 86_400_000);

    const itemWindowDays = (med: {
      expiryAlertValue: number | null;
      expiryAlertUnit: string | null;
    }) => {
      if (med.expiryAlertValue != null) {
        return leadTimeToDays(med.expiryAlertValue, med.expiryAlertUnit);
      }
      return orgWarningDays;
    };

    const recipientWindowDays = (userId: string) => {
      const pref = prefByUser.get(userId);
      if (pref?.expiryAlertValue != null) {
        return leadTimeToDays(pref.expiryAlertValue, pref.expiryAlertUnit);
      }
      return orgWarningDays;
    };

    for (const row of whRows) {
      const days = daysUntil(row.batch.expiryDate);
      const itemDays = itemWindowDays(row.medicine);
      if (days > itemDays) continue;
      const recipients = warehouseRecipients
        .filter((u) => !u.warehouseId || u.warehouseId === row.warehouseId || u.isSuperAdmin)
        .filter((u) => days <= Math.max(itemDays, recipientWindowDays(u.id)))
        .map((u) => u.id);
      if (!recipients.length) continue;
      conditions.push({
        dedupeKey: `EXPIRING_SOON:WAREHOUSE:${row.warehouseId}:${row.batchId}`,
        type: NotificationType.EXPIRING_SOON,
        title: 'Medicine batch expiring soon',
        message: `${row.medicine.name} batch ${row.batch.batchNumber} expires in ${days} days at ${row.warehouse.name}.`,
        severity: NotificationSeverity.WARNING,
        entityType: 'MedicineBatch',
        entityId: row.batchId,
        locationType: LocationType.WAREHOUSE,
        warehouseId: row.warehouseId,
        href: '/reports/expiry',
        recipientUserIds: recipients,
      });
    }

    for (const row of phRows) {
      const days = daysUntil(row.batch.expiryDate);
      const itemDays = itemWindowDays(row.medicine);
      if (days > itemDays) continue;
      const recipients = pharmacyRecipients
        .filter((u) => !u.pharmacyId || u.pharmacyId === row.pharmacyId || u.isSuperAdmin)
        .filter((u) => days <= Math.max(itemDays, recipientWindowDays(u.id)))
        .map((u) => u.id);
      if (!recipients.length) continue;
      conditions.push({
        dedupeKey: `EXPIRING_SOON:PHARMACY:${row.pharmacyId}:${row.batchId}`,
        type: NotificationType.EXPIRING_SOON,
        title: 'Medicine batch expiring soon',
        message: `${row.medicine.name} batch ${row.batch.batchNumber} expires in ${days} days at ${row.pharmacy.name}.`,
        severity: NotificationSeverity.WARNING,
        entityType: 'MedicineBatch',
        entityId: row.batchId,
        locationType: LocationType.PHARMACY,
        pharmacyId: row.pharmacyId,
        href: '/reports/expiry',
        recipientUserIds: recipients,
      });
    }

    return this.syncConditions(NotificationType.EXPIRING_SOON, conditions);
  }

  async evaluateExpiredStock() {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const conditions: AlertCondition[] = [];

    const [whRows, phRows] = await Promise.all([
      this.prisma.warehouseStock.findMany({
        where: { quantity: { gt: 0 }, batch: { expiryDate: { lt: today } } },
        include: {
          medicine: { select: { id: true, name: true } },
          batch: { select: { id: true, batchNumber: true } },
          warehouse: { select: { id: true, name: true } },
        },
      }),
      this.prisma.pharmacyStock.findMany({
        where: { quantity: { gt: 0 }, batch: { expiryDate: { lt: today } } },
        include: {
          medicine: { select: { id: true, name: true } },
          batch: { select: { id: true, batchNumber: true } },
          pharmacy: { select: { id: true, name: true } },
        },
      }),
    ]);

    const warehouseRecipients = await this.usersForRoles(
      [RoleCode.WAREHOUSE_MANAGER, RoleCode.WAREHOUSE_STAFF, RoleCode.SUPER_ADMIN],
      { warehouseScoped: true },
    );
    const pharmacyRecipients = await this.usersForRoles(
      [RoleCode.PHARMACY_MANAGER, RoleCode.PHARMACY_STAFF, RoleCode.SUPER_ADMIN],
      { pharmacyScoped: true },
    );

    for (const row of whRows) {
      conditions.push({
        dedupeKey: `EXPIRED_STOCK:WAREHOUSE:${row.warehouseId}:${row.batchId}`,
        type: NotificationType.EXPIRED_STOCK,
        title: 'Expired medicine stock',
        message: `${row.medicine.name} batch ${row.batch.batchNumber} is expired and still has ${row.quantity} units in ${row.warehouse.name}.`,
        severity: NotificationSeverity.CRITICAL,
        entityType: 'MedicineBatch',
        entityId: row.batchId,
        locationType: LocationType.WAREHOUSE,
        warehouseId: row.warehouseId,
        href: '/reports/expiry',
        recipientUserIds: warehouseRecipients
          .filter((u) => !u.warehouseId || u.warehouseId === row.warehouseId || u.isSuperAdmin)
          .map((u) => u.id),
      });
    }

    for (const row of phRows) {
      conditions.push({
        dedupeKey: `EXPIRED_STOCK:PHARMACY:${row.pharmacyId}:${row.batchId}`,
        type: NotificationType.EXPIRED_STOCK,
        title: 'Expired medicine stock',
        message: `${row.medicine.name} batch ${row.batch.batchNumber} is expired and still has ${row.quantity} units in ${row.pharmacy.name}.`,
        severity: NotificationSeverity.CRITICAL,
        entityType: 'MedicineBatch',
        entityId: row.batchId,
        locationType: LocationType.PHARMACY,
        pharmacyId: row.pharmacyId,
        href: '/reports/expiry',
        recipientUserIds: pharmacyRecipients
          .filter((u) => !u.pharmacyId || u.pharmacyId === row.pharmacyId || u.isSuperAdmin)
          .map((u) => u.id),
      });
    }

    return this.syncConditions(NotificationType.EXPIRED_STOCK, conditions);
  }

  async evaluatePendingSupplyRequests() {
    const requests = await this.prisma.supplyRequest.findMany({
      where: { status: SupplyRequestStatus.SUBMITTED },
      include: {
        pharmacy: { select: { name: true } },
        warehouse: { select: { id: true, name: true } },
      },
    });

    const warehouseRecipients = await this.usersForRoles(
      [RoleCode.WAREHOUSE_MANAGER, RoleCode.SUPER_ADMIN],
      { warehouseScoped: true },
    );

    const conditions: AlertCondition[] = requests.map((request) => ({
      dedupeKey: `PENDING_SUPPLY_REQUEST:${request.id}`,
      type: NotificationType.PENDING_SUPPLY_REQUEST,
      title: 'Supply request awaiting review',
      message: `Supply request ${request.requestNumber} from ${request.pharmacy.name} is awaiting warehouse review.`,
      severity: NotificationSeverity.INFO,
      entityType: 'SupplyRequest',
      entityId: request.id,
      locationType: LocationType.WAREHOUSE,
      warehouseId: request.warehouseId,
      href: `/warehouse/supply-requests/${request.id}`,
      recipientUserIds: warehouseRecipients
        .filter(
          (u) => !u.warehouseId || u.warehouseId === request.warehouseId || u.isSuperAdmin,
        )
        .map((u) => u.id),
    }));

    return this.syncConditions(NotificationType.PENDING_SUPPLY_REQUEST, conditions);
  }

  async evaluateTransfersAwaitingReceipt() {
    const transfers = await this.prisma.stockTransfer.findMany({
      where: {
        status: { in: [TransferStatus.SHIPPED, TransferStatus.IN_TRANSIT] },
      },
      include: {
        warehouse: { select: { name: true } },
        pharmacy: { select: { id: true, name: true } },
      },
    });

    const pharmacyRecipients = await this.usersForRoles(
      [RoleCode.PHARMACY_MANAGER, RoleCode.PHARMACY_STAFF, RoleCode.SUPER_ADMIN],
      { pharmacyScoped: true },
    );

    const conditions: AlertCondition[] = transfers.map((transfer) => ({
      dedupeKey: `TRANSFER_AWAITING_RECEIPT:${transfer.id}`,
      type: NotificationType.TRANSFER_AWAITING_RECEIPT,
      title: 'Transfer awaiting receipt',
      message: `Transfer ${transfer.transferNumber} from ${transfer.warehouse.name} is awaiting receipt at ${transfer.pharmacy.name}.`,
      severity: NotificationSeverity.INFO,
      entityType: 'StockTransfer',
      entityId: transfer.id,
      locationType: LocationType.PHARMACY,
      pharmacyId: transfer.pharmacyId,
      warehouseId: transfer.warehouseId,
      href: `/pharmacy/transfers`,
      recipientUserIds: pharmacyRecipients
        .filter(
          (u) => !u.pharmacyId || u.pharmacyId === transfer.pharmacyId || u.isSuperAdmin,
        )
        .map((u) => u.id),
    }));

    return this.syncConditions(NotificationType.TRANSFER_AWAITING_RECEIPT, conditions);
  }

  private async syncConditions(type: NotificationType, conditions: AlertCondition[]) {
    let created = 0;
    const activeKeys = new Set(conditions.map((c) => c.dedupeKey));

    for (const condition of conditions) {
      const uniqueRecipients = [...new Set(condition.recipientUserIds)];
      for (const userId of uniqueRecipients) {
        const result = await this.notifications.upsertActiveAlert({
          userId,
          dedupeKey: condition.dedupeKey,
          type: condition.type,
          title: condition.title,
          message: condition.message,
          severity: condition.severity,
          entityType: condition.entityType,
          entityId: condition.entityId,
          locationType: condition.locationType,
          warehouseId: condition.warehouseId ?? null,
          pharmacyId: condition.pharmacyId ?? null,
          href: condition.href,
        });
        if (result.created) created += 1;
      }
    }

    const resolved = await this.notifications.resolveStaleAlerts(type, [...activeKeys]);
    return { created, resolved };
  }

  private async usersForRoles(
    roleCodes: RoleCode[],
    options: { warehouseScoped?: boolean; pharmacyScoped?: boolean },
  ) {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      status: UserStatus.ACTIVE,
      userRoles: { some: { role: { code: { in: roleCodes } } } },
    };

    const users = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        pharmacyId: true,
        warehouseId: true,
        userRoles: { select: { role: { select: { code: true } } } },
      },
    });

    return users.map((user) => ({
      id: user.id,
      pharmacyId: user.pharmacyId,
      warehouseId: user.warehouseId,
      isSuperAdmin: user.userRoles.some((r) => r.role.code === RoleCode.SUPER_ADMIN),
      warehouseScoped: options.warehouseScoped,
      pharmacyScoped: options.pharmacyScoped,
    }));
  }
}

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
