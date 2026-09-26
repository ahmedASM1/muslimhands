import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';
import { PERMISSIONS } from '@mh/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { RequestUser } from '../../common/types/authenticated-request';
import { UnitsService, UnitQueryDto } from './units.service';

class UnitDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  @MinLength(1)
  code: string;

  @IsOptional()
  @IsString()
  description?: string;
}

class UpdateUnitDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  code?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

class UnitStatusDto {
  @IsBoolean()
  isActive: boolean;
}

@ApiTags('units')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'units', version: '1' })
export class UnitsController {
  constructor(private readonly service: UnitsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.UNITS_READ)
  list(@Query() query: UnitQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.UNITS_READ)
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.UNITS_CREATE)
  create(@Body() dto: UnitDto, @CurrentUser() user: RequestUser) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.UNITS_UPDATE)
  update(@Param('id') id: string, @Body() dto: UpdateUnitDto, @CurrentUser() user: RequestUser) {
    return this.service.update(id, dto, user.id);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.UNITS_UPDATE)
  setStatus(@Param('id') id: string, @Body() dto: UnitStatusDto, @CurrentUser() user: RequestUser) {
    return this.service.setStatus(id, dto.isActive, user.id);
  }
}
