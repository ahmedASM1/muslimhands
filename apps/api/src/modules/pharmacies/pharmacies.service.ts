import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction, type AuthenticatedUser } from '@mh/shared';
import { isGlobalViewer, requirePharmacyId } from '../../common/access/access';
import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

@Injectable()
export class PharmaciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async list(user: AuthenticatedUser) {
    const pharmacies = await this.prisma.pharmacy.findMany({
      where: {
        deletedAt: null,
        ...(isGlobalViewer(user) ? {} : { id: { in: user.pharmacyId ? [user.pharmacyId] : [] } }),
      },
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { users: true } },
      },
    });

    const pharmacyIds = pharmacies.map((pharmacy) => pharmacy.id);
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const [stockTotals, dispensingToday, pendingRequests] = pharmacyIds.length
      ? await Promise.all([
          this.prisma.pharmacyStock.groupBy({
            by: ['pharmacyId'],
            where: { pharmacyId: { in: pharmacyIds } },
            _sum: { quantity: true },
          }),
          this.prisma.dispensingRecord.groupBy({
            by: ['pharmacyId'],
            where: { pharmacyId: { in: pharmacyIds }, createdAt: { gte: startOfDay } },
            _count: { _all: true },
          }),
          this.prisma.supplyRequest.groupBy({
            by: ['pharmacyId'],
            where: { pharmacyId: { in: pharmacyIds }, status: 'SUBMITTED' },
            _count: { _all: true },
          }),
        ])
      : [[], [], []];

    const stockMap = new Map(stockTotals.map((row) => [row.pharmacyId, row._sum.quantity ?? 0]));
    const dispensingMap = new Map(dispensingToday.map((row) => [row.pharmacyId, row._count._all]));
    const pendingMap = new Map(pendingRequests.map((row) => [row.pharmacyId, row._count._all]));

    return pharmacies.map((pharmacy) =>
      this.withRoute({
        ...pharmacy,
        employeeCount: pharmacy._count.users,
        stockQuantity: stockMap.get(pharmacy.id) ?? 0,
        todaysDispensing: dispensingMap.get(pharmacy.id) ?? 0,
        pendingSupplyRequests: pendingMap.get(pharmacy.id) ?? 0,
      }),
    );
  }

  async getBySlug(slug: string, user: AuthenticatedUser) {
    const pharmacy = await this.findByRef(slug);
    this.assertPharmacyAccess(user, pharmacy.id);
    return this.withRoute(pharmacy);
  }

  /** Public pharmacy portal metadata for invite-only login pages. */
  async getPortalBySlug(slug: string) {
    const pharmacy = await this.findByRef(slug);
    if (!pharmacy.isActive) {
      throw new NotFoundException('Pharmacy portal is unavailable');
    }
    const route = this.withRoute(pharmacy);
    return {
      id: pharmacy.id,
      name: pharmacy.name,
      code: pharmacy.code,
      slug: pharmacy.slug,
      location: pharmacy.location,
      status: route.status,
      path: route.path,
      loginPath: route.loginPath,
      url: route.url,
      loginUrl: route.loginUrl,
    };
  }

  async getById(idOrCode: string, user: AuthenticatedUser) {
    const pharmacy = await this.findByRef(idOrCode);
    this.assertPharmacyAccess(user, pharmacy.id);
    return this.withRoute(pharmacy);
  }

  async stock(idOrCode: string, user: AuthenticatedUser) {
    const pharmacy = await this.findByRef(idOrCode);
    requirePharmacyId(user, pharmacy.id);
    const items = await this.prisma.pharmacyStock.findMany({
      where: { pharmacyId: pharmacy.id },
      include: {
        medicine: { include: { unit: true } },
        batch: true,
      },
      orderBy: [{ medicine: { name: 'asc' } }, { batch: { expiryDate: 'asc' } }],
    });
    return { pharmacy: this.withRoute(pharmacy), items };
  }

  async create(
    data: {
      name: string;
      code: string;
      slug?: string;
      address?: string;
      location?: string;
      phone?: string;
      email?: string;
    },
    userId: string,
  ) {
    const pharmacy = await this.prisma.pharmacy.create({
      data: {
        organizationId: await this.currentOrganizationId(),
        name: data.name,
        code: data.code.toUpperCase(),
        slug: data.slug ? slugify(data.slug) : slugify(data.name),
        address: data.address,
        location: data.location ?? data.address,
        phone: data.phone,
        email: data.email,
      },
    });
    await this.audit.record({
      userId,
      action: AuditAction.CREATE_PHARMACY,
      entityType: 'Pharmacy',
      entityId: pharmacy.id,
      newValues: pharmacy,
    });
    return this.withRoute(pharmacy);
  }

  async update(
    id: string,
    data: {
      name?: string;
      address?: string;
      location?: string;
      phone?: string;
      email?: string;
      isActive?: boolean;
    },
    userId: string,
  ) {
    const existing = await this.findByRef(id);
    const updated = await this.prisma.pharmacy.update({
      where: { id: existing.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.address !== undefined ? { address: data.address } : {}),
        ...(data.location !== undefined ? { location: data.location } : {}),
        ...(data.phone !== undefined ? { phone: data.phone } : {}),
        ...(data.email !== undefined ? { email: data.email } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
    });
    await this.audit.record({
      userId,
      action: AuditAction.UPDATE_PHARMACY,
      entityType: 'Pharmacy',
      entityId: existing.id,
      oldValues: existing,
      newValues: data,
    });
    return this.withRoute(updated);
  }

  async setActive(id: string, isActive: boolean, userId: string) {
    return this.update(id, { isActive }, userId);
  }

  private async findByRef(idOrCodeOrSlug: string) {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        idOrCodeOrSlug,
      );
    const pharmacy = await this.prisma.pharmacy.findFirst({
      where: {
        deletedAt: null,
        OR: [
          ...(isUuid ? [{ id: idOrCodeOrSlug }] : []),
          { code: idOrCodeOrSlug.toUpperCase() },
          { slug: idOrCodeOrSlug },
        ],
      },
    });
    if (!pharmacy) {
      throw new NotFoundException('Pharmacy not found');
    }
    return pharmacy;
  }

  private assertPharmacyAccess(user: AuthenticatedUser, pharmacyId: string) {
    if (!isGlobalViewer(user) && user.pharmacyId !== pharmacyId) {
      throw new ForbiddenException('Cannot access another pharmacy');
    }
  }

  private async currentOrganizationId() {
    const organization = await this.prisma.organization.findFirstOrThrow({
      orderBy: { createdAt: 'asc' },
    });
    return organization.id;
  }

  private withRoute<T extends { slug: string; isActive: boolean }>(pharmacy: T) {
    const appUrl = this.config.get('appUrl', { infer: true }).replace(/\/$/, '');
    const path = `/pharmacies/${pharmacy.slug}`;
    const loginPath = `${path}/login`;
    return {
      ...pharmacy,
      status: pharmacy.isActive ? 'ACTIVE' : 'INACTIVE',
      path,
      loginPath,
      url: `${appUrl}${path}`,
      loginUrl: `${appUrl}${loginPath}`,
    };
  }
}
