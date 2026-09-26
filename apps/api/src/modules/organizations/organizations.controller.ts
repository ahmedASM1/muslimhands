import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrganizationsService } from './organizations.service';

@ApiTags('organization')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'organization', version: '1' })
export class OrganizationsController {
  constructor(private readonly service: OrganizationsService) {}

  @Get()
  current() {
    return this.service.current();
  }
}
