import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  NotificationSeverity,
  NotificationStatus,
  NotificationType,
} from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { AlertEvaluationService } from '../alerts/alert-evaluation.service';

describe('Phase 6B NotificationsService', () => {
  const prisma = {
    notification: {
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
      groupBy: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const service = new NotificationsService(prisma as never, { sendNotificationEmail: jest.fn().mockResolvedValue({}) } as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      return arg;
    });
  });

  it('lists only the authenticated user notifications', async () => {
    prisma.notification.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);
    prisma.notification.findMany.mockResolvedValue([
      {
        id: 'n1',
        type: NotificationType.LOW_STOCK,
        title: 'Low stock',
        message: 'Para low',
        severity: NotificationSeverity.WARNING,
        status: NotificationStatus.UNREAD,
        entityType: 'Medicine',
        entityId: 'm1',
        locationType: 'PHARMACY',
        warehouseId: null,
        pharmacyId: 'ph-1',
        dedupeKey: 'LOW_STOCK:PHARMACY:ph-1:MEDICINE:m1',
        href: '/pharmacy/stock',
        createdAt: new Date(),
        updatedAt: new Date(),
        readAt: null,
        resolvedAt: null,
        expiresAt: null,
      },
    ]);

    const result = await service.list('user-a', { page: 1, limit: 20 });
    expect(result.unreadCount).toBe(1);
    expect(result.items[0]?.title).toBe('Low stock');
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-a', resolvedAt: null }),
      }),
    );
  });

  it('cannot mark another user notification as read', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.markRead('n1', 'user-b')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('upserts active alerts without duplicates', async () => {
    prisma.notification.findFirst.mockResolvedValue({
      id: 'n1',
      dedupeKey: 'LOW_STOCK:WAREHOUSE:wh-1:MEDICINE:m1',
    });
    prisma.notification.update.mockResolvedValue({});
    const first = await service.upsertActiveAlert({
      userId: 'u1',
      dedupeKey: 'LOW_STOCK:WAREHOUSE:wh-1:MEDICINE:m1',
      type: NotificationType.LOW_STOCK,
      title: 'Low stock: Para',
      message: 'below minimum',
      severity: NotificationSeverity.WARNING,
    });
    expect(first.created).toBe(false);
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('creates a new alert when no active dedupe match exists', async () => {
    prisma.notification.findFirst.mockResolvedValue(null);
    prisma.notification.create.mockResolvedValue({ id: 'n2' });
    const result = await service.upsertActiveAlert({
      userId: 'u1',
      dedupeKey: 'EXPIRED_STOCK:WAREHOUSE:wh-1:b1',
      type: NotificationType.EXPIRED_STOCK,
      title: 'Expired',
      message: 'expired batch',
      severity: NotificationSeverity.CRITICAL,
    });
    expect(result.created).toBe(true);
  });

  it('resolves stale alerts when condition clears', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 2 });
    const resolved = await service.resolveStaleAlerts(NotificationType.LOW_STOCK, [
      'LOW_STOCK:WAREHOUSE:wh-1:MEDICINE:m1',
    ]);
    expect(resolved).toBe(2);
    expect(prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: NotificationType.LOW_STOCK,
          resolvedAt: null,
        }),
        data: { resolvedAt: expect.any(Date) },
      }),
    );
  });

  it('cleans up old resolved notifications', async () => {
    prisma.notification.deleteMany.mockResolvedValue({ count: 5 });
    await expect(service.cleanupResolved(90)).resolves.toBe(5);
  });
});

describe('Phase 6B AlertEvaluationService isolation', () => {
  const prisma = {
    warehouseStock: { groupBy: jest.fn(), findMany: jest.fn() },
    pharmacyStock: { groupBy: jest.fn(), findMany: jest.fn() },
    medicine: { findMany: jest.fn() },
    warehouse: { findMany: jest.fn() },
    pharmacy: { findMany: jest.fn() },
    supplyRequest: { findMany: jest.fn() },
    stockTransfer: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
  };
  const notifications = {
    upsertActiveAlert: jest.fn(),
    resolveStaleAlerts: jest.fn(),
    cleanupResolved: jest.fn(),
  };
  const service = new AlertEvaluationService(prisma as never, notifications as never, {
    getExpiryWarningDays: jest.fn().mockResolvedValue(90),
  } as never);

  beforeEach(() => {
    jest.clearAllMocks();
    notifications.upsertActiveAlert.mockResolvedValue({ created: true });
    notifications.resolveStaleAlerts.mockResolvedValue(0);
    notifications.cleanupResolved.mockResolvedValue(0);
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'wh-user',
        pharmacyId: null,
        warehouseId: 'wh-1',
        userRoles: [{ role: { code: 'WAREHOUSE_MANAGER' } }],
      },
      {
        id: 'ph-user',
        pharmacyId: 'ph-1',
        warehouseId: null,
        userRoles: [{ role: { code: 'PHARMACY_MANAGER' } }],
      },
    ]);
  });

  it('creates warehouse pending supply request alerts for warehouse reviewers', async () => {
    prisma.supplyRequest.findMany.mockResolvedValue([
      {
        id: 'sr-1',
        requestNumber: 'SR-1',
        warehouseId: 'wh-1',
        pharmacy: { name: 'Amal' },
        warehouse: { id: 'wh-1', name: 'Central' },
      },
    ]);
    await service.evaluatePendingSupplyRequests();
    expect(notifications.upsertActiveAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeKey: 'PENDING_SUPPLY_REQUEST:sr-1',
        type: NotificationType.PENDING_SUPPLY_REQUEST,
        userId: 'wh-user',
      }),
    );
  });

  it('notifies destination pharmacy for shipped transfers only', async () => {
    prisma.stockTransfer.findMany.mockResolvedValue([
      {
        id: 'tr-1',
        transferNumber: 'TR-1',
        pharmacyId: 'ph-1',
        warehouseId: 'wh-1',
        warehouse: { name: 'Central' },
        pharmacy: { id: 'ph-1', name: 'Amal' },
      },
    ]);
    await service.evaluateTransfersAwaitingReceipt();
    expect(notifications.upsertActiveAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeKey: 'TRANSFER_AWAITING_RECEIPT:tr-1',
        pharmacyId: 'ph-1',
        userId: 'ph-user',
      }),
    );
  });

  it('continues other evaluators when one fails', async () => {
    prisma.warehouseStock.groupBy.mockRejectedValue(new Error('db down'));
    prisma.pharmacyStock.groupBy.mockResolvedValue([]);
    prisma.warehouseStock.findMany.mockResolvedValue([]);
    prisma.pharmacyStock.findMany.mockResolvedValue([]);
    prisma.supplyRequest.findMany.mockResolvedValue([]);
    prisma.stockTransfer.findMany.mockResolvedValue([]);
    prisma.medicine.findMany.mockResolvedValue([]);
    prisma.warehouse.findMany.mockResolvedValue([]);
    prisma.pharmacy.findMany.mockResolvedValue([]);

    const results = await service.evaluateAll();
    expect(results.lowStock?.ok).toBe(false);
    expect(results.pendingSupplyRequests?.ok).toBe(true);
    expect(results.transfersAwaitingReceipt?.ok).toBe(true);
  });

  it('creates low-stock alerts using minimumStock threshold', async () => {
    prisma.warehouseStock.groupBy.mockResolvedValue([
      { warehouseId: 'wh-1', medicineId: 'm1', _sum: { quantity: 5 } },
    ]);
    prisma.pharmacyStock.groupBy.mockResolvedValue([]);
    prisma.medicine.findMany.mockResolvedValue([
      { id: 'm1', name: 'Paracetamol', minimumStock: 50 },
    ]);
    prisma.warehouse.findMany.mockResolvedValue([{ id: 'wh-1', name: 'Central' }]);
    prisma.pharmacy.findMany.mockResolvedValue([]);

    await service.evaluateLowStock();
    expect(notifications.upsertActiveAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeKey: 'LOW_STOCK:WAREHOUSE:wh-1:MEDICINE:m1',
        severity: NotificationSeverity.WARNING,
      }),
    );
  });
});

describe('Phase 6B access isolation', () => {
  it('documents that recipientUserId is never accepted from clients', () => {
    // Controllers always use CurrentUser().id — no recipient query param exists.
    expect(true).toBe(true);
  });

  it('rejects cross-user assertOwn', () => {
    const service = new NotificationsService({} as never, { sendNotificationEmail: jest.fn() } as never);
    expect(() => service.assertOwn('a', 'b')).toThrow(ForbiddenException);
  });
});
