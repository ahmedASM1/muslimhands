import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, RoleCode, type AuthenticatedUser } from '@mh/shared';
import { Gender, type Prisma } from '@prisma/client';
import { assertCanAccessBeneficiaries } from '../../common/access/access';
import { nextDocumentNumber } from '../../common/inventory/document-numbers';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface BeneficiaryQuery extends PaginationQueryDto {
  status?: 'ACTIVE' | 'INACTIVE';
  phone?: string;
  externalReference?: string;
  beneficiaryNumber?: string;
}

@Injectable()
export class BeneficiariesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthenticatedUser, query: BeneficiaryQuery) {
    assertCanAccessBeneficiaries(user);
    const where = this.buildWhere(query);
    const orderBy = this.buildOrder(query);

    const [total, items] = await this.prisma.$transaction([
      this.prisma.beneficiary.count({ where }),
      this.prisma.beneficiary.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy,
      }),
    ]);

    return {
      items: items.map((item) => this.toDto(item)),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async get(user: AuthenticatedUser, id: string) {
    assertCanAccessBeneficiaries(user);
    const item = await this.prisma.beneficiary.findFirst({
      where: { id, deletedAt: null },
    });
    if (!item) {
      throw new NotFoundException('Beneficiary not found');
    }
    return this.toDto(item);
  }

  async create(
    user: AuthenticatedUser,
    data: {
      fullName: string;
      phone?: string;
      externalReference?: string;
      dateOfBirth?: string;
      gender?: Gender;
      address?: string;
      notes?: string;
    },
  ) {
    assertCanAccessBeneficiaries(user);
    if (!data.fullName?.trim()) {
      throw new BadRequestException('Full name is required');
    }
    if (data.externalReference) {
      await this.assertUniqueExternalReference(data.externalReference);
    }

    const beneficiaryNumber = await nextDocumentNumber(this.prisma, 'beneficiary', 'BN');
    const created = await this.prisma.beneficiary.create({
      data: {
        beneficiaryNumber,
        name: data.fullName.trim(),
        phone: data.phone?.trim() || null,
        externalReference: data.externalReference?.trim() || null,
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
        gender: data.gender ?? Gender.UNSPECIFIED,
        address: data.address?.trim() || null,
        notes: data.notes?.trim() || null,
        isActive: true,
      },
    });

    await this.audit.record({
      userId: user.id,
      action: AuditAction.CREATE_BENEFICIARY,
      entityType: 'Beneficiary',
      entityId: created.id,
      newValues: {
        beneficiaryNumber: created.beneficiaryNumber,
        status: 'ACTIVE',
      },
    });

    return this.toDto(created);
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    data: {
      fullName?: string;
      phone?: string | null;
      externalReference?: string | null;
      dateOfBirth?: string | null;
      gender?: Gender;
      address?: string | null;
      notes?: string | null;
    },
  ) {
    assertCanAccessBeneficiaries(user);
    const existing = await this.requireBeneficiary(id);
    if (data.externalReference) {
      await this.assertUniqueExternalReference(data.externalReference, id);
    }

    const updated = await this.prisma.beneficiary.update({
      where: { id },
      data: {
        ...(data.fullName !== undefined ? { name: data.fullName.trim() } : {}),
        ...(data.phone !== undefined ? { phone: data.phone?.trim() || null } : {}),
        ...(data.externalReference !== undefined
          ? { externalReference: data.externalReference?.trim() || null }
          : {}),
        ...(data.dateOfBirth !== undefined
          ? { dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null }
          : {}),
        ...(data.gender !== undefined ? { gender: data.gender } : {}),
        ...(data.address !== undefined ? { address: data.address?.trim() || null } : {}),
        ...(data.notes !== undefined ? { notes: data.notes?.trim() || null } : {}),
      },
    });

    await this.audit.record({
      userId: user.id,
      action: AuditAction.UPDATE_BENEFICIARY,
      entityType: 'Beneficiary',
      entityId: id,
      oldValues: { beneficiaryNumber: existing.beneficiaryNumber },
      newValues: { beneficiaryNumber: updated.beneficiaryNumber },
    });

    return this.toDto(updated);
  }

  async activate(user: AuthenticatedUser, id: string) {
    assertCanAccessBeneficiaries(user);
    const existing = await this.requireBeneficiary(id);
    if (existing.isActive) {
      return this.toDto(existing);
    }
    const updated = await this.prisma.beneficiary.update({
      where: { id },
      data: { isActive: true },
    });
    await this.audit.record({
      userId: user.id,
      action: AuditAction.ACTIVATE_BENEFICIARY,
      entityType: 'Beneficiary',
      entityId: id,
      newValues: { status: 'ACTIVE' },
    });
    return this.toDto(updated);
  }

  async deactivate(user: AuthenticatedUser, id: string) {
    assertCanAccessBeneficiaries(user);
    const existing = await this.requireBeneficiary(id);
    if (!existing.isActive) {
      return this.toDto(existing);
    }
    const updated = await this.prisma.beneficiary.update({
      where: { id },
      data: { isActive: false },
    });
    await this.audit.record({
      userId: user.id,
      action: AuditAction.DEACTIVATE_BENEFICIARY,
      entityType: 'Beneficiary',
      entityId: id,
      newValues: { status: 'INACTIVE' },
    });
    return this.toDto(updated);
  }

  async dispensingHistory(
    user: AuthenticatedUser,
    id: string,
    query: PaginationQueryDto & { pharmacyId?: string },
  ) {
    assertCanAccessBeneficiaries(user);
    await this.requireBeneficiary(id);

      const pharmacyFilter = user.roles.includes(RoleCode.SUPER_ADMIN)
        ? query.pharmacyId
          ? { pharmacyId: query.pharmacyId }
          : {}
        : user.pharmacyId
          ? { pharmacyId: user.pharmacyId }
          : {};

    const where = { beneficiaryId: id, ...pharmacyFilter };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.dispensingRecord.count({ where }),
      this.prisma.dispensingRecord.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { dispensedAt: 'desc' },
        include: {
          pharmacy: { select: { id: true, name: true, code: true } },
          dispensedBy: { select: { firstName: true, lastName: true } },
          items: { include: { medicine: true, batch: true } },
        },
      }),
    ]);

    return {
      items: items.map((item) => this.toDispensingDto(item)),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  private buildWhere(query: BeneficiaryQuery): Prisma.BeneficiaryWhereInput {
    const search = query.search?.trim();
    return {
      deletedAt: null,
      ...(query.status === 'ACTIVE' ? { isActive: true } : {}),
      ...(query.status === 'INACTIVE' ? { isActive: false } : {}),
      ...(query.phone ? { phone: { contains: query.phone, mode: 'insensitive' } } : {}),
      ...(query.externalReference
        ? { externalReference: { contains: query.externalReference, mode: 'insensitive' } }
        : {}),
      ...(query.beneficiaryNumber
        ? { beneficiaryNumber: { contains: query.beneficiaryNumber, mode: 'insensitive' } }
        : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { beneficiaryNumber: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search, mode: 'insensitive' } },
              { externalReference: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  private buildOrder(query: BeneficiaryQuery): Prisma.BeneficiaryOrderByWithRelationInput {
    const direction = query.sortOrder === 'asc' ? 'asc' : 'desc';
    switch (query.sortBy) {
      case 'fullName':
      case 'name':
        return { name: direction };
      case 'beneficiaryNumber':
        return { beneficiaryNumber: direction };
      case 'status':
        return { isActive: direction };
      case 'phone':
        return { phone: direction };
      default:
        return { createdAt: direction };
    }
  }

  private async requireBeneficiary(id: string) {
    const item = await this.prisma.beneficiary.findFirst({
      where: { id, deletedAt: null },
    });
    if (!item) {
      throw new NotFoundException('Beneficiary not found');
    }
    return item;
  }

  private async assertUniqueExternalReference(value: string, excludeId?: string) {
    const existing = await this.prisma.beneficiary.findFirst({
      where: {
        externalReference: value.trim(),
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    if (existing) {
      throw new ConflictException('External reference is already in use');
    }
  }

  private toDto(item: {
    id: string;
    beneficiaryNumber: string;
    name: string | null;
    phone: string | null;
    externalReference: string | null;
    dateOfBirth: Date | null;
    gender: Gender;
    address: string | null;
    notes: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: item.id,
      beneficiaryNumber: item.beneficiaryNumber,
      fullName: item.name,
      name: item.name,
      phone: item.phone,
      externalReference: item.externalReference,
      dateOfBirth: item.dateOfBirth,
      gender: item.gender,
      address: item.address,
      notes: item.notes,
      status: item.isActive ? 'ACTIVE' : 'INACTIVE',
      isActive: item.isActive,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  private toDispensingDto(item: {
    id: string;
    recordNumber: string;
    pharmacyId: string;
    beneficiaryId: string;
    status: string;
    notes: string | null;
    dispensedAt: Date;
    pharmacy?: { id: string; name: string; code: string };
    dispensedBy?: { firstName: string; lastName: string } | null;
    items: Array<{
      id: string;
      quantity: number;
      referenceValue: unknown;
      medicine: { id: string; name: string };
      batch: { id: string; batchNumber: string; expiryDate: Date };
    }>;
  }) {
    return {
      id: item.id,
      dispensingNumber: item.recordNumber,
      recordNumber: item.recordNumber,
      pharmacyId: item.pharmacyId,
      beneficiaryId: item.beneficiaryId,
      status: item.status,
      notes: item.notes,
      dispensedAt: item.dispensedAt,
      pharmacy: item.pharmacy,
      dispensedBy: item.dispensedBy,
      items: item.items.map((row) => ({
        id: row.id,
        medicineId: row.medicine.id,
        medicineName: row.medicine.name,
        batchId: row.batch.id,
        batchNumber: row.batch.batchNumber,
        expiryDate: row.batch.expiryDate,
        quantity: row.quantity,
        estimatedUnitValue: row.referenceValue,
        estimatedValue:
          row.referenceValue != null
            ? Number(row.referenceValue) * row.quantity
            : null,
      })),
    };
  }
}
