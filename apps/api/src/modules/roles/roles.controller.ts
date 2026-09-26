import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsString } from 'class-validator';
import { PERMISSIONS, RoleCode } from '@mh/shared';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RolesService } from './roles.service';

class UpdateRolePermissionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  permissionCodes: string[];
}

@ApiTags('roles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'roles', version: '1' })
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ROLES_READ)
  list() {
    return this.rolesService.list();
  }

  @Patch(':id/permissions')
  @Roles(RoleCode.SUPER_ADMIN)
  @RequirePermissions(PERMISSIONS.ROLES_UPDATE)
  updatePermissions(@Param('id') id: string, @Body() dto: UpdateRolePermissionsDto) {
    return this.rolesService.updatePermissions(id, dto.permissionCodes);
  }
}
