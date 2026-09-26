import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@mh/shared';
import { IsBooleanString, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export class CategoryQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsBooleanString()
  isActive?: string;
}

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: CategoryQueryDto) {
    const where = {
      deletedAt: null,
      ...(query.isActive !== undefined ? { isActive: query.isActive === 'true' } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { description: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.medicineCategory.count({ where }),
      this.prisma.medicineCategory.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { name: query.sortOrder === 'desc' ? 'desc' : 'asc' },
        include: { _count: { select: { medicines: true } } },
      }),
    ]);
    return {
      items: items.map((item) => this.withStatus(item)),
      meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
    };
  }

  async get(id: string) {
    const category = await this.prisma.medicineCategory.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { medicines: true } } },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return this.withStatus(category);
  }

  async create(data: { name: string; description?: string }, userId: string) {
    await this.assertUniqueName(data.name);
    const category = await this.prisma.medicineCategory.create({
      data: { name: data.name.trim(), description: data.description?.trim() },
    });
    await this.audit.record({
      userId,
      action: AuditAction.CREATE_CATEGORY,
      entityType: 'MedicineCategory',
      entityId: category.id,
      newValues: data,
    });
    return this.withStatus(category);
  }

  async update(id: string, data: { name?: string; description?: string; isActive?: boolean }, userId: string) {
    const existing = await this.prisma.medicineCategory.findFirst({ where: { id, deletedAt: null } });
    if (!existing) {
      throw new NotFoundException('Category not found');
    }
    if (data.name && data.name.trim().toLowerCase() !== existing.name.toLowerCase()) {
      await this.assertUniqueName(data.name, id);
    }
    const updated = await this.prisma.medicineCategory.update({
      where: { id },
      data: {
        name: data.name?.trim(),
        description: data.description?.trim(),
        isActive: data.isActive,
      },
    });
    await this.audit.record({
      userId,
      action: data.isActive === false ? AuditAction.DEACTIVATE_CATEGORY : AuditAction.UPDATE_CATEGORY,
      entityType: 'MedicineCategory',
      entityId: id,
      oldValues: existing,
      newValues: data,
    });
    return this.withStatus(updated);
  }

  setStatus(id: string, isActive: boolean, userId: string) {
    return this.update(id, { isActive }, userId);
  }

  private async assertUniqueName(name: string, excludeId?: string) {
    const existing = await this.prisma.medicineCategory.findFirst({
      where: {
        name: { equals: name.trim(), mode: 'insensitive' },
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    if (existing) {
      throw new ConflictException('A category with this name already exists');
    }
  }

  private withStatus<T extends { isActive: boolean }>(item: T) {
    return { ...item, status: item.isActive ? 'ACTIVE' : 'INACTIVE' };
  }
}
