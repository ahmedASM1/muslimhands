import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, RoleCode, type AuthenticatedUser } from '@mh/shared';
import {
  NotificationSeverity,
  NotificationType,
  Prisma,
  SupplyRequestStatus,
} from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { requirePharmacyId, resolvePharmacyId } from '../../common/access/access';
import { nextDocumentNumber } from '../../common/inventory/document-numbers';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

export class SupplyRequestQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  pharmacyId?: string;

  @IsOptional()
  @IsEnum(SupplyRequestStatus)
  status?: SupplyRequestStatus;
}

export interface SupplyRequestItemInput {
  medicineId: string;
  requestedQty: number;
  notes?: string;
}

@Injectable()
export class SupplyRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(user: AuthenticatedUser, query: SupplyRequestQueryDto) {
    const pharmacyId = resolvePharmacyId(user, query.pharmacyId);
    const where: Prisma.SupplyRequestWhereInput = {
      ...(pharmacyId ? { pharmacyId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { requestNumber: { contains: query.search, mode: 'insensitive' } },
              { notes: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.supplyRequest.count({ where }),
      this.prisma.supplyRequest.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        include: this.detailInclude(),
      }),
    ]);
    return {
      items,
      meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
    };
  }

  async get(id: string, user: AuthenticatedUser) {
    const request = await this.prisma.supplyRequest.findUnique({
      where: { id },
      include: this.detailInclude(),
    });
    if (!request) throw new NotFoundException('Supply request not found');
    this.assertCanView(user, request.pharmacyId);
    return request;
  }

  async create(
    user: AuthenticatedUser,
    data: {
      warehouseId: string;
      pharmacyId?: string;
      notes?: string;
      items: SupplyRequestItemInput[];
    },
  ) {
    if (!data.items?.length) {
      throw new BadRequestException('At least one item is required');
    }
    const pharmacyId = requirePharmacyId(user, data.pharmacyId);
    await this.assertWarehouse(data.warehouseId);
    await this.assertActiveMedicines(data.items.map((item) => item.medicineId));

    for (const item of data.items) {
      if (item.requestedQty <= 0) {
        throw new BadRequestException('Requested quantity must be greater than zero');
      }
    }

    const request = await this.prisma.$transaction(async (tx) => {
      const requestNumber = await nextDocumentNumber(tx, 'supplyRequest', 'SR');
      return tx.supplyRequest.create({
        data: {
          requestNumber,
          pharmacyId,
          warehouseId: data.warehouseId,
          notes: data.notes?.trim() || null,
          createdById: user.id,
          status: SupplyRequestStatus.DRAFT,
          items: {
            create: data.items.map((item) => ({
              medicineId: item.medicineId,
              requestedQty: item.requestedQty,
              notes: item.notes?.trim() || null,
            })),
          },
        },
        include: this.detailInclude(),
      });
    });

    await this.audit.record({
      userId: user.id,
      action: AuditAction.CREATE_SUPPLY_REQUEST,
      entityType: 'SupplyRequest',
      entityId: request.id,
      newValues: { requestNumber: request.requestNumber, itemCount: data.items.length },
    });
    return request;
  }

  async update(
    id: string,
    user: AuthenticatedUser,
    data: {
      notes?: string;
      items?: SupplyRequestItemInput[];
    },
  ) {
    const existing = await this.prisma.supplyRequest.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Supply request not found');
    if (existing.status !== SupplyRequestStatus.DRAFT) {
      throw new BadRequestException('Only draft requests can be edited');
    }
    requirePharmacyId(user, existing.pharmacyId);

    if (data.items) {
      if (!data.items.length) {
        throw new BadRequestException('At least one item is required');
      }
      for (const item of data.items) {
        if (item.requestedQty <= 0) {
          throw new BadRequestException('Requested quantity must be greater than zero');
        }
      }
      await this.assertActiveMedicines(data.items.map((item) => item.medicineId));
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.supplyRequest.update({
        where: { id },
        data: { notes: data.notes?.trim() },
      });
      if (data.items) {
        await tx.supplyRequestItem.deleteMany({ where: { requestId: id } });
        for (const item of data.items) {
          await tx.supplyRequestItem.create({
            data: {
              requestId: id,
              medicineId: item.medicineId,
              requestedQty: item.requestedQty,
              notes: item.notes?.trim() || null,
            },
          });
        }
      }
    });

    return this.get(id, user);
  }

  async submit(id: string, user: AuthenticatedUser) {
    const existing = await this.prisma.supplyRequest.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!existing) throw new NotFoundException('Supply request not found');
    if (existing.status !== SupplyRequestStatus.DRAFT) {
      throw new BadRequestException('Only draft requests can be submitted');
    }
    if (!existing.items.length) {
      throw new BadRequestException('Cannot submit a request with no items');
    }
    requirePharmacyId(user, existing.pharmacyId);

    const updated = await this.prisma.supplyRequest.update({
      where: { id },
      data: { status: SupplyRequestStatus.SUBMITTED, submittedAt: new Date() },
      include: this.detailInclude(),
    });

    await this.audit.record({
      userId: user.id,
      action: AuditAction.SUBMIT_SUPPLY_REQUEST,
      entityType: 'SupplyRequest',
      entityId: id,
    });

    await this.notifications.notifyRoles(
      [RoleCode.WAREHOUSE_MANAGER, RoleCode.WAREHOUSE_STAFF],
      {
        type: NotificationType.PENDING_SUPPLY_REQUEST,
        title: 'Supply request awaiting review',
        message: `Supply request ${existing.requestNumber} is awaiting warehouse review.`,
        entityType: 'SupplyRequest',
        entityId: id,
        severity: NotificationSeverity.WARNING,
        dedupeKey: `PENDING_SUPPLY_REQUEST:${id}`,
        href: `/warehouse/supply-requests/${id}`,
        warehouseId: existing.warehouseId,
      },
    );

    return updated;
  }

  async approve(
    id: string,
    user: AuthenticatedUser,
    payload?: { items?: Array<{ id: string; approvedQty: number }>; notes?: string },
  ) {
    this.assertWarehouseReviewer(user);
    const existing = await this.prisma.supplyRequest.findUnique({
      where: { id },
      include: { items: { include: { medicine: true } } },
    });
    if (!existing) throw new NotFoundException('Supply request not found');
    if (existing.status !== SupplyRequestStatus.SUBMITTED) {
      throw new BadRequestException('Only submitted requests can be approved');
    }

    await this.prisma.$transaction(async (tx) => {
      for (const item of existing.items) {
        if (!item.medicine.isActive) {
          throw new BadRequestException(`Medicine ${item.medicine.name} is inactive`);
        }
        const approved =
          payload?.items?.find((row) => row.id === item.id)?.approvedQty ?? item.requestedQty;
        if (approved < 0) {
          throw new BadRequestException('Approved quantity cannot be negative');
        }
        if (approved > item.requestedQty) {
          throw new BadRequestException('Approved quantity cannot exceed requested quantity');
        }
        await tx.supplyRequestItem.update({
          where: { id: item.id },
          data: { approvedQty: approved },
        });
      }
      await tx.supplyRequest.update({
        where: { id },
        data: {
          status: SupplyRequestStatus.APPROVED,
          reviewedById: user.id,
          reviewedAt: new Date(),
          notes: payload?.notes?.trim() ?? existing.notes,
        },
      });
    });

    await this.audit.record({
      userId: user.id,
      action: AuditAction.APPROVE_SUPPLY_REQUEST,
      entityType: 'SupplyRequest',
      entityId: id,
    });

    await this.notifications.notifyRoles(
      [RoleCode.PHARMACY_MANAGER, RoleCode.PHARMACY_STAFF],
      {
        type: NotificationType.SUPPLY_REQUEST_APPROVED,
        title: 'Supply request approved',
        message: `Supply request ${existing.requestNumber} was approved.`,
        entityType: 'SupplyRequest',
        entityId: id,
        severity: NotificationSeverity.INFO,
        href: `/pharmacy/supply-requests/${id}`,
        pharmacyId: existing.pharmacyId,
      },
    );
    await this.notifications.resolveByDedupeKey(`PENDING_SUPPLY_REQUEST:${id}`);

    return this.prisma.supplyRequest.findUnique({ where: { id }, include: this.detailInclude() });
  }

  async reject(
    id: string,
    user: AuthenticatedUser,
    payload: { rejectionReason: string },
  ) {
    this.assertWarehouseReviewer(user);
    if (!payload.rejectionReason?.trim()) {
      throw new BadRequestException('Rejection reason is required');
    }
    const existing = await this.prisma.supplyRequest.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Supply request not found');
    if (existing.status !== SupplyRequestStatus.SUBMITTED) {
      throw new BadRequestException('Only submitted requests can be rejected');
    }

    const updated = await this.prisma.supplyRequest.update({
      where: { id },
      data: {
        status: SupplyRequestStatus.REJECTED,
        rejectionReason: payload.rejectionReason.trim(),
        reviewedById: user.id,
        reviewedAt: new Date(),
      },
      include: this.detailInclude(),
    });

    await this.audit.record({
      userId: user.id,
      action: AuditAction.REJECT_SUPPLY_REQUEST,
      entityType: 'SupplyRequest',
      entityId: id,
      newValues: { rejectionReason: payload.rejectionReason },
    });

    await this.notifications.notifyRoles(
      [RoleCode.PHARMACY_MANAGER, RoleCode.PHARMACY_STAFF],
      {
        type: NotificationType.SUPPLY_REQUEST_REJECTED,
        title: 'Supply request rejected',
        message: `Supply request ${existing.requestNumber} was rejected: ${payload.rejectionReason.trim()}`,
        entityType: 'SupplyRequest',
        entityId: id,
        severity: NotificationSeverity.WARNING,
        href: `/pharmacy/supply-requests/${id}`,
        pharmacyId: existing.pharmacyId,
      },
    );
    await this.notifications.resolveByDedupeKey(`PENDING_SUPPLY_REQUEST:${id}`);

    return updated;
  }

  async cancel(id: string, user: AuthenticatedUser) {
    const existing = await this.prisma.supplyRequest.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Supply request not found');
    if (
      existing.status !== SupplyRequestStatus.DRAFT &&
      existing.status !== SupplyRequestStatus.SUBMITTED
    ) {
      throw new BadRequestException('This request can no longer be cancelled');
    }

    const isWarehouse =
      user.roles.includes(RoleCode.SUPER_ADMIN) ||
      user.roles.includes(RoleCode.WAREHOUSE_MANAGER) ||
      user.roles.includes(RoleCode.WAREHOUSE_STAFF);
    if (!isWarehouse) {
      requirePharmacyId(user, existing.pharmacyId);
    }

    const updated = await this.prisma.supplyRequest.update({
      where: { id },
      data: { status: SupplyRequestStatus.CANCELLED },
      include: this.detailInclude(),
    });

    await this.audit.record({
      userId: user.id,
      action: AuditAction.CANCEL_SUPPLY_REQUEST,
      entityType: 'SupplyRequest',
      entityId: id,
    });

    return updated;
  }

  private detailInclude() {
    return {
      pharmacy: true,
      warehouse: true,
      createdBy: { select: { firstName: true, lastName: true, email: true } },
      reviewedBy: { select: { firstName: true, lastName: true, email: true } },
      items: {
        include: {
          medicine: {
            include: {
              unit: true,
              category: { select: { id: true, name: true, itemType: true } },
            },
          },
        },
      },
      transfers: { select: { id: true, transferNumber: true, status: true } },
    } as const;
  }

  private assertCanView(user: AuthenticatedUser, pharmacyId: string) {
    if (
      user.roles.includes(RoleCode.SUPER_ADMIN) ||
      user.roles.includes(RoleCode.WAREHOUSE_MANAGER) ||
      user.roles.includes(RoleCode.WAREHOUSE_STAFF) ||
      user.roles.includes(RoleCode.REPORT_VIEWER)
    ) {
      return;
    }
    requirePharmacyId(user, pharmacyId);
  }

  private assertWarehouseReviewer(user: AuthenticatedUser) {
    if (
      user.roles.includes(RoleCode.SUPER_ADMIN) ||
      user.roles.includes(RoleCode.WAREHOUSE_MANAGER) ||
      user.roles.includes(RoleCode.WAREHOUSE_STAFF)
    ) {
      return;
    }
    throw new ForbiddenException('Only warehouse users can review supply requests');
  }

  private async assertWarehouse(warehouseId: string) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: warehouseId, deletedAt: null, isActive: true },
    });
    if (!warehouse) throw new BadRequestException('Warehouse not found or inactive');
  }

  private async assertActiveMedicines(medicineIds: string[]) {
    const medicines = await this.prisma.medicine.findMany({
      where: { id: { in: medicineIds }, deletedAt: null },
    });
    if (medicines.length !== new Set(medicineIds).size) {
      throw new BadRequestException('One or more medicines were not found');
    }
    const inactive = medicines.find((item) => !item.isActive);
    if (inactive) {
      throw new BadRequestException(`Medicine ${inactive.name} is inactive`);
    }
  }
}
