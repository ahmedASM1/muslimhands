import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { hasPermission, PERMISSIONS } from '@mh/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { RequestUser } from '../../common/types/authenticated-request';
import { WarehousesService } from './warehouses.service';

class CreateWarehouseDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name: string;

  @IsString()
  @MinLength(2)
  @MaxLength(50)
  code: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;
}

class UpdateWarehouseDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string | null;
}

class WarehouseStatusDto {
  @IsBoolean()
  isActive: boolean;
}

@ApiTags('warehouses')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'warehouses', version: '1' })
export class WarehousesController {
  constructor(private readonly service: WarehousesService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    const canRead = hasPermission(user.permissions, PERMISSIONS.WAREHOUSES_READ);
    const canCreateSupply =
      hasPermission(user.permissions, PERMISSIONS.SUPPLY_REQUESTS_CREATE) ||
      hasPermission(user.permissions, PERMISSIONS.SUPPLY_REQUEST_CREATE);
    if (!canRead && !canCreateSupply) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return this.service.list();
  }

  @Post()
  @RequirePermissions(PERMISSIONS.WAREHOUSES_CREATE)
  create(@Body() dto: CreateWarehouseDto, @CurrentUser() user: RequestUser) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.WAREHOUSES_UPDATE)
  update(@Param('id') id: string, @Body() dto: UpdateWarehouseDto, @CurrentUser() user: RequestUser) {
    return this.service.update(id, dto, user.id);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.WAREHOUSES_UPDATE)
  setStatus(
    @Param('id') id: string,
    @Body() dto: WarehouseStatusDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.setActive(id, dto.isActive, user.id);
  }
}
