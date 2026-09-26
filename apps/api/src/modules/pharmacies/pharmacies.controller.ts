import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PERMISSIONS } from '@mh/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { RequestUser } from '../../common/types/authenticated-request';
import { PharmaciesService } from './pharmacies.service';

class PharmacyDto {
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
  @MaxLength(100)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string;
}

class UpdatePharmacyDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string;
}

class PharmacyStatusDto {
  @IsBoolean()
  isActive: boolean;
}

@ApiTags('pharmacies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'pharmacies', version: '1' })
export class PharmaciesController {
  constructor(private readonly service: PharmaciesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PHARMACIES_READ)
  list(@CurrentUser() user: RequestUser) {
    return this.service.list(user);
  }

  @Public()
  @Get('portal/:slug')
  portalBySlug(@Param('slug') slug: string) {
    return this.service.getPortalBySlug(slug);
  }

  @Get('slug/:slug')
  @RequirePermissions(PERMISSIONS.PHARMACIES_READ)
  getBySlug(@Param('slug') slug: string, @CurrentUser() user: RequestUser) {
    return this.service.getBySlug(slug, user);
  }

  @Get(':id/stock')
  @RequirePermissions(PERMISSIONS.PHARMACY_STOCK_READ)
  stock(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.service.stock(id, user);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PHARMACIES_READ)
  getById(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.service.getById(id, user);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PHARMACIES_CREATE)
  create(@Body() dto: PharmacyDto, @CurrentUser() user: RequestUser) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PHARMACIES_UPDATE)
  update(@Param('id') id: string, @Body() dto: UpdatePharmacyDto, @CurrentUser() user: RequestUser) {
    return this.service.update(id, dto, user.id);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.PHARMACY_ACTIVATE)
  setStatus(
    @Param('id') id: string,
    @Body() dto: PharmacyStatusDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.setActive(id, dto.isActive, user.id);
  }
}
