import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  current() {
    return this.prisma.organization.findFirstOrThrow({
      orderBy: { createdAt: 'asc' },
    });
  }
}
