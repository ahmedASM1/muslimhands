import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction } from '@mh/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class WarehousesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.warehouse.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { users: true } },
      },
    }).then(async (warehouses) => {
      const ids = warehouses.map((w) => w.id);
      const stockTotals = ids.length
        ? await this.prisma.warehouseStock.groupBy({
            by: ['warehouseId'],
            where: { warehouseId: { in: ids } },
            _sum: { quantity: true },
          })
        : [];
      const stockMap = new Map(stockTotals.map((row) => [row.warehouseId, row._sum.quantity ?? 0]));
      return warehouses.map((warehouse) => ({
        ...warehouse,
        status: warehouse.isActive ? 'ACTIVE' : 'INACTIVE',
        employeeCount: warehouse._count.users,
        stockQuantity: stockMap.get(warehouse.id) ?? 0,
      }));
    });
  }

  defaultWarehouse() {
    return this.prisma.warehouse.findFirst({
      where: { isActive: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(
    data: {
      name: string;
      code: string;
      address?: string;
      location?: string;
    },
    userId: string,
  ) {
    const code = data.code.trim().toUpperCase();
    const name = data.name.trim();
    if (!name || !code) {
      throw new BadRequestException('Warehouse name and code are required');
    }

    const existing = await this.prisma.warehouse.findFirst({
      where: { code, deletedAt: null },
    });
    if (existing) {
      throw new BadRequestException('A warehouse with this code already exists');
    }

    const warehouse = await this.prisma.warehouse.create({
      data: {
        organizationId: await this.currentOrganizationId(),
        name,
        code,
        address: data.address?.trim() || null,
        location: data.location?.trim() || data.address?.trim() || null,
        isActive: true,
      },
    });

    await this.audit.record({
      userId,
      action: AuditAction.CREATE_WAREHOUSE,
      entityType: 'Warehouse',
      entityId: warehouse.id,
      newValues: { name: warehouse.name, code: warehouse.code, location: warehouse.location },
    });

    return {
      ...warehouse,
      status: 'ACTIVE' as const,
      employeeCount: 0,
      stockQuantity: 0,
    };
  }

  async update(
    id: string,
    data: {
      name?: string;
      address?: string | null;
      location?: string | null;
      isActive?: boolean;
    },
    userId: string,
  ) {
    const existing = await this.findById(id);
    const updated = await this.prisma.warehouse.update({
      where: { id: existing.id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.address !== undefined ? { address: data.address?.trim() || null } : {}),
        ...(data.location !== undefined ? { location: data.location?.trim() || null } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
    });

    await this.audit.record({
      userId,
      action: AuditAction.UPDATE_WAREHOUSE,
      entityType: 'Warehouse',
      entityId: existing.id,
      oldValues: {
        name: existing.name,
        location: existing.location,
        isActive: existing.isActive,
      },
      newValues: data,
    });

    return {
      ...updated,
      status: updated.isActive ? 'ACTIVE' : 'INACTIVE',
    };
  }

  async setActive(id: string, isActive: boolean, userId: string) {
    return this.update(id, { isActive }, userId);
  }

  private async findById(id: string) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id, deletedAt: null },
    });
    if (!warehouse) {
      throw new NotFoundException('Warehouse not found');
    }
    return warehouse;
  }

  private async currentOrganizationId() {
    const organization = await this.prisma.organization.findFirstOrThrow({
      orderBy: { createdAt: 'asc' },
    });
    return organization.id;
  }
}
