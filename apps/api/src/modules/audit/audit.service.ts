import { Injectable } from '@nestjs/common';
import { AuditAction, type PaginatedResult } from '@mh/shared';
import { Prisma } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PrismaService } from '../../prisma/prisma.service';

interface RecordAuditInput {
  userId?: string;
  action: AuditAction;
  entityType: string;
  entityId?: string;
  oldValues?: Prisma.InputJsonValue;
  newValues?: Prisma.InputJsonValue;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(input: RecordAuditInput) {
    return this.prisma.auditLog.create({
      data: {
        userId: input.userId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        oldValues: input.oldValues,
        newValues: input.newValues,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });
  }

  async list(query: PaginationQueryDto): Promise<
    PaginatedResult<{
      id: string;
      userId: string | null;
      action: AuditAction;
      entityType: string;
      entityId: string | null;
      createdAt: Date;
      actor: { email: string; firstName: string; lastName: string } | null;
    }>
  > {
    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;

    const [total, items] = await this.prisma.$transaction([
      this.prisma.auditLog.count(),
      this.prisma.auditLog.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          userId: true,
          action: true,
          entityType: true,
          entityId: true,
          createdAt: true,
          user: { select: { email: true, firstName: true, lastName: true } },
        },
      }),
    ]);

    return {
      items: items.map((item) => ({
        ...item,
        actor: item.user,
        action: item.action as AuditAction,
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
