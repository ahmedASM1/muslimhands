import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditAction } from '@mh/shared';
import { Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { ResendProvider } from '../../common/mailer/resend.provider';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const DEFAULTS = {
  expiryWarningDays: 90,
  organizationName: 'Medicine Distribution System',
};

const ALLOWED_KEYS = new Set(['expiryWarningDays', 'organizationName']);

export type DataPurgeTargets = {
  categories?: boolean;
  medicines?: boolean;
  batches?: boolean;
  warehouseStock?: boolean;
  pharmacyStock?: boolean;
  receipts?: boolean;
  supplyRequests?: boolean;
  transfers?: boolean;
  dispensing?: boolean;
  beneficiaries?: boolean;
  stockMovements?: boolean;
  notifications?: boolean;
  auditLogs?: boolean;
};

export type UsersPurgeMode = 'keep_all' | 'delete_except' | 'delete_all_except_current';

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly resend: ResendProvider,
    private readonly audit: AuditService,
  ) {}

  async get() {
    const rows = await this.prisma.appSetting.findMany({
      where: { key: { in: [...ALLOWED_KEYS] } },
    });
    const stored = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    return { ...DEFAULTS, ...stored };
  }

  async getExpiryWarningDays(): Promise<number> {
    const settings = await this.get();
    const days = Number(settings.expiryWarningDays);
    return Number.isFinite(days) && days > 0 ? days : DEFAULTS.expiryWarningDays;
  }

  async update(values: { expiryWarningDays?: number; organizationName?: string }) {
    for (const [key, value] of Object.entries(values)) {
      if (!ALLOWED_KEYS.has(key) || value === undefined) {
        continue;
      }
      const jsonValue = value as Prisma.InputJsonValue;
      await this.prisma.appSetting.upsert({
        where: { key },
        update: { value: jsonValue },
        create: { key, value: jsonValue },
      });
    }
    return this.get();
  }

  async emailStatus() {
    const mail = this.config.get('mail', { infer: true });
    const configured = this.resend.isConfigured();
    const [lastSent, lastFailed] = await Promise.all([
      this.prisma.emailLog.findFirst({
        where: { status: 'SENT' },
        orderBy: { sentAt: 'desc' },
        select: { sentAt: true, type: true, recipient: true },
      }),
      this.prisma.emailLog.findFirst({
        where: { status: 'FAILED' },
        orderBy: { failedAt: 'desc' },
        select: { failedAt: true, type: true, errorCode: true },
      }),
    ]);

    return {
      provider: 'Resend',
      status: configured ? 'Connected' : 'Not configured',
      configured,
      from: mail.from,
      fromName: mail.fromName,
      replyTo: mail.replyTo ?? null,
      lastSuccessfulEmail: lastSent
        ? { at: lastSent.sentAt, type: lastSent.type }
        : null,
      lastFailure: lastFailed
        ? { at: lastFailed.failedAt, type: lastFailed.type, errorCode: lastFailed.errorCode }
        : null,
    };
  }

  async purgeData(
    input: {
      confirmPhrase: string;
      targets: DataPurgeTargets;
      usersMode?: UsersPurgeMode;
      keepUserIds?: string[];
    },
    actorUserId: string,
  ) {
    if ((input.confirmPhrase ?? '').trim().toUpperCase() !== 'DELETE') {
      throw new BadRequestException('Type DELETE to confirm data purge');
    }

    const targets = { ...input.targets };
    const usersMode = input.usersMode ?? 'keep_all';

    // Cascade expansions so FK deletes succeed.
    if (targets.categories) {
      targets.medicines = true;
    }
    if (targets.medicines) {
      targets.batches = true;
      targets.warehouseStock = true;
      targets.pharmacyStock = true;
      targets.receipts = true;
      targets.supplyRequests = true;
      targets.transfers = true;
      targets.dispensing = true;
      targets.stockMovements = true;
    }
    if (targets.batches || targets.warehouseStock || targets.pharmacyStock) {
      targets.stockMovements = true;
      targets.receipts = true;
      targets.supplyRequests = true;
      targets.transfers = true;
      targets.dispensing = true;
    }

    const selected = Object.entries(targets).filter(([, enabled]) => enabled);
    if (!selected.length && usersMode === 'keep_all') {
      throw new BadRequestException('Select at least one data type to remove');
    }

    const counts: Record<string, number> = {};

    await this.prisma.$transaction(async (tx) => {
      if (targets.dispensing) {
        counts.dispensingItems = (await tx.dispensingItem.deleteMany({})).count;
        counts.dispensingRecords = (await tx.dispensingRecord.deleteMany({})).count;
      }
      if (targets.transfers) {
        counts.transferItems = (await tx.stockTransferItem.deleteMany({})).count;
        counts.transfers = (await tx.stockTransfer.deleteMany({})).count;
      }
      if (targets.supplyRequests) {
        counts.supplyRequestItems = (await tx.supplyRequestItem.deleteMany({})).count;
        counts.supplyRequests = (await tx.supplyRequest.deleteMany({})).count;
      }
      if (targets.receipts) {
        counts.receiptItems = (await tx.stockReceiptItem.deleteMany({})).count;
        counts.receipts = (await tx.stockReceipt.deleteMany({})).count;
      }
      if (targets.stockMovements) {
        counts.stockMovements = (await tx.stockMovement.deleteMany({})).count;
      }
      if (targets.warehouseStock) {
        counts.warehouseStock = (await tx.warehouseStock.deleteMany({})).count;
      }
      if (targets.pharmacyStock) {
        counts.pharmacyStock = (await tx.pharmacyStock.deleteMany({})).count;
      }
      if (targets.batches) {
        counts.batches = (await tx.medicineBatch.deleteMany({})).count;
      }
      if (targets.medicines) {
        counts.medicines = (await tx.medicine.deleteMany({})).count;
      }
      if (targets.categories) {
        counts.categories = (await tx.medicineCategory.deleteMany({})).count;
      }
      if (targets.beneficiaries) {
        // Beneficiaries are referenced by dispensing records.
        if (!targets.dispensing) {
          counts.dispensingItems = (await tx.dispensingItem.deleteMany({})).count;
          counts.dispensingRecords = (await tx.dispensingRecord.deleteMany({})).count;
        }
        counts.beneficiaries = (await tx.beneficiary.deleteMany({})).count;
      }
      if (targets.notifications) {
        counts.notifications = (await tx.notification.deleteMany({})).count;
      }
      if (targets.auditLogs) {
        counts.auditLogs = (await tx.auditLog.deleteMany({})).count;
      }

      if (usersMode !== 'keep_all') {
        const keepIds = new Set<string>([actorUserId, ...(input.keepUserIds ?? [])]);
        const users = await tx.user.findMany({
          where: { deletedAt: null },
          select: { id: true },
        });
        const toDelete = users.map((u) => u.id).filter((id) => !keepIds.has(id));
        if (toDelete.length) {
          await tx.refreshToken.deleteMany({ where: { userId: { in: toDelete } } });
          await tx.passwordResetToken.deleteMany({ where: { userId: { in: toDelete } } });
          await tx.userRole.deleteMany({ where: { userId: { in: toDelete } } });
          await tx.notificationPreference.deleteMany({ where: { userId: { in: toDelete } } });
          await tx.notification.deleteMany({ where: { userId: { in: toDelete } } });
          await tx.invitation.updateMany({
            where: { invitedById: { in: toDelete } },
            data: { invitedById: actorUserId },
          });
          // Soft-delete users to preserve FK history on remaining audit rows.
          counts.users = (
            await tx.user.updateMany({
              where: { id: { in: toDelete } },
              data: { deletedAt: new Date(), status: 'INACTIVE' },
            })
          ).count;
        } else {
          counts.users = 0;
        }
      }
    });

    if (!targets.auditLogs) {
      await this.audit.record({
        userId: actorUserId,
        action: AuditAction.PURGE_DATA,
        entityType: 'AppSetting',
        entityId: actorUserId,
        newValues: { targets, usersMode, counts },
      });
    }

    return { ok: true, counts, appliedTargets: targets, usersMode };
  }
}
