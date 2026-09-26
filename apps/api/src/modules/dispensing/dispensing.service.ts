import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RoleCode, type AuthenticatedUser } from '@mh/shared';
import { assertCanMutateDispensing, requirePharmacyId, resolvePharmacyId } from '../../common/access/access';
import { InventoryTransactionService } from '../../common/inventory/inventory-transaction.service';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '@prisma/client';

export interface DispensingQuery extends PaginationQueryDto {
  pharmacyId?: string;
  beneficiaryId?: string;
  medicineId?: string;
  from?: string;
  to?: string;
  status?: string;
}

@Injectable()
export class DispensingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryTx: InventoryTransactionService,
  ) {}

  async list(user: AuthenticatedUser, query: DispensingQuery) {
    const pharmacyId = resolvePharmacyId(user, query.pharmacyId);
    const where = this.buildWhere(query, pharmacyId);
    const orderBy = this.buildOrder(query);

    const [total, items] = await this.prisma.$transaction([
      this.prisma.dispensingRecord.count({ where }),
      this.prisma.dispensingRecord.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy,
        include: {
          beneficiary: true,
          pharmacy: { select: { id: true, name: true, code: true } },
          dispensedBy: { select: { firstName: true, lastName: true } },
          items: { include: { medicine: true, batch: true } },
        },
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
    const record = await this.prisma.dispensingRecord.findUnique({
      where: { id },
      include: {
        beneficiary: true,
        pharmacy: { select: { id: true, name: true, code: true } },
        dispensedBy: { select: { id: true, firstName: true, lastName: true } },
        items: { include: { medicine: true, batch: true } },
      },
    });
    if (!record) {
      throw new NotFoundException('Dispensing record not found');
    }
    this.assertPharmacyAccess(user, record.pharmacyId);
    return this.toDto(record);
  }

  async getItems(user: AuthenticatedUser, id: string) {
    const record = await this.get(user, id);
    return record.items;
  }

  async create(
    user: AuthenticatedUser,
    data: {
      beneficiaryId: string;
      notes?: string;
      items: Array<{ medicineId: string; quantity: number }>;
    },
    idempotencyKey?: string,
  ) {
    assertCanMutateDispensing(user);
    // Pharmacy is always derived from assignment — never trusted from the client body.
    const pharmacyId = requirePharmacyId(user);

    const record = await this.inventoryTx.dispense({
      pharmacyId,
      beneficiaryId: data.beneficiaryId,
      performedById: user.id,
      items: data.items,
      notes: data.notes,
      idempotencyKey,
    });

    return this.toDto(record);
  }

  private buildWhere(
    query: DispensingQuery,
    pharmacyId?: string,
  ): Prisma.DispensingRecordWhereInput {
    const search = query.search?.trim();
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (to) {
      to.setUTCHours(23, 59, 59, 999);
    }

    return {
      ...(pharmacyId ? { pharmacyId } : {}),
      ...(query.beneficiaryId ? { beneficiaryId: query.beneficiaryId } : {}),
      ...(query.status ? { status: query.status as never } : {}),
      ...(from || to
        ? {
            dispensedAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
      ...(query.medicineId
        ? { items: { some: { medicineId: query.medicineId } } }
        : {}),
      ...(search
        ? {
            OR: [
              { recordNumber: { contains: search, mode: 'insensitive' } },
              { beneficiary: { name: { contains: search, mode: 'insensitive' } } },
              {
                beneficiary: {
                  beneficiaryNumber: { contains: search, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };
  }

  private buildOrder(query: DispensingQuery): Prisma.DispensingRecordOrderByWithRelationInput {
    const direction = query.sortOrder === 'asc' ? 'asc' : 'desc';
    switch (query.sortBy) {
      case 'dispensingNumber':
      case 'recordNumber':
        return { recordNumber: direction };
      case 'createdAt':
        return { createdAt: direction };
      default:
        return { dispensedAt: direction };
    }
  }

  private assertPharmacyAccess(user: AuthenticatedUser, pharmacyId: string) {
    if (user.roles.includes(RoleCode.SUPER_ADMIN)) {
      return;
    }
    if (
      user.roles.includes(RoleCode.WAREHOUSE_MANAGER) ||
      user.roles.includes(RoleCode.WAREHOUSE_STAFF) ||
      user.roles.includes(RoleCode.REPORT_VIEWER)
    ) {
      // Read-only global viewers may see dispensing aggregates without pharmacy assignment.
      return;
    }
    if (!user.pharmacyId || user.pharmacyId !== pharmacyId) {
      throw new ForbiddenException('Cannot access another pharmacy\'s dispensing records');
    }
  }

  private toDto(record: {
    id: string;
    recordNumber: string;
    pharmacyId: string;
    beneficiaryId: string;
    status: string;
    notes: string | null;
    dispensedAt: Date;
    createdAt: Date;
    pharmacy?: { id: string; name: string; code: string } | null;
    beneficiary?: {
      id: string;
      beneficiaryNumber: string;
      name: string | null;
      phone: string | null;
      isActive: boolean;
    } | null;
    dispensedBy?: { id?: string; firstName: string; lastName: string } | null;
    items: Array<{
      id: string;
      medicineId: string;
      batchId: string;
      quantity: number;
      referenceValue: unknown;
      notes?: string | null;
      medicine: { id: string; name: string; referenceValue?: unknown };
      batch: { id: string; batchNumber: string; expiryDate: Date };
    }>;
  }) {
    const items = record.items.map((row) => {
      const unit =
        row.referenceValue != null ? Number(row.referenceValue) : null;
      return {
        id: row.id,
        medicineId: row.medicineId,
        medicineName: row.medicine.name,
        batchId: row.batchId,
        batchNumber: row.batch.batchNumber,
        expiryDate: row.batch.expiryDate,
        quantity: row.quantity,
        estimatedUnitValue: unit,
        estimatedValue: unit != null ? unit * row.quantity : null,
        notes: row.notes ?? null,
        medicine: row.medicine,
        batch: row.batch,
      };
    });

    // Group batch allocations by medicine for confirmation UI.
    const byMedicine = new Map<
      string,
      {
        medicineId: string;
        medicineName: string;
        quantity: number;
        estimatedUnitValue: number | null;
        estimatedValue: number | null;
        batches: Array<{ batchId: string; batchNumber: string; quantity: number; expiryDate: Date }>;
      }
    >();
    for (const item of items) {
      const existing = byMedicine.get(item.medicineId);
      if (!existing) {
        byMedicine.set(item.medicineId, {
          medicineId: item.medicineId,
          medicineName: item.medicineName,
          quantity: item.quantity,
          estimatedUnitValue: item.estimatedUnitValue,
          estimatedValue: item.estimatedValue,
          batches: [
            {
              batchId: item.batchId,
              batchNumber: item.batchNumber,
              quantity: item.quantity,
              expiryDate: item.expiryDate,
            },
          ],
        });
      } else {
        existing.quantity += item.quantity;
        if (existing.estimatedValue != null && item.estimatedValue != null) {
          existing.estimatedValue += item.estimatedValue;
        }
        existing.batches.push({
          batchId: item.batchId,
          batchNumber: item.batchNumber,
          quantity: item.quantity,
          expiryDate: item.expiryDate,
        });
      }
    }

    return {
      id: record.id,
      dispensingNumber: record.recordNumber,
      recordNumber: record.recordNumber,
      pharmacyId: record.pharmacyId,
      beneficiaryId: record.beneficiaryId,
      status: record.status,
      notes: record.notes,
      dispensedAt: record.dispensedAt,
      createdAt: record.createdAt,
      pharmacy: record.pharmacy,
      beneficiary: record.beneficiary
        ? {
            id: record.beneficiary.id,
            beneficiaryNumber: record.beneficiary.beneficiaryNumber,
            fullName: record.beneficiary.name,
            name: record.beneficiary.name,
            phone: record.beneficiary.phone,
            status: record.beneficiary.isActive ? 'ACTIVE' : 'INACTIVE',
          }
        : null,
      dispensedBy: record.dispensedBy,
      items,
      medicines: [...byMedicine.values()],
    };
  }
}
