import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RoleCode } from '@mh/shared';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.role.findMany({
      orderBy: { code: 'asc' },
      include: {
        _count: { select: { userRoles: true } },
        rolePermissions: {
          include: {
            permission: {
              select: {
                id: true,
                code: true,
                name: true,
                resource: true,
                action: true,
              },
            },
          },
        },
      },
    });
  }

  async updatePermissions(id: string, permissionCodes: string[]) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    if (role.code === RoleCode.SUPER_ADMIN) {
      throw new BadRequestException('SUPER_ADMIN permissions cannot be changed');
    }

    const permissions = await this.prisma.permission.findMany({
      where: { code: { in: permissionCodes } },
    });
    if (permissions.length !== permissionCodes.length) {
      throw new BadRequestException('One or more permissions are invalid');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      if (permissions.length > 0) {
        await tx.rolePermission.createMany({
          data: permissions.map((permission) => ({
            roleId: id,
            permissionId: permission.id,
          })),
        });
      }
    });

    return this.prisma.role.findUnique({
      where: { id },
      include: {
        _count: { select: { userRoles: true } },
        rolePermissions: {
          include: {
            permission: {
              select: { id: true, code: true, name: true, resource: true, action: true },
            },
          },
        },
      },
    });
  }
}
