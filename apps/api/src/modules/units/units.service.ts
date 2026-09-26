import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@mh/shared';
import { IsBooleanString, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export class UnitQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsBooleanString()
  isActive?: string;
}

@Injectable()
export class UnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: UnitQueryDto) {
    const where = {
      ...(query.isActive !== undefined ? { isActive: query.isActive === 'true' } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { code: { contains: query.search, mode: 'insensitive' as const } },
              { description: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.unit.count({ where }),
      this.prisma.unit.findMany({
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
    const unit = await this.prisma.unit.findUnique({
      where: { id },
      include: { _count: { select: { medicines: true } } },
    });
    if (!unit) {
      throw new NotFoundException('Unit not found');
    }
    return this.withStatus(unit);
  }

  async create(data: { code: string; name: string; description?: string }, userId: string) {
    await this.assertUniqueCode(data.code);
    const unit = await this.prisma.unit.create({
      data: {
        code: data.code.trim().toUpperCase(),
        name: data.name.trim(),
        description: data.description?.trim(),
      },
    });
    await this.audit.record({
      userId,
      action: AuditAction.CREATE_UNIT,
      entityType: 'Unit',
      entityId: unit.id,
      newValues: data,
    });
    return this.withStatus(unit);
  }

  async update(
    id: string,
    data: { code?: string; name?: string; description?: string; isActive?: boolean },
    userId: string,
  ) {
    const existing = await this.prisma.unit.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Unit not found');
    }
    if (data.code && data.code.trim().toUpperCase() !== existing.code) {
      await this.assertUniqueCode(data.code);
    }
    const updated = await this.prisma.unit.update({
      where: { id },
      data: {
        code: data.code ? data.code.trim().toUpperCase() : undefined,
        name: data.name?.trim(),
        description: data.description?.trim(),
        isActive: data.isActive,
      },
    });
    await this.audit.record({
      userId,
      action: data.isActive === false ? AuditAction.DEACTIVATE_UNIT : AuditAction.UPDATE_UNIT,
      entityType: 'Unit',
      entityId: id,
      oldValues: existing,
      newValues: data,
    });
    return this.withStatus(updated);
  }

  setStatus(id: string, isActive: boolean, userId: string) {
    return this.update(id, { isActive }, userId);
  }

  private async assertUniqueCode(code: string) {
    const existing = await this.prisma.unit.findUnique({
      where: { code: code.trim().toUpperCase() },
    });
    if (existing) {
      throw new ConflictException('A unit with this code already exists');
    }
  }

  private withStatus<T extends { isActive: boolean }>(item: T) {
    return { ...item, status: item.isActive ? 'ACTIVE' : 'INACTIVE' };
  }
}
